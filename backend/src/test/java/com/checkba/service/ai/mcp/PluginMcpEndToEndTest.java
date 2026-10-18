// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.ai.mcp;

import com.checkba.controller.AuthController;
import com.checkba.controller.ai.PluginMcpController;
import com.checkba.service.ProjectMemberService;
import com.checkba.service.SystemSettingService;
import com.checkba.service.account.AccountService;
import com.checkba.service.ai.*;
import com.checkba.service.ai.tools.ToolContext;
import com.checkba.service.plugin.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;

/** Real manifest, encrypted credentials, resolver, registry/controller and HTTP MCP protocol.
 * Only session/ACL/account providers and the exact fixture endpoint mapping are synthetic. */
class PluginMcpEndToEndTest {
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final String ENDPOINT = "https://service.example.invalid/mcp";
    private static final Map<String, Object> SCHEMA = Map.of("type", "object", "properties", Map.of("text", Map.of("type", "string")), "required", List.of("text"), "additionalProperties", false);
    @TempDir Path directory;
    final Map<String, String> database = new ConcurrentHashMap<>();
    final List<Map<String, String>> requests = new CopyOnWriteArrayList<>();
    final AtomicInteger sessionIds = new AtomicInteger();
    final AtomicBoolean cancelled = new AtomicBoolean();
    final CountDownLatch entered = new CountDownLatch(1), release = new CountDownLatch(1);
    HttpServer remote;
    ExecutorService executor;
    PluginService plugins;
    PluginConnectionService connections;
    PluginMcpService service;
    ToolRegistry registry;
    ProjectMemberService members;
    MockMvc mvc;
    volatile String mode = "normal";

    @BeforeEach void setup() throws Exception {
        remote = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        executor = Executors.newCachedThreadPool(); remote.setExecutor(executor);
        remote.createContext("/mcp", e -> {
            try {
                String method = e.getRequestMethod().equals("DELETE") ? "DELETE" : "";
                var body = method.isEmpty() ? JSON.readTree(e.getRequestBody()) : JSON.createObjectNode();
                if (method.isEmpty()) method = body.path("method").asText();
                requests.add(Map.of("method", method, "authorization", String.valueOf(e.getRequestHeaders().getFirst("Authorization")),
                        "session", String.valueOf(e.getRequestHeaders().getFirst("MCP-Session-Id")),
                        "protocol", String.valueOf(e.getRequestHeaders().getFirst("MCP-Protocol-Version"))));
                if (method.equals("DELETE")) { e.sendResponseHeaders(204, -1); return; }
                if (mode.equals("unauthorized")) { e.sendResponseHeaders(401, -1); return; }
                Object result;
                switch (method) {
                    case "initialize" -> {
                        e.getResponseHeaders().set("MCP-Session-Id", "fixture-" + sessionIds.incrementAndGet());
                        result = Map.of("protocolVersion", "2025-06-18", "capabilities", Map.of("tools", Map.of()), "serverInfo", Map.of("name", "fixture", "version", "1"));
                    }
                    case "notifications/initialized" -> { e.sendResponseHeaders(202, -1); return; }
                    case "tools/list" -> {
                        if (mode.equals("pagination") && !body.path("params").has("cursor")) result = Map.of("tools", List.of(), "nextCursor", "second");
                        else result = Map.of("tools", List.of(Map.of("name", "echo", "description", "Echo", "inputSchema", mode.equals("schema") ? Map.of("type", "object") : SCHEMA)));
                    }
                    case "tools/call" -> {
                        entered.countDown();
                        if (mode.equals("blocked")) try { release.await(20, TimeUnit.SECONDS); } catch (InterruptedException ignored) { Thread.currentThread().interrupt(); }
                        result = Map.of("content", List.of(Map.of("type", "text", "text", body.path("params").path("arguments").path("text").asText())), "isError", mode.equals("tool-error"));
                    }
                    default -> throw new AssertionError(method);
                }
                var envelope = Map.of("jsonrpc", "2.0", "id", body.path("id").asText(), "result", result);
                String content = JSON.writeValueAsString(envelope);
                boolean sse = mode.equals("sse") && method.equals("tools/call");
                if (sse) content = ": keepalive\n\ndata: {\"jsonrpc\":\"2.0\",\"method\":\"notifications/progress\"}\n\ndata: " + content + "\n\n";
                e.getResponseHeaders().set("Content-Type", sse ? "text/event-stream" : "application/json");
                byte[] bytes = content.getBytes(StandardCharsets.UTF_8);
                e.sendResponseHeaders(200, bytes.length); e.getResponseBody().write(bytes);
            } finally { e.close(); }
        }); remote.start();
        SystemSettingService settings = mock(SystemSettingService.class);
        when(settings.get(anyString(), nullable(String.class))).thenAnswer(i -> database.getOrDefault(i.getArgument(0), i.getArgument(1)));
        doAnswer(i -> { database.put(i.getArgument(0), i.getArgument(1)); return null; }).when(settings).set(anyString(), anyString());
        Path plugin = directory.resolve("plugins/qa-plugin"); Files.createDirectories(plugin);
        Files.writeString(plugin.resolve("manifest.json"), JSON.writeValueAsString(Map.of("id", "qa-plugin", "name", "QA", "version", "1.0.0", "permissions", List.of("network"),
                "contributes", Map.of("connections", List.of(Map.of("id", "example-provider", "label", "Fixture", "baseUrl", "https://service.example.invalid", "auth", Map.of("type", "bearer"), "operations", Map.of("text", Map.of("path", "/query", "method", "POST")))),
                "mcpServers", List.of(Map.of("id", "one", "transport", "streamable-http", "url", ENDPOINT, "connectionId", "example-provider", "tools", List.of(Map.of("name", "echo", "description", "Echo", "inputSchema", SCHEMA))))))));
        plugins = new PluginService(settings, directory.resolve("plugins").toString()); plugins.init();
        members = mock(ProjectMemberService.class); when(members.hasWritePermission(7L, 8L)).thenReturn(true); when(members.hasWritePermission(7L, 9L)).thenReturn(true);
        var store = new PluginCredentialStore(settings, directory.resolve("credential.key").toString());
        connections = new PluginConnectionService(plugins, store, mock(AccountService.class), "http://localhost:9696/api/plugins/oauth/callback");
        var client = new PluginMcpFixtureHttpClient(remote.getAddress().getPort());
        service = new PluginMcpService(plugins, members, settings, client);
        service.setCredentialResolver(new PluginConnectionMcpCredentials(connections, plugins, settings));
        var capabilities = mock(ClientCapabilityService.class); when(capabilities.isToolVisible(anyString(), nullable(String.class))).thenReturn(true);
        registry = new ToolRegistry(List.of(), plugins, capabilities); registry.setPluginMcpService(service); registry.init();
        mvc = MockMvcBuilders.standaloneSetup(new PluginMcpController(service)).build();
    }
    @AfterEach void cleanup() { release.countDown(); remote.stop(0); executor.shutdownNow(); }
    ToolContext context() { return new ToolContext(7L, "fixture", 8L, null, List.of(), null, "run", null, cancelled::get); }
    Map<String, Object> call() { return service.call("qa-plugin", "one", "echo", Map.of("text", "synthetic"), context()); }
    void connect() { connections.connect("qa-plugin", 8L, "example-provider", "synthetic-bearer-a"); }

