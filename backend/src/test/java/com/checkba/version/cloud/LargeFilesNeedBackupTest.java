// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.version.cloud;

import com.checkba.service.mobile.MobileRelayClientService;
import com.checkba.version.ProjectRepoService;
import com.checkba.version.VersionException;
import com.checkba.version.objects.LocalVersionObjectStore.ObjectRef;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.ObjectProvider;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * C12 (lane C S2): a case with a 30 MB .mp4 could not be submitted without file cloud backup, and the
 * lawyer got a vanishing generic toast. The refusal now carries kind LARGE_FILES_NEED_BACKUP, names
 * the files and says deleting them won't help; the online status warns before 交稿.
 */
class LargeFilesNeedBackupTest {
    ProjectRepoService repos;
    MobileRelayClientService relay;
    ProjectObjectSyncService sync;
    com.sun.net.httpserver.HttpServer server;
    String remote;
    /** Objects the fake case library already holds (sha256). */
    final java.util.Set<String> held = java.util.concurrent.ConcurrentHashMap.newKeySet();

    @BeforeEach
    @SuppressWarnings("unchecked")
    void setup() {
        repos = mock(ProjectRepoService.class);
        relay = mock(MobileRelayClientService.class);
        ObjectProvider<MobileRelayClientService> provider = mock(ObjectProvider.class);
        when(provider.getIfAvailable()).thenReturn(relay);
        when(repos.mainBranch()).thenReturn("refs/heads/master");
        when(repos.objectPointersAt(eq(7L), anyString(), eq(true))).thenReturn(List.of(new ObjectRef("a".repeat(64), 30_000_000L)));
        when(repos.objectPointerPaths(eq(7L), anyString(), eq(true), anyInt())).thenReturn(List.of("证据/庭审录像.mp4"));
        when(relay.catalogAccountScope()).thenReturn("scope");
        try {
            org.eclipse.jgit.lib.Repository repo = mock(org.eclipse.jgit.lib.Repository.class);
            org.eclipse.jgit.lib.RefDatabase refs = mock(org.eclipse.jgit.lib.RefDatabase.class);
            when(repo.getRefDatabase()).thenReturn(refs);
            when(refs.getRefsByPrefix(anyString())).thenReturn(List.of());
            when(repos.open(7L)).thenReturn(repo);
        } catch (Exception e) { throw new AssertionError(e); }
        sync = new ProjectObjectSyncService(repos, provider, new ObjectMapper());
        try {
            server = com.sun.net.httpserver.HttpServer.create(new java.net.InetSocketAddress("127.0.0.1", 0), 0);
        } catch (java.io.IOException e) { throw new AssertionError(e); }
        server.createContext("/git/5.git/awd-objects/", exchange -> {
            String path = exchange.getRequestURI().getPath();
            String body = path.endsWith("/capabilities")
                    ? "{\"version\":1,\"partBytes\":" + ProjectObjectTransferService.PART_BYTES + "}"
                    : "{\"complete\":" + held.contains(path.substring(path.lastIndexOf('/') + 1)) + ",\"parts\":[]}";
            byte[] bytes = body.getBytes(java.nio.charset.StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200, bytes.length);
            try (var out = exchange.getResponseBody()) { out.write(bytes); }
        });
        server.start();
        remote = "http://127.0.0.1:" + server.getAddress().getPort() + "/git/5.git";
    }

    @org.junit.jupiter.api.AfterEach
    void stop() { server.stop(0); }

    @Test
    void submitWithoutBackupIsAnActionableKindNamingTheFile() {
        doThrow(VersionException.userFacing("generic")).when(relay).requireVersionObjectCloudConsent();
        VersionException e = assertThrows(VersionException.class, () -> sync.upload(7L, remote, "u", "t"));
        assertEquals(VersionException.LARGE_FILES_NEED_BACKUP, e.getKind());
        assertTrue(e.getMessage().contains("庭审录像.mp4"), e.getMessage());
        assertTrue(e.getMessage().contains("删掉这个文件也不行") || e.getMessage().contains("Deleting the file won't help"), e.getMessage());
    }

    @Test
    void statusWarnsBeforeSubmitOnlyWhenBlocked() {
        doThrow(VersionException.userFacing("generic")).when(relay).requireVersionObjectCloudConsent();
        assertEquals(List.of("证据/庭审录像.mp4"), sync.largeFilesBlockingSubmit(7L, remote, "u", "t"));
        doNothing().when(relay).requireVersionObjectCloudConsent();
        assertEquals(List.of(), sync.largeFilesBlockingSubmit(7L, remote, "u", "t"), "backup on: nothing to warn about");
        when(repos.objectPointersAt(eq(7L), anyString(), eq(true))).thenReturn(List.of());
        doThrow(VersionException.userFacing("generic")).when(relay).requireVersionObjectCloudConsent();
        assertEquals(List.of(), sync.largeFilesBlockingSubmit(7L, remote, "u", "t"), "no large files: no warning, no network");
    }

    /** C12b x step 1: a colleague opening a case whose recording is already in the library gets no false warning. */
    @Test
    void noWarningWhenTheLibraryAlreadyHoldsEveryObject() {
        doThrow(VersionException.userFacing("generic")).when(relay).requireVersionObjectCloudConsent();
        held.add("a".repeat(64));
        assertEquals(List.of(), sync.largeFilesBlockingSubmit(7L, remote, "u", "t"));
        held.clear();
        assertEquals(List.of("证据/庭审录像.mp4"), sync.largeFilesBlockingSubmit(7L, remote, "u", "t"), "missing object: warn");
    }

    @Test
    void unreachableLibraryKeepsTheWarning() {
        doThrow(VersionException.userFacing("generic")).when(relay).requireVersionObjectCloudConsent();
        assertEquals(List.of("证据/庭审录像.mp4"), sync.largeFilesBlockingSubmit(7L, "http://127.0.0.1:1/git/5.git", "u", "t"));
    }
}
