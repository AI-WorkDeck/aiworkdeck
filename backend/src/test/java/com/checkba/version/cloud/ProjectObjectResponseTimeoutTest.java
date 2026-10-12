// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.version.cloud;

import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.Test;
import java.io.*;
import java.net.*;
import java.net.http.*;
import java.time.Duration;
import java.util.concurrent.*;
import static org.junit.jupiter.api.Assertions.*;

class ProjectObjectResponseTimeoutTest {
    @Test void abortingOnePartNeverStartsTheRemainingDownloads() throws Exception {
        var opened = new java.util.concurrent.atomic.AtomicInteger();
        var closed = new java.util.concurrent.atomic.AtomicBoolean();
        var parts = new java.util.Enumeration<InputStream>() {
            public boolean hasMoreElements() { return opened.get() < 10; }
            public InputStream nextElement() {
                opened.incrementAndGet();
                return new InputStream() {
                    public int read() throws IOException { throw new IOException("disconnected"); }
                    public void close() { closed.set(true); }
                };
            }
        };
        try (InputStream body = ProjectObjectSyncService.joinedParts(parts)) {
            assertThrows(IOException.class, body::readAllBytes);
        }
        assertEquals(1, opened.get());
        assertTrue(closed.get());
    }

    @Test void headersDoNotAllowABodyToHoldTheRepositoryLockForever() throws Exception {
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        CountDownLatch release = new CountDownLatch(1);
        server.createContext("/stalled", exchange -> {
            try {
                exchange.sendResponseHeaders(200, 4);
                exchange.getResponseBody().write(1);
                exchange.getResponseBody().flush();
                release.await(5, TimeUnit.SECONDS);
            } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
            finally { exchange.close(); }
        });
        server.start();
        try {
            HttpResponse<InputStream> response = HttpClient.newHttpClient().send(HttpRequest.newBuilder(
                    URI.create("http://127.0.0.1:" + server.getAddress().getPort() + "/stalled"))
                    .timeout(Duration.ofSeconds(1)).build(), HttpResponse.BodyHandlers.ofInputStream());
            try (InputStream body = new com.checkba.util.DeadlineInputStream(response.body(), Duration.ofMillis(150))) {
                assertTimeoutPreemptively(Duration.ofSeconds(2), () -> assertThrows(IOException.class, body::readAllBytes));
            }
        } finally { release.countDown(); server.stop(0); }
    }

    @Test void completedResponseClosesAndCancelsItsDeadline() throws Exception {
        var closed = new java.util.concurrent.atomic.AtomicBoolean();
        InputStream source = new ByteArrayInputStream(new byte[]{1, 2, 3}) {
            @Override public void close() { closed.set(true); }
        };
        try (InputStream body = new com.checkba.util.DeadlineInputStream(source, Duration.ofSeconds(1))) {
            assertArrayEquals(new byte[]{1, 2, 3}, body.readAllBytes());
        }
        assertTrue(closed.get());
    }
}
