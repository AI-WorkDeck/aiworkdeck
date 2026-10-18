// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.ai.mcp;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.Test;
import java.net.InetSocketAddress;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import static org.junit.jupiter.api.Assertions.*;

class PluginMcpLateResultTest {
    @Test void revokedAfterFinalPreReadGuardCannotDeliverTheResult() throws Exception {
        ObjectMapper json = new ObjectMapper();
        Map<String, Object> schema = Map.of("type", "object", "properties", Map.of());
        CountDownLatch enteredCall = new CountDownLatch(1), releaseFinal = new CountDownLatch(1);
        AtomicInteger finalGuards = new AtomicInteger(), cleanup = new AtomicInteger();
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        ExecutorService executor = Executors.newCachedThreadPool(); server.setExecutor(executor);
        server.createContext("/mcp", exchange -> {
            try {
                if ("DELETE".equals(exchange.getRequestMethod())) {
                    cleanup.incrementAndGet(); exchange.sendResponseHeaders(204, -1); return;
                }
                var payload = json.readTree(exchange.getRequestBody());
                String method = payload.path("method").asText();
                Object result;
                if ("initialize".equals(method)) {
                    exchange.getResponseHeaders().set("MCP-Session-Id", "fixture-session");
                    result = Map.of("protocolVersion", "2025-11-25", "capabilities", Map.of("tools", Map.of()));
                } else if ("notifications/initialized".equals(method)) {
                    exchange.sendResponseHeaders(202, -1); return;
                } else if ("tools/list".equals(method)) {
                    result = Map.of("tools", List.of(Map.of("name", "echo", "inputSchema", schema)));
                } else {
                    enteredCall.countDown();
                    try {
                        if (!releaseFinal.await(3, TimeUnit.SECONDS)) { exchange.sendResponseHeaders(500, -1); return; }
                    } catch (InterruptedException interrupted) {
                        Thread.currentThread().interrupt(); exchange.sendResponseHeaders(500, -1); return;
                    }
                    exchange.getResponseHeaders().set("Connection", "close");
                    result = Map.of("content", List.of(Map.of("type", "text", "text", "synthetic result")));
                }
                byte[] response = json.writeValueAsBytes(Map.of("jsonrpc", "2.0", "id", payload.path("id").asText(), "result", result));
                exchange.getResponseHeaders().set("Content-Type", "application/json");
                exchange.sendResponseHeaders(200, response.length); exchange.getResponseBody().write(response);
            } finally { exchange.close(); }
        });
        server.start();
        try {
            PluginMcpHttpClient client = new PluginMcpHttpClient(new PluginMcpEndpointPolicy(true));
            String url = "http://127.0.0.1:" + server.getAddress().getPort() + "/mcp";
            PluginMcpException failure = assertThrows(PluginMcpException.class, () -> client.call(url, "", "echo", schema, Map.of(), () -> {
                if (enteredCall.getCount() != 0) return true;
                // Capture one final successful access check, then revoke while its response is still pending.
                // A post-read guard must observe the revocation; polling before the read cannot do so.
                if (finalGuards.incrementAndGet() == 1) { releaseFinal.countDown(); return true; }
                return false;
            }));
            assertEquals("cancelled", failure.code());
            assertEquals(1, cleanup.get(), "Cancelled calls still clean up their isolated MCP session");
        } finally {
            releaseFinal.countDown(); server.stop(0); executor.shutdownNow();
        }
    }
}
