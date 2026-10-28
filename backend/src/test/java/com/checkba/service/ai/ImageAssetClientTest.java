// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.ai;

import static org.junit.jupiter.api.Assertions.*;

import com.sun.net.httpserver.HttpServer;

import org.junit.jupiter.api.Test;

import java.net.InetSocketAddress;
import java.util.concurrent.atomic.AtomicInteger;

class ImageAssetClientTest {
    @Test
    void rejectsUrlEscapesBeforeNetwork() {
        var client = new PptxServiceClient();
        for (String path :
                new String[] {
                    "https://attacker/image.png",
                    "/files/other/materials/a.png",
                    "/files/p/materials/../secret",
                    "/files/p/materials/%2e%2e/a",
                    "/files/p/materials/a?redirect=yes"
                }) {
            assertThrows(IllegalArgumentException.class, () -> client.readAsset("p", path));
        }
    }

    @Test
    void rejectsOversizeAndRedirectWithoutFollowing() throws Exception {
        var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        var hits = new AtomicInteger();
        server.createContext(
                "/files/p/materials/redirect.png",
                exchange -> {
                    exchange.getResponseHeaders().set("Location", "/unexpected");
                    exchange.sendResponseHeaders(302, -1);
                    exchange.close();
                });
        server.createContext(
                "/unexpected",
                exchange -> {
                    hits.incrementAndGet();
                    exchange.sendResponseHeaders(200, -1);
                    exchange.close();
                });
        server.createContext(
                "/files/p/materials/large.png",
                exchange -> {
                    exchange.sendResponseHeaders(200, 0);
                    try (var out = exchange.getResponseBody()) {
                        out.write(new byte[12 * 1024 * 1024 + 1]);
                    } catch (java.io.IOException ignored) {
                    }
                });
        server.start();
        try {
            var client = new PptxServiceClient();
            client.setBaseUrl("http://127.0.0.1:" + server.getAddress().getPort());
            assertThrows(
                    IllegalStateException.class,
                    () -> client.readAsset("p", "/files/p/materials/redirect.png"));
            assertEquals(0, hits.get());
            assertThrows(
                    IllegalStateException.class,
                    () -> client.readAsset("p", "/files/p/materials/large.png"));
        } finally {
            server.stop(0);
        }
    }
}
