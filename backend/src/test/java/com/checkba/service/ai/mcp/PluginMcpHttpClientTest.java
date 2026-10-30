// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.ai.mcp;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.*;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import static org.junit.jupiter.api.Assertions.*;

class PluginMcpHttpClientTest {
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final Map<String, Object> SCHEMA = Map.of("type", "object", "properties", Map.of("query", Map.of("type", "string")), "required", List.of("query"), "additionalProperties", false);
    private HttpServer server;
    private final List<String> methods = new CopyOnWriteArrayList<>();
    private final List<String> auth = new CopyOnWriteArrayList<>();
    private final List<String> customHeaders = new CopyOnWriteArrayList<>();
    private final List<String> sessions = new CopyOnWriteArrayList<>();
    private final AtomicInteger sequence = new AtomicInteger();
    private volatile String mode = "normal";
    private final CountDownLatch enteredCall = new CountDownLatch(1);
    private ExecutorService executor;
    @BeforeEach void start() throws Exception {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        executor = Executors.newCachedThreadPool(); server.setExecutor(executor);
        server.createContext("/mcp", exchange -> {
            try {
                auth.add(String.valueOf(exchange.getRequestHeaders().getFirst("Authorization")));
                customHeaders.add(String.valueOf(exchange.getRequestHeaders().getFirst("X-Test-Key")));
                if ("DELETE".equals(exchange.getRequestMethod())) { methods.add("DELETE"); exchange.sendResponseHeaders(204, -1); return; }
                var body = JSON.readTree(exchange.getRequestBody());
                String method = body.path("method").asText(); methods.add(method);
                String session = exchange.getRequestHeaders().getFirst("MCP-Session-Id");
                if (!"initialize".equals(method)) {
                    sessions.add(String.valueOf(session));
                    if (session == null || !"2025-11-25".equals(exchange.getRequestHeaders().getFirst("MCP-Protocol-Version"))) {
                        exchange.sendResponseHeaders(400, -1); return;
                    }
                }
                if ("redirect".equals(mode)) { exchange.getResponseHeaders().set("Location", "/trap"); exchange.sendResponseHeaders(302, -1); return; }
                Object result;
                if ("initialize".equals(method)) {
                    exchange.getResponseHeaders().set("MCP-Session-Id", "session-" + sequence.incrementAndGet());
                    result = Map.of("protocolVersion", "2025-11-25", "capabilities", Map.of("tools", Map.of()), "serverInfo", Map.of("name", "fixture", "version", "1"));
                } else if ("notifications/initialized".equals(method)) { exchange.sendResponseHeaders(202, -1); return; }
                else if ("tools/list".equals(method)) {
                    if ("expire-discovery".equals(mode)) { mode = "normal"; exchange.sendResponseHeaders(404, -1); return; }
                    result = Map.of("tools", List.of(Map.of("name", "echo", "inputSchema", "schema-drift".equals(mode) ? Map.of("type", "object") : SCHEMA)));
                } else {
                    enteredCall.countDown();
                    if ("disconnect".equals(mode)) { exchange.close(); return; }
                    if ("slow".equals(mode)) { try { Thread.sleep(3000); } catch (InterruptedException e) { Thread.currentThread().interrupt(); } }
                    if ("expire-call".equals(mode)) { exchange.sendResponseHeaders(404, -1); return; }
                    result = Map.of("content", List.of(Map.of("type", "text", "text", "synthetic result")), "isError", "tool-error".equals(mode));
                }
                String envelope = JSON.writeValueAsString(Map.of("jsonrpc", "2.0", "id", body.path("id").asText(), "result", result));
                if ("sse".equals(mode) && "tools/call".equals(method)) {
                    exchange.getResponseHeaders().set("Content-Type", "text/event-stream");
                    exchange.sendResponseHeaders(200, 0);
                    String stream = "event: message\ndata: {\"jsonrpc\":\"2.0\",\"method\":\"notifications/progress\",\"params\":{}}\n\n"
                            + "data: " + envelope + "\n\n";
                    exchange.getResponseBody().write(stream.getBytes(StandardCharsets.UTF_8)); exchange.getResponseBody().flush();
                    try { Thread.sleep(1500); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
                } else {
                    exchange.getResponseHeaders().set("Content-Type", "application/json");
                    byte[] bytes = envelope.getBytes(StandardCharsets.UTF_8);
                    exchange.sendResponseHeaders(200, bytes.length); exchange.getResponseBody().write(bytes);
                }
            } finally { exchange.close(); }
        });
        server.createContext("/trap", e -> { methods.add("TRAP"); e.sendResponseHeaders(500, -1); e.close(); });
        server.start();
    }
    @AfterEach void stop() { server.stop(0); executor.shutdownNow(); }
    private String url() { return "http://127.0.0.1:" + server.getAddress().getPort() + "/mcp"; }
    private PluginMcpHttpClient client() { return new PluginMcpHttpClient(new PluginMcpEndpointPolicy(true)); }
    private Map<String, Object> call(String token) { return client().call(url(), token, "echo", SCHEMA, Map.of("query", "synthetic"), () -> true); }

    @Test void explicitDiscoveryListsToolsWithoutExecutingAnyTool() {
        var tools = client().listTools(url(), "synthetic-token", () -> true);
        assertEquals(1, tools.size());
        assertEquals("echo", tools.get(0).get("name"));
        assertEquals(List.of("initialize", "notifications/initialized", "tools/list", "DELETE"), methods);
        assertFalse(methods.contains("tools/call"));
    }

    @Test void customHeadersReachOnlyTheConfiguredServerAndPreserveProtocolHeaders() {
        client().call(url(), "bearer", Map.of("X-Test-Key", "private-value"), "echo", SCHEMA, Map.of("query", "x"), () -> true);
        assertEquals(5, customHeaders.stream().filter("private-value"::equals).count());
        assertTrue(auth.stream().allMatch("Bearer bearer"::equals));
        mode = "redirect";
        assertThrows(PluginMcpException.class, () -> client().listTools(url(), "", Map.of("X-Test-Key", "private-value"), () -> true));
        assertFalse(methods.contains("TRAP"));
        assertThrows(PluginMcpException.class, () -> client().listTools(url(), "", Map.of("MCP-Session-Id", "forged"), () -> true));
    }
    @Test void publicServerLifecycleAndCleanup() {
        assertEquals(false, call("").get("isError"));
        assertEquals(List.of("initialize", "notifications/initialized", "tools/list", "tools/call", "DELETE"), methods);
        assertTrue(auth.stream().allMatch("null"::equals));
        assertTrue(sessions.stream().allMatch("session-1"::equals));
    }
    @Test void credentialsAndSessionsNeverSharedBetweenUsers() {
        call("alice-token"); call("bob-token");
        assertEquals(5, auth.stream().filter("Bearer alice-token"::equals).count());
        assertEquals(5, auth.stream().filter("Bearer bob-token"::equals).count());
        assertEquals(Set.of("session-1", "session-2"), new HashSet<>(sessions));
    }
    @Test void sessionExpiryDuringDiscoveryReinitializesOnce() {
        mode = "expire-discovery"; call("");
        assertEquals(2, Collections.frequency(methods, "initialize"));
        assertEquals(1, Collections.frequency(methods, "tools/call"));
    }
    @Test void ambiguousToolFailureNeverReplays() {
        mode = "disconnect";
        assertEquals("transport_error", assertThrows(PluginMcpException.class, () -> call("")).code());
        assertEquals(1, Collections.frequency(methods, "tools/call"));
        assertTrue(methods.contains("DELETE"));
    }
    @Test void sessionExpiryDuringCallIsNotReplayed() {
        mode = "expire-call";
        assertEquals("session_expired", assertThrows(PluginMcpException.class, () -> call("")).code());
        assertEquals(1, Collections.frequency(methods, "tools/call"));
    }
    @Test void sseReturnsAtMatchingResultWithoutWaitingForStreamClose() {
        mode = "sse"; long start = System.nanoTime(); call("");
        assertTrue(TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - start) < 1400);
    }
    @Test void schemaDriftFailsBeforeToolExecution() {
        mode = "schema-drift";
        assertEquals("schema_mismatch", assertThrows(PluginMcpException.class, () -> call("")).code());
        assertFalse(methods.contains("tools/call"));
    }
    @Test void redirectDoesNotLeakCredential() {
        mode = "redirect"; assertThrows(PluginMcpException.class, () -> call("secret"));
        assertFalse(methods.contains("TRAP"));
    }
    @Test void disableDuringBlockedReadCancelsAndCleansSession() throws Exception {
        mode = "slow"; AtomicBoolean allowed = new AtomicBoolean(true);
        Future<?> request = executor.submit(() -> client().call(url(), "", "echo", SCHEMA, Map.of("query", "x"), allowed::get));
        assertTrue(enteredCall.await(3, TimeUnit.SECONDS)); allowed.set(false);
        var e = assertThrows(ExecutionException.class, () -> request.get(2, TimeUnit.SECONDS));
        assertEquals("cancelled", ((PluginMcpException) e.getCause()).code());
        assertTrue(methods.contains("DELETE"));
    }
    @Test void toolErrorPreservesStructuredResult() { mode = "tool-error"; assertEquals(true, call("").get("isError")); }
    @Test void productionRejectsUnsafeUrlsBeforeNetwork() {
        for (String url : List.of(url(), "https://127.0.0.1/mcp", "https://[::1]/mcp", "https://169.254.169.254/mcp", "https://example.com/mcp?token=x", "https://user:pass@example.com/mcp"))
            assertThrows(PluginMcpException.class, () -> new PluginMcpHttpClient().call(url, "secret", "echo", SCHEMA, Map.of(), () -> true));
        assertTrue(methods.isEmpty());
    }
    @Test void productionDnsRejectsPrivateResolutionEvenForHostname() {
        assertThrows(java.net.UnknownHostException.class, () -> new PluginMcpEndpointPolicy().lookup("localhost"));
        assertTrue(methods.isEmpty());
    }
    @Test void interruptDuringBlockedReadPropagatesAndStopsTheRequest() throws Exception {
        mode = "slow";
        var result = new java.util.concurrent.atomic.AtomicReference<PluginMcpException>();
        Thread worker = new Thread(() -> {
            try { call(""); } catch (PluginMcpException failure) { result.set(failure); }
        });
        worker.start(); assertTrue(enteredCall.await(3, TimeUnit.SECONDS)); worker.interrupt(); worker.join(3000);
        assertFalse(worker.isAlive()); assertNotNull(result.get()); assertEquals("cancelled", result.get().code());
        assertEquals(1, Collections.frequency(methods, "tools/call"));
    }

}