    @Test void encryptedCredentialReachesRealHttpThroughControllerAndAgentRegistry() throws Exception {
        connect();
        assertTrue(database.values().stream().noneMatch(v -> v.contains("synthetic-bearer-a")));
        try (var auth = mockStatic(AuthController.class)) {
            auth.when(() -> AuthController.getUserIdFromSession("fixture-session")).thenReturn(8L);
            var response = mvc.perform(post("/api/plugins/qa-plugin/mcp/call").header("X-Session-Id", "fixture-session").contentType("application/json")
                    .content("{\"serverId\":\"one\",\"name\":\"echo\",\"arguments\":{\"text\":\"controller\"},\"projectId\":7}")).andReturn().getResponse();
            assertEquals(200, response.getStatus()); assertTrue(response.getContentAsString().contains("controller"));
        }
        String name = registry.getAllSpecifications().get(0).name();
        var result = registry.execute(name, "{\"text\":\"agent\"}", context());
        assertTrue(result.success()); assertTrue(result.output().contains("agent"));
        assertEquals(10, requests.size());
        assertTrue(requests.stream().allMatch(r -> r.get("authorization").equals("Bearer synthetic-bearer-a")));
        assertTrue(requests.stream().filter(r -> !r.get("method").equals("initialize")).allMatch(r -> r.get("protocol").equals("2025-06-18")));
        assertEquals(2, sessionIds.get());
        plugins.setEnabled("qa-plugin", false); assertTrue(registry.getAllSpecifications().isEmpty());
        assertFalse(registry.execute(name, "{\"text\":\"no\"}", context()).found()); assertEquals(10, requests.size());
    }
    @Test void usersHaveSeparateEncryptedCredentialsAndSessions() {
        connect(); connections.connect("qa-plugin", 9L, "example-provider", "synthetic-bearer-b"); call();
        service.call("qa-plugin", "one", "echo", Map.of("text", "other"), new ToolContext(7L, "fixture", 9L, null));
        assertEquals(5, requests.stream().filter(r -> r.get("authorization").equals("Bearer synthetic-bearer-a")).count());
        assertEquals(5, requests.stream().filter(r -> r.get("authorization").equals("Bearer synthetic-bearer-b")).count());
        assertEquals(2, sessionIds.get());
    }
    @Test void missingCredentialAndWrongAclOrSchemaNeverReachHttp() {
        assertEquals("authentication_required", assertThrows(PluginMcpException.class, this::call).code()); connect();
        when(members.hasWritePermission(7L, 8L)).thenReturn(false);
        assertEquals("permission_denied", assertThrows(PluginMcpException.class, this::call).code());
        when(members.hasWritePermission(7L, 8L)).thenReturn(true);
        assertEquals("invalid_arguments", assertThrows(PluginMcpException.class, () -> service.call("qa-plugin", "one", "echo", Map.of("text", 42), context())).code());
        assertTrue(requests.isEmpty());
    }
    @Test void remote401IsRecognizableAndNeverLeaksToken() {
        connect(); mode = "unauthorized";
        var error = assertThrows(PluginMcpException.class, this::call);
        assertEquals("authentication_required", error.code()); assertFalse(error.getMessage().contains("synthetic-bearer")); assertEquals(1, requests.size());
    }
    @Test void reviewedSchemaDriftPreventsExecution() {
        connect(); mode = "schema";
        assertEquals("schema_mismatch", assertThrows(PluginMcpException.class, this::call).code());
        assertTrue(requests.stream().noneMatch(r -> r.get("method").equals("tools/call")));
    }
    @Test void realPaginatedDiscoveryAndSseBothWork() {
        connect(); mode = "pagination"; call(); assertEquals(2, requests.stream().filter(r -> r.get("method").equals("tools/list")).count());
        mode = "sse"; assertTrue(call().toString().contains("synthetic"));
        mode = "tool-error"; assertTrue(registry.execute(registry.getAllSpecifications().get(0).name(), "{\"text\":\"bad\"}", context()).output().startsWith("Error:"));
    }
    @Test void realSocketReadTimeoutDoesNotReplayTool() {
        connect(); mode = "blocked";
        var error = assertThrows(PluginMcpException.class, this::call);
        assertEquals("transport_error", error.code());
        assertEquals(1, requests.stream().filter(r -> r.get("method").equals("tools/call")).count());
        assertTrue(requests.stream().anyMatch(r -> r.get("method").equals("DELETE")));
    }
    @Test void registryRevocationDuringHttpReadSuppressesResult() throws Exception {
        assertBlockedResult(v -> plugins.applyRevocations(Map.of("qa-plugin", "synthetic review revocation")));
    }
    @Test void projectAclRevocationDuringHttpReadSuppressesResult() throws Exception {
        assertBlockedResult(v -> when(members.hasWritePermission(7L, 8L)).thenReturn(false));
    }
    @Test void fixtureMapperRejectsOtherPublicOriginsBeforeAnyHttp() {
        var client = new PluginMcpFixtureHttpClient(remote.getAddress().getPort());
        assertThrows(IllegalArgumentException.class, () -> client.call("https://other.example.invalid/mcp", "synthetic", "echo", SCHEMA, Map.of("text", "no"), () -> true));
        assertTrue(requests.isEmpty());
    }
    @Test void cancelDuringHttpReadSuppressesResult() throws Exception { assertBlockedResult(cancelled::set); }
    @Test void disableDuringHttpReadSuppressesResult() throws Exception { assertBlockedResult(v -> plugins.setEnabled("qa-plugin", false)); }
    @Test void disconnectDuringHttpReadSuppressesResult() throws Exception { assertBlockedResult(v -> connections.disconnect("qa-plugin", 8L, "example-provider")); }
    @Test void permissionRevocationDuringHttpReadSuppressesResult() throws Exception { assertBlockedResult(v -> plugins.getPlugin("qa-plugin").setPermissions(List.of())); }
    private void assertBlockedResult(java.util.function.Consumer<Boolean> revoke) throws Exception {
        connect(); mode = "blocked"; Future<?> pending = executor.submit(this::call);
        assertTrue(entered.await(3, TimeUnit.SECONDS)); revoke.accept(true);
        var error = assertThrows(ExecutionException.class, () -> pending.get(3, TimeUnit.SECONDS));
        assertEquals("cancelled", ((PluginMcpException) error.getCause()).code());
        release.countDown(); assertEquals(1, requests.stream().filter(r -> r.get("method").equals("tools/call")).count());
        assertTrue(requests.stream().anyMatch(r -> r.get("method").equals("DELETE")));
    }
}
