// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.ai.mcp;

import com.sun.net.httpserver.HttpServer;
import okhttp3.Request;
import org.junit.jupiter.api.*;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.util.concurrent.atomic.AtomicInteger;
import static org.junit.jupiter.api.Assertions.*;

class PluginServicesFixtureTransportTest {
    HttpServer server;
    final AtomicInteger requests = new AtomicInteger();
    @BeforeEach void setup() throws Exception {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            requests.incrementAndGet();
            if (exchange.getRequestURI().getPath().equals("/redirect")) {
                exchange.getResponseHeaders().set("Location", "https://outside.example.invalid/secret");
                exchange.sendResponseHeaders(302, -1);
            } else {
                byte[] body = (exchange.getRequestURI() + "|" + exchange.getRequestHeaders().getFirst("Authorization")).getBytes(java.nio.charset.StandardCharsets.UTF_8);
                exchange.sendResponseHeaders(200, body.length); exchange.getResponseBody().write(body);
            }
            exchange.close();
        }); server.start();
    }
    @AfterEach void cleanup() { server.stop(0); }
    @Test void mapsOnlyDeclaredOriginAndRetainsPathQueryAndCredential() throws Exception {
        var client = PluginServicesFixtureApplication.connectionTransport(server.getAddress().getPort());
        try (var response = client.newCall(new Request.Builder().url("https://service.example.invalid/status?text=test")
                .header("Authorization", "Bearer synthetic-only").build()).execute()) {
            assertEquals(200, response.code()); assertEquals("/status?text=test|Bearer synthetic-only", response.body().string());
        }
        assertEquals(1, requests.get());
    }
    @Test void rejectsOriginSchemePortAndUserinfoWithoutAnyHttp() {
        var client = PluginServicesFixtureApplication.connectionTransport(server.getAddress().getPort());
        for (String url : new String[]{"https://outside.example.invalid/status", "http://service.example.invalid/status",
                "https://service.example.invalid:444/status", "https://user:password@service.example.invalid/status", "http://127.0.0.1:" + server.getAddress().getPort()}) {
            assertThrows(IOException.class, () -> client.newCall(new Request.Builder().url(url).build()).execute());
        }
        assertEquals(0, requests.get());
    }
    @Test void redirectsNeverSendCredentialsToAnotherEndpoint() throws Exception {
        var client = PluginServicesFixtureApplication.connectionTransport(server.getAddress().getPort());
        try (var response = client.newCall(new Request.Builder().url("https://service.example.invalid/redirect")
                .header("Authorization", "Bearer synthetic-only").build()).execute()) {
            assertEquals(302, response.code());
        }
        assertEquals(1, requests.get());
    }
}
