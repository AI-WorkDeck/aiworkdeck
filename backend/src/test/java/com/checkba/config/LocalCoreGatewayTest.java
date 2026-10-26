// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.config;

import com.checkba.localcore.LocalCoreOwnership;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.Test;

import java.net.InetSocketAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.*;

class LocalCoreGatewayTest {
    private final HttpClient client = HttpClient.newHttpClient();

    @Test void jpaLocalCapabilityWaitsForDrainAndWakesOnlyDocumentRequests() throws Exception {
        var owner = new LocalCoreOwnership(); var lease = owner.acquireCoreLease();
        var calls = new AtomicInteger();
        try (var gateway = new LocalCoreGateway(0, owner, (q, r) -> false, "", false, Duration.ofMillis(400))) {
            LocalCoreGateway.CoreHandler documents = (q, r) -> { calls.incrementAndGet(); r.getWriter().write("JPA document"); return true; };
            assertThrows(IllegalStateException.class, () -> gateway.jpaDocumentsReady(documents));
            var drained = CompletableFuture.runAsync(() -> {
                try { owner.drainAndHandoff(Duration.ofSeconds(2), () -> {}); }
                catch (Exception failure) { throw new RuntimeException(failure); }
            });
            long limit = System.nanoTime() + TimeUnit.SECONDS.toNanos(1);
            while (owner.state() == LocalCoreOwnership.State.CORE && System.nanoTime() < limit) Thread.onSpinWait();
            assertEquals(LocalCoreOwnership.State.DRAINING, owner.state());
            assertThrows(IllegalStateException.class, () -> gateway.jpaDocumentsReady(documents));
            var waiting = client.sendAsync(HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + gateway.port()
                    + "/api/document/generator/settings")).build(), HttpResponse.BodyHandlers.ofString());
            assertThrows(TimeoutException.class, () -> waiting.get(30, TimeUnit.MILLISECONDS));
            lease.close(); drained.get(2, TimeUnit.SECONDS);
            gateway.jpaDocumentsReady(documents);
            assertEquals("JPA document", waiting.get(1, TimeUnit.SECONDS).body());
            assertEquals(503, send(gateway, "PUT", "/api/document/generator/settings").statusCode());
            assertEquals(503, send(gateway, "GET", "/api/unknown").statusCode());
            assertEquals(1, calls.get());
            gateway.backendFailed();
            assertEquals(503, send(gateway, "GET", "/api/document/generator/settings").statusCode());
            assertThrows(IllegalStateException.class, () -> gateway.jpaDocumentsReady(documents));
            assertEquals(1, calls.get());
        } finally { lease.close(); }
    }

    @Test void documentReadyOnlyReleasesExactMethodsAndPathsUntilFullReadiness() throws Exception {
        var owner = new LocalCoreOwnership(); owner.drainAndHandoff(Duration.ZERO, () -> {});
        var calls = new AtomicInteger();
        HttpServer backend = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        backend.createContext("/", exchange -> {
            calls.incrementAndGet();
            exchange.sendResponseHeaders(exchange.getRequestURI().getPath().startsWith("/api/desktop/") ? 503 : 204, -1);
            exchange.close();
        }); backend.start();
        try (var gateway = new LocalCoreGateway(0, owner, (q, r) -> fail("Retired CORE"), "", false, Duration.ofMillis(30))) {
            gateway.documentBackendReady(backend.getAddress().getPort());
            for (String path : new String[]{"/api/document/generator/settings", "/api/projects/my", "/api/projects/1/files", "/api/files/1/download"}) {
                assertEquals(204, send(gateway, "GET", path).statusCode());
                assertEquals(204, send(gateway, "HEAD", path).statusCode());
            }
            String content = "/api/local-core/projects/1/files/2/content";
            String receipt = content + "/receipts/00000000-0000-0000-0000-000000000001";
            for (String method : new String[]{"GET", "HEAD", "PUT"}) assertEquals(204, send(gateway, method, content).statusCode());
            for (String method : new String[]{"GET", "DELETE"}) assertEquals(204, send(gateway, method, receipt).statusCode());
            for (String path : new String[]{"/api/desktop/health", "/api/desktop/startup-health"})
                for (String method : new String[]{"GET", "HEAD"}) assertEquals(503, send(gateway, method, path).statusCode());
            int allowed = calls.get();
            for (String path : new String[]{"/api/unknown", content + "/unexpected", content.replace("/1/", "/01/")})
                assertEquals(503, send(gateway, "GET", path).statusCode());
            assertEquals(503, send(gateway, "PUT", "/api/document/generator/settings").statusCode());
            assertEquals(503, send(gateway, "POST", content).statusCode());
            assertEquals(503, send(gateway, "PUT", receipt).statusCode());
            assertEquals(403, send(gateway, "PUT", content, "Origin", "https://evil.example").statusCode());
            assertEquals(allowed, calls.get(), "Unadvertised requests must not reach MVC yet");
            gateway.backendReady(backend.getAddress().getPort());
            assertEquals(204, send(gateway, "GET", "/api/unknown").statusCode());
            gateway.backendFailed();
            assertEquals(503, send(gateway, "GET", "/api/document/generator/settings").statusCode());
            assertEquals(503, send(gateway, "GET", "/api/unknown").statusCode());
            assertThrows(IllegalStateException.class, () -> gateway.documentBackendReady(backend.getAddress().getPort()));
        } finally { backend.stop(0); }
    }

    @Test void documentReadinessRequiresSuccessfulHandoffAndCannotOutliveClose() throws Exception {
        var owner = new LocalCoreOwnership();
        var gateway = new LocalCoreGateway(0, owner, (q, r) -> false, "", false, Duration.ofMillis(30));
        try {
            assertThrows(IllegalStateException.class, () -> gateway.documentBackendReady(12345));
            owner.drainAndHandoff(Duration.ZERO, () -> {});
            gateway.close();
            assertThrows(IllegalStateException.class, () -> gateway.documentBackendReady(12345));
            assertThrows(IllegalStateException.class, () -> gateway.backendReady(12345));
        } finally { gateway.close(); }
    }

    @Test void closeReleasesStandaloneTomcatKeepAliveThread() throws Exception {
        var before = Thread.getAllStackTraces().keySet();
        var gateway = new LocalCoreGateway(0, new LocalCoreOwnership(), (request, response) -> false,
                "", false, Duration.ofMillis(20));
        var owned = Thread.getAllStackTraces().keySet().stream()
                .filter(thread -> !before.contains(thread) && !thread.isDaemon() && thread.getName().startsWith("container-"))
                .toList();
        assertFalse(owned.isEmpty(), "Standalone Tomcat must actually have started");
        gateway.close();
        for (Thread thread : owned) { thread.join(1500); assertFalse(thread.isAlive(), "Gateway kept JVM alive after close"); }
        gateway.close();
    }

    private HttpResponse<String> send(LocalCoreGateway gateway, String method, String path, String... headers) throws Exception {
        var builder = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + gateway.port() + path))
                .timeout(Duration.ofSeconds(5)).method(method, HttpRequest.BodyPublishers.noBody());
        if (headers.length > 0) builder.headers(headers);
        return client.send(builder.build(), HttpResponse.BodyHandlers.ofString());
    }

    @Test void coreWorksWithoutSpringAndReusesLocalAdmissionAndCors() throws Exception {
        var owner = new LocalCoreOwnership();
        AtomicInteger calls = new AtomicInteger();
        try (var gateway = new LocalCoreGateway(0, owner, (request, response) -> {
            calls.incrementAndGet(); response.getWriter().write("actual core"); return true;
        }, "", false, Duration.ofMillis(50))) {
            var allowed = send(gateway, "GET", "/api/projects", "Origin", "http://localhost:5173");
            assertEquals(200, allowed.statusCode()); assertEquals("actual core", allowed.body());
            assertEquals("http://localhost:5173", allowed.headers().firstValue("Access-Control-Allow-Origin").orElseThrow());
            assertEquals(SourceCodeNoticeFilter.SOURCE_URL, allowed.headers().firstValue("X-Source-Code").orElseThrow());
            assertEquals(403, send(gateway, "POST", "/api/files/1/upload", "Origin", "https://evil.example").statusCode());
            assertEquals(403, send(gateway, "GET", "/api/projects", "X-Forwarded-For", "127.0.0.1").statusCode());
            assertEquals(1, calls.get());
            assertThrows(IllegalStateException.class, () -> gateway.backendReady(12345));
        }
    }

    @Test void unsupportedRequestDoesNotHoldLeaseAndCrossesHandoffOnSamePort() throws Exception {
        var owner = new LocalCoreOwnership();
        CountDownLatch unsupported = new CountDownLatch(1);
        HttpServer backend = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        backend.createContext("/api/late", exchange -> {
            byte[] bytes = exchange.getRequestURI().toString().getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("X-Backend", "real-private-port");
            exchange.sendResponseHeaders(200, bytes.length); exchange.getResponseBody().write(bytes); exchange.close();
        }); backend.start();
        try (var gateway = new LocalCoreGateway(0, owner, (request, response) -> {
            unsupported.countDown(); return false;
        }, "", false, Duration.ofSeconds(3))) {
            var response = client.sendAsync(HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + gateway.port()
                    + "/api/late?a=hello%20world")).build(), HttpResponse.BodyHandlers.ofString());
            assertTrue(unsupported.await(2, TimeUnit.SECONDS));
            owner.drainAndHandoff(Duration.ofSeconds(1), () -> {});
            gateway.backendReady(backend.getAddress().getPort());
            var received = response.get(3, TimeUnit.SECONDS);
            assertEquals("/api/late?a=hello%20world", received.body());
            assertEquals("real-private-port", received.headers().firstValue("X-Backend").orElseThrow());
            assertEquals(403, send(gateway, "POST", "/api/late", "Origin", "null").statusCode());
        } finally { backend.stop(0); }
    }

    @Test void responseStreamingRemainsInsideCoreLease() throws Exception {
        var owner = new LocalCoreOwnership();
        CountDownLatch writing = new CountDownLatch(1), finish = new CountDownLatch(1);
        try (var gateway = new LocalCoreGateway(0, owner, (request, response) -> {
            response.getWriter().write("start"); response.flushBuffer(); writing.countDown();
            assertTrue(finish.await(3, TimeUnit.SECONDS)); response.getWriter().write("end"); return true;
        }, "", false, Duration.ofSeconds(1))) {
            var response = client.sendAsync(HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + gateway.port()
                    + "/core")).build(), HttpResponse.BodyHandlers.ofString());
            assertTrue(writing.await(2, TimeUnit.SECONDS));
            AtomicInteger handoffs = new AtomicInteger();
            var drain = CompletableFuture.runAsync(() -> {
                try { owner.drainAndHandoff(Duration.ofSeconds(2), handoffs::incrementAndGet); }
                catch (Exception e) { throw new RuntimeException(e); }
            });
            long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(1);
            while (owner.state() == LocalCoreOwnership.State.CORE && System.nanoTime() < deadline) Thread.onSpinWait();
            assertEquals(LocalCoreOwnership.State.DRAINING, owner.state()); assertEquals(0, handoffs.get());
            finish.countDown(); assertEquals("startend", response.get(3, TimeUnit.SECONDS).body());
            drain.get(3, TimeUnit.SECONDS); assertEquals(1, handoffs.get());
        } finally { finish.countDown(); }
    }

    @Test void proxyStreamsSseBeforeUpstreamClosesAndPreservesUploadBytes() throws Exception {
        var owner = new LocalCoreOwnership(); owner.drainAndHandoff(Duration.ZERO, () -> {});
        CountDownLatch finish = new CountDownLatch(1);
        var uploadLength = new java.util.concurrent.atomic.AtomicReference<String>();
        var uploadExpect = new java.util.concurrent.atomic.AtomicReference<String>();
        HttpServer backend = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        backend.createContext("/stream", exchange -> {
            exchange.getResponseHeaders().set("Content-Type", "text/event-stream"); exchange.sendResponseHeaders(200, 0);
            exchange.getResponseBody().write("data: first\n\n".getBytes(StandardCharsets.UTF_8)); exchange.getResponseBody().flush();
            try { finish.await(3, TimeUnit.SECONDS); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
            exchange.close();
        });
        backend.createContext("/upload", exchange -> {
            uploadLength.set(exchange.getRequestHeaders().getFirst("Content-Length"));
            uploadExpect.set(exchange.getRequestHeaders().getFirst("Expect"));
            byte[] bytes = exchange.getRequestBody().readAllBytes();
            exchange.sendResponseHeaders(201, bytes.length); exchange.getResponseBody().write(bytes); exchange.close();
        }); backend.start();
        try (var gateway = new LocalCoreGateway(0, owner, (request, response) -> fail("core called after handoff"),
                "", false, Duration.ofSeconds(1))) {
            gateway.backendReady(backend.getAddress().getPort());
            var streaming = client.send(HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + gateway.port()
                    + "/stream")).timeout(Duration.ofSeconds(2)).build(), HttpResponse.BodyHandlers.ofInputStream());
            try (var input = streaming.body()) {
                assertEquals("data: first\n\n", new String(input.readNBytes(13), StandardCharsets.UTF_8));
                assertEquals(1, finish.getCount()); finish.countDown();
            }
            byte[] upload = new byte[256 * 1024]; new java.util.Random(1).nextBytes(upload);
            var uploaded = client.send(HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + gateway.port()
                    + "/upload")).expectContinue(true).POST(HttpRequest.BodyPublishers.ofByteArray(upload)).build(), HttpResponse.BodyHandlers.ofByteArray());
            assertEquals(201, uploaded.statusCode()); assertArrayEquals(upload, uploaded.body());
            assertEquals(Integer.toString(upload.length), uploadLength.get());
            assertNull(uploadExpect.get());
            assertEquals(Integer.toString(upload.length), uploaded.headers().firstValue("Content-Length").orElseThrow());
        } finally { finish.countDown(); backend.stop(0); }
    }

    @Test void unavailableDoesNotPretendSuccessOrInvokeCoreAfterFailedHandoff() throws Exception {
        var owner = new LocalCoreOwnership();
        AtomicInteger calls = new AtomicInteger();
        try (var gateway = new LocalCoreGateway(0, owner, (request, response) -> {
            calls.incrementAndGet(); return false;
        }, "", false, Duration.ofMillis(20))) {
            assertEquals(503, send(gateway, "GET", "/unsupported").statusCode());
            assertThrows(IllegalStateException.class, () -> owner.drainAndHandoff(Duration.ZERO, () -> { throw new IllegalStateException(); }));
            assertEquals(503, send(gateway, "GET", "/unsupported").statusCode());
            assertEquals(1, calls.get());
        }
    }
}
