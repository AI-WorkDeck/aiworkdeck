// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.version.cloud;

import com.checkba.service.mobile.MobileRelayClientService;
import com.checkba.storage.ProjectStorageResolver;
import com.checkba.storage.StorageProperties;
import com.checkba.version.ProjectRepoService;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.beans.factory.ObjectProvider;

import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import java.util.concurrent.*;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** CEO 2026-11-26 (after #1764): a slow 交稿 must show it is progressing, not look like a hang. */
class ProjectObjectTransferProgressTest {

    @Test
    @SuppressWarnings("unchecked")
    void uploadReportsBytesWhileAPartIsInFlightAndClearsAfterwards(@TempDir Path root) throws Exception {
        var properties = new StorageProperties();
        properties.getLocal().setRootPath(root.toString());
        ProjectRepoService repos = spy(new ProjectRepoService(new ProjectStorageResolver(properties, null)));
        Files.createDirectories(repos.workTree(1));
        byte[] media = new byte[3 * 1024 * 1024];
        new java.util.Random(5).nextBytes(media);
        Files.write(repos.workTree(1).resolve("庭审录像.mp4"), media);
        repos.init(1, "Synthetic", "test@example.com");
        doReturn(Map.of()).when(repos).cloudWriteHeaders(anyLong(), anyString(), any(), any());

        CountDownLatch bodyReceived = new CountDownLatch(1), release = new CountDownLatch(1);
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.setExecutor(Executors.newCachedThreadPool());
        server.createContext("/git/5.git/awd-objects/", exchange -> {
            String path = exchange.getRequestURI().getPath();
            String body;
            if (path.endsWith("/capabilities")) body = "{\"version\":1,\"partBytes\":" + ProjectObjectTransferService.PART_BYTES + "}";
            else if (path.contains("/parts/")) {
                exchange.getRequestBody().readAllBytes();
                bodyReceived.countDown();
                try { release.await(10, TimeUnit.SECONDS); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
                body = "{\"ok\":true}";
            } else if (path.endsWith("/complete")) body = "{\"complete\":true}";
            else body = "{\"complete\":false,\"parts\":[]}";
            byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200, bytes.length);
            try (var out = exchange.getResponseBody()) { out.write(bytes); }
        });
        server.start();
        try {
            ObjectProvider<MobileRelayClientService> provider = mock(ObjectProvider.class);
            when(provider.getIfAvailable()).thenReturn(mock(MobileRelayClientService.class));
            var sync = new ProjectObjectSyncService(repos, provider, new ObjectMapper());
            assertEquals(Map.of("active", false), sync.transferProgress(1));

            String remote = "http://127.0.0.1:" + server.getAddress().getPort() + "/git/5.git";
            Future<?> upload = Executors.newSingleThreadExecutor().submit(() -> sync.upload(1, remote, "u", "t"));
            assertTrue(bodyReceived.await(10, TimeUnit.SECONDS), "the part reached the library");
            Map<String, Object> during = sync.transferProgress(1);
            assertEquals(true, during.get("active"));
            assertEquals("upload", during.get("direction"));
            long size = repos.objects().list(1).get(0).size();
            assertEquals(size, during.get("totalBytes"));
            assertEquals(size, during.get("doneBytes"), "the whole part body was read while the response is pending");
            assertEquals(Map.of("active", false), sync.transferProgress(2), "progress is per case");

            release.countDown();
            upload.get(10, TimeUnit.SECONDS);
            assertEquals(Map.of("active", false), sync.transferProgress(1), "cleared when the transfer ends");
        } finally {
            release.countDown();
            server.stop(0);
        }
    }

    /** Lane C/Q 07:43: session-end background upload and 交稿 both PUT the same 30 MB part. One must wait and skip. */
    @Test
    @SuppressWarnings("unchecked")
    void concurrentUploadsOfOneCaseSendEachPartOnce(@TempDir Path root) throws Exception {
        var properties = new StorageProperties();
        properties.getLocal().setRootPath(root.toString());
        ProjectRepoService repos = spy(new ProjectRepoService(new ProjectStorageResolver(properties, null)));
        Files.createDirectories(repos.workTree(1));
        byte[] media = new byte[2 * 1024 * 1024];
        new java.util.Random(9).nextBytes(media);
        Files.write(repos.workTree(1).resolve("录音.mp4"), media);
        repos.init(1, "Synthetic", "test@example.com");
        doReturn(Map.of()).when(repos).cloudWriteHeaders(anyLong(), anyString(), any(), any());

        var puts = new java.util.concurrent.atomic.AtomicInteger();
        var completed = java.util.concurrent.ConcurrentHashMap.<String>newKeySet();
        CountDownLatch firstPut = new CountDownLatch(1), release = new CountDownLatch(1);
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.setExecutor(Executors.newCachedThreadPool());
        server.createContext("/git/5.git/awd-objects/", exchange -> {
            String path = exchange.getRequestURI().getPath();
            String body;
            if (path.endsWith("/capabilities")) body = "{\"version\":1,\"partBytes\":" + ProjectObjectTransferService.PART_BYTES + "}";
            else if (path.contains("/parts/")) {
                exchange.getRequestBody().readAllBytes();
                puts.incrementAndGet();
                firstPut.countDown();
                try { release.await(10, TimeUnit.SECONDS); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
                body = "{\"ok\":true}";
            } else if (path.endsWith("/complete")) {
                completed.add(path.split("/")[4]);
                body = "{\"complete\":true}";
            } else body = "{\"complete\":" + completed.contains(path.substring(path.lastIndexOf('/') + 1)) + ",\"parts\":[]}";
            byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200, bytes.length);
            try (var out = exchange.getResponseBody()) { out.write(bytes); }
        });
        server.start();
        var pool = Executors.newFixedThreadPool(2);
        try {
            ObjectProvider<MobileRelayClientService> provider = mock(ObjectProvider.class);
            when(provider.getIfAvailable()).thenReturn(mock(MobileRelayClientService.class));
            var sync = new ProjectObjectSyncService(repos, provider, new ObjectMapper());
            String remote = "http://127.0.0.1:" + server.getAddress().getPort() + "/git/5.git";
            Future<?> background = pool.submit(() -> sync.upload(1, remote, "u", "t"));
            assertTrue(firstPut.await(10, TimeUnit.SECONDS));
            Future<?> submit = pool.submit(() -> sync.upload(1, remote, "u", "t"));
            Thread.sleep(300);
            assertEquals(1, puts.get(), "the second upload waits instead of sending the part again");
            assertEquals("upload", sync.transferProgress(1).get("direction"), "progress still shows the running transfer");
            release.countDown();
            background.get(10, TimeUnit.SECONDS);
            submit.get(10, TimeUnit.SECONDS);
            assertEquals(1, puts.get(), "the object was complete by the time the second upload asked");
            assertEquals(Map.of("active", false), sync.transferProgress(1));
        } finally {
            release.countDown();
            pool.shutdownNow();
            server.stop(0);
        }
    }

    /** Lane C round 2 nit: a 60 + 30 MB pull showed 「… / 60.0 MB」, then 「… / 90.0 MB」. Size the pull up front. */
    @Test
    @SuppressWarnings("unchecked")
    void downloadTotalCountsEveryMissingObjectUpFront(@TempDir Path root) throws Exception {
        var properties = new StorageProperties();
        properties.getLocal().setRootPath(root.toString());
        ProjectRepoService repos = new ProjectRepoService(new ProjectStorageResolver(properties, null));
        ObjectProvider<MobileRelayClientService> provider = mock(ObjectProvider.class);
        var sync = new ProjectObjectSyncService(repos, provider, new ObjectMapper());
        byte[] held = new byte[1000], missing = new byte[3000];
        new java.util.Random(1).nextBytes(held);
        new java.util.Random(2).nextBytes(missing);
        var present = repos.objects().put(1, new java.io.ByteArrayInputStream(held));
        var absent = com.checkba.version.objects.LocalVersionObjectStore.fingerprint(new java.io.ByteArrayInputStream(missing));
        var absent2 = com.checkba.version.objects.LocalVersionObjectStore.fingerprint(new java.io.ByteArrayInputStream(new byte[500]));
        assertEquals(3500, sync.bytesToDownload(1, new java.util.LinkedHashSet<>(java.util.List.of(present, absent, absent2))));
        assertEquals(0, sync.bytesToDownload(1, java.util.Set.of(present)));
    }
}

