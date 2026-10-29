// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.ai.mcp;

import com.checkba.service.*;
import com.checkba.service.account.AccountService;
import com.checkba.service.ai.tools.ToolContext;
import com.checkba.service.plugin.PluginCredentialStore;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.test.util.ReflectionTestUtils;
import java.nio.file.Path;
import java.util.*;
import java.util.function.BooleanSupplier;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;

class UserMcpAdvancedConnectionTest {
    @TempDir Path dir;
    final ObjectMapper json = new ObjectMapper();
    final Map<String, String> store = new HashMap<>();
    UserMcpConnectionService service;
    PluginCredentialStore credentials;
    PluginMcpHttpClient http;
    UserMcpStdioClient stdio;
    UserMcpOAuthService oauth;
    AccountService account;
    String scope;
    static final List<Map<String, Object>> TOOLS = List.of(Map.of("name", "echo", "inputSchema", Map.of("type", "object")));
    @BeforeEach void setup() {
        var settings = mock(SystemSettingService.class);
        when(settings.get(anyString(), nullable(String.class))).thenAnswer(i -> store.getOrDefault(i.getArgument(0), i.getArgument(1)));
        doAnswer(i -> { store.put(i.getArgument(0), i.getArgument(1)); return null; }).when(settings).set(anyString(), anyString());
        account = mock(AccountService.class); when(account.accountFingerprintOrNull()).thenReturn("account-A");
        var members = mock(ProjectMemberService.class); when(members.hasWritePermission(7L, 8L)).thenReturn(true);
        http = mock(PluginMcpHttpClient.class); when(http.listTools(anyString(), anyString(), any())).thenReturn(TOOLS);
        credentials = new PluginCredentialStore(settings, dir.resolve("key").toString());
        service = new UserMcpConnectionService(settings, credentials, account, members, http);
        stdio = mock(UserMcpStdioClient.class); when(stdio.available()).thenReturn(true); when(stdio.listTools(any(), any())).thenReturn(TOOLS);
        oauth = mock(UserMcpOAuthService.class); when(oauth.status(anyString(), anyString(), any(), any())).thenReturn(Map.of("connected", false));
        ReflectionTestUtils.setField(service, "stdio", stdio); ReflectionTestUtils.setField(service, "oauth", oauth);
        scope = (String) service.snapshot(8L).get("scopeToken");
    }
    UserMcpConnectionService.Update update(String text) throws Exception { return json.readValue(text, UserMcpConnectionService.Update.class); }
    String create(String text) throws Exception { return (String) service.save(8L, null, update(text), scope).get("id"); }
    Map<String, Object> row(String id) { return service.list(8L).stream().filter(r -> id.equals(r.get("id"))).findFirst().orElseThrow(); }

    @Test void unsavedOAuthPresetIsListableWithRealOAuthService() {
        ReflectionTestUtils.setField(service, "oauth", new UserMcpOAuthService(credentials, ""));
        assertEquals(6, service.list(8L).size());
        assertEquals(false, ((Map<?, ?>) row("notion").get("oauthStatus")).get("connected"));
    }
    @Test void realConfiguredStdioServiceReachesAiInvocationAndTerminates() throws Exception {
        ReflectionTestUtils.setField(service, "stdio", new UserMcpStdioClient(true));
        List<String> paths = new ArrayList<>();
        for (Class<?> type : List.of(com.checkba.service.ai.mcp.fixture.UserMcpStdioFixture.class, ObjectMapper.class,
                com.fasterxml.jackson.core.JsonFactory.class, com.fasterxml.jackson.annotation.JsonInclude.class))
            paths.add(Path.of(type.getProtectionDomain().getCodeSource().getLocation().toURI()).toString());
        Path trace = dir.resolve("process-trace");
        String id = create(json.writeValueAsString(Map.of("name", "Real local fixture", "transport", "stdio",
                "command", Path.of(System.getProperty("java.home"), "bin", System.getProperty("os.name").startsWith("Windows") ? "java.exe" : "java").toString(), "args", List.of("-cp", String.join(java.io.File.pathSeparator, paths),
                        com.checkba.service.ai.mcp.fixture.UserMcpStdioFixture.class.getName(), "normal", trace.toString()),
                "env", Map.of("SYNTHETIC_MCP_TOKEN", "integration-env"), "cwd", dir.toString(), "timeoutSeconds", 5)));
        service.test(8L, id, scope, true, (Long) row(id).get("revision")); service.enable(8L, id, true, scope);
        String name = service.bindings(8L).get(0).specification().name();
        String result = service.callAgent(name, Map.of("argumentsJson", "{\"query\":\"真实进程集成\"}"), new ToolContext(7L, "chat", 8L, null, List.of(), Set.of(name)));
        assertTrue(result.contains("真实进程集成")); assertTrue(result.contains("integration-env"));
        assertEquals(1, java.nio.file.Files.readAllLines(trace).stream().filter("tools/call"::equals).count());
        long pid = Long.parseLong(java.nio.file.Files.readString(Path.of(trace + ".pid")));
        assertFalse(ProcessHandle.of(pid).map(ProcessHandle::isAlive).orElse(false));
    }
    @Test void importPreviewMasksSecretsAndSelectedImportNeverRunsOrOverwrites() throws Exception {
        String config = """
                {"mcpServers":{"A":{"url":"https://example.com/mcp","headers":{"Authorization":"Bearer secret-bearer","X-Key":"secret-header"}},
                "B":{"command":"python3","args":["server.py"],"env":{"API_KEY":"secret-env"}},"Bad":{"type":"sse","url":"https://example.com/sse"}}}
                """;
        String preview = json.writeValueAsString(service.previewImport(8L, config, scope));
        assertFalse(preview.contains("secret-bearer")); assertFalse(preview.contains("secret-header")); assertFalse(preview.contains("secret-env"));
        assertTrue(preview.contains("env.API_KEY")); assertTrue(preview.contains("Bad"));
        var imported = service.importConnections(8L, config, List.of(0, 1), scope);
        assertEquals(2, ((List<?>) imported.get("connections")).size());
        var a = service.list(8L).stream().filter(r -> "A".equals(r.get("name"))).findFirst().orElseThrow();
        assertEquals("bearer", a.get("authType")); assertEquals(false, a.get("enabled")); assertEquals(false, a.get("tested"));
        assertFalse(store.values().stream().anyMatch(s -> s.contains("secret-")));
        service.importConnections(8L, config, List.of(0), scope);
        assertEquals(2, service.list(8L).stream().filter(r -> "A".equals(r.get("name"))).count());
        verifyNoInteractions(http); verify(stdio, never()).listTools(any(), any()); verify(oauth, never()).authorize(anyString(), anyString(), any(), any());
    }
    @Test void strictImportRejectsDuplicatesTrailingVariablesAndSelectedInvalidWithoutWrites() {
        for (String malformed : List.of("{\"servers\":{\"A\":{},\"A\":{}}}", "{\"servers\":{}} {}", "{\"mcpServers\":{},\"servers\":{}}"))
            assertThrows(PluginMcpException.class, () -> service.previewImport(8L, malformed, scope));
        String variable = "{\"servers\":{\"A\":{\"url\":\"https://example.com/mcp\",\"token\":\"${env:SECRET}\"}}}";
        assertEquals(1, ((List<?>) service.previewImport(8L, variable, scope).get("errors")).size());
        String mixed = "{\"servers\":{\"A\":{\"url\":\"https://example.com/mcp\"},\"B\":{\"url\":\"http://localhost/mcp\"}}}";
        Map<String, String> before = new HashMap<>(store);
        assertThrows(PluginMcpException.class, () -> service.importConnections(8L, mixed, List.of(0, 1), scope));
        assertEquals(before, store);
        assertThrows(PluginMcpException.class, () -> service.importConnections(8L, mixed, List.of(0, 0), scope));
        when(account.accountFingerprintOrNull()).thenReturn("account-B");
        assertEquals("account_changed", assertThrows(PluginMcpException.class, () -> service.importConnections(8L, mixed, List.of(0), scope)).code());
    }
    @Test void localConfigurationRequiresExplicitTrustAndEditsRevokeItWithoutPaidFallback() throws Exception {
        String id = create("{\"name\":\"Local\",\"transport\":\"stdio\",\"command\":\"python3\",\"args\":[\"server.py\"],\"env\":{\"KEY\":\"env-secret\"}}");
        assertEquals("local_approval_required", assertThrows(PluginMcpException.class, () -> service.test(8L, id, scope)).code());
        service.test(8L, id, scope, true, (Long) row(id).get("revision")); service.enable(8L, id, true, scope);
        assertEquals(true, row(id).get("localApproved"));
        var binding = service.bindings(8L).get(0);
        when(stdio.call(any(), eq("echo"), anyMap(), anyMap(), any())).thenReturn(Map.of("content", List.of(Map.of("type", "text", "text", "called"))));
        String name = binding.specification().name();
        assertTrue(service.callAgent(name, Map.of("argumentsJson", "{}"), new ToolContext(7L, "chat", 8L, null, List.of(), Set.of(name))).contains("called"));
        service.save(8L, id, update("{\"args\":[\"different.py\"]}"), scope);
        assertEquals(true, row(id).get("enabled")); assertEquals(false, row(id).get("tested")); assertEquals(false, row(id).get("localApproved"));
        assertTrue(service.bindings(8L).isEmpty());
        verify(stdio).listTools(argThat(c -> "env-secret".equals(c.env().get("KEY"))), any());
    }
    @Test void staleLocalApprovalCannotRunAnUpdatedCommand() throws Exception {
        String id = create("{\"name\":\"Local\",\"transport\":\"stdio\",\"command\":\"python3\",\"args\":[\"reviewed.py\"]}");
        Long seen = (Long) row(id).get("revision");
        service.save(8L, id, update("{\"args\":[\"changed.py\"]}"), scope);
        assertEquals("connection_changed", assertThrows(PluginMcpException.class, () -> service.test(8L, id, scope, true, seen)).code());
        assertEquals(false, row(id).get("localApproved")); verify(stdio, never()).listTools(any(), any());
    }
    @Test void serverModeCannotTestOrEnableLocalCommands() throws Exception {
        String id = create("{\"name\":\"Local\",\"transport\":\"stdio\",\"command\":\"python3\"}");
        when(stdio.available()).thenReturn(false);
        assertEquals(false, service.snapshot(8L).get("stdioAvailable"));
        assertEquals("stdio_unavailable", assertThrows(PluginMcpException.class, () -> service.test(8L, id, scope, true, (Long) row(id).get("revision"))).code());
        verify(stdio, never()).listTools(any(), any());
    }
    @Test void encryptedHeadersAreMergedRemovedAndNeverForwardedAcrossEndpoints() throws Exception {
        String id = create("{\"name\":\"HTTP\",\"url\":\"https://example.com/mcp\",\"headers\":{\"X-Key\":\"secret-value\",\"X-Empty\":\"\"}}");
        when(http.listTools(anyString(), anyString(), anyMap(), any())).thenReturn(TOOLS);
        service.test(8L, id, scope);
        verify(http).listTools(eq("https://example.com/mcp"), eq(""), eq(Map.of("x-key", "secret-value", "x-empty", "")), any());
        assertFalse(json.writeValueAsString(row(id)).contains("secret-value"));
        service.save(8L, id, update("{\"headers\":{\"x-Empty\":null}}"), scope);
        assertEquals(Set.of("x-key"), row(id).get("headerNames"));
        service.save(8L, id, update("{\"url\":\"https://other.example/mcp\"}"), scope);
        assertEquals(Set.of(), row(id).get("headerNames")); service.test(8L, id, scope);
        verify(http).listTools(eq("https://other.example/mcp"), eq(""), any());
        for (String header : List.of("Host", "MCP-Session-Id", "Origin")) {
            assertThrows(PluginMcpException.class, () -> create("{\"name\":\"Bad\",\"url\":\"https://example.com\",\"headers\":{\"" + header + "\":\"bad\"}}"));
        }
    }
    @Test void oauthUsesCurrentTokenForDiscoveryAndActualAiCallAndFailsWithoutReplay() throws Exception {
        String id = create("{\"name\":\"OAuth\",\"url\":\"https://example.com/mcp\",\"authType\":\"oauth2\",\"oauthScopes\":[\"read\"]}");
        when(oauth.authorize(anyString(), anyString(), any(), any())).thenReturn(Map.of("authorizationUrl", "https://example.com/authorize"));
        service.authorize(8L, id, scope); when(oauth.accessToken(anyString(), anyString(), any(), any())).thenReturn("oauth-access");
        service.test(8L, id, scope); service.enable(8L, id, true, scope);
        verify(http).listTools(eq("https://example.com/mcp"), eq("oauth-access"), any());
        String name = service.bindings(8L).get(0).specification().name();
        var ctx = new ToolContext(7L, "chat", 8L, null, List.of(), Set.of(name));
        when(http.call(anyString(), anyString(), anyString(), anyMap(), anyMap(), any())).thenThrow(new PluginMcpException("authentication_required", 403, "synthetic"));
        assertThrows(PluginMcpException.class, () -> service.callAgent(name, Map.of("argumentsJson", "{}"), ctx));
        verify(http, times(1)).call(eq("https://example.com/mcp"), eq("oauth-access"), eq("echo"), anyMap(), anyMap(), any());
        verify(oauth).needsReconnect("mcp." + scope + "." + id + ".oauth");
        service.disconnectOAuth(8L, id, scope);
        assertEquals(true, row(id).get("enabled")); assertEquals(false, row(id).get("tested"));
        assertTrue(service.bindings(8L).isEmpty());
    }
    @Test void oldBearerRowsMigrateOnlyOnSaveAndRetainTheirTools() throws Exception {
        String id = "custom-legacy";
        credentials.put("mcp." + scope + "." + id, "legacy-secret");
        store.put("mcp.user." + scope, "{\"" + id + "\":{\"id\":\"" + id + "\",\"name\":\"Legacy\",\"url\":\"https://example.com/mcp\",\"transport\":\"streamable-http\",\"enabled\":true,\"configured\":true,\"tested\":true,\"revision\":1,\"tools\":[]}}");
        service.test(8L, id, scope); verify(http).listTools(eq("https://example.com/mcp"), eq("legacy-secret"), any());
        service.save(8L, id, update("{\"name\":\"Renamed\"}"), scope);
        assertEquals(true, row(id).get("tested")); assertEquals("", credentials.get("mcp." + scope + "." + id));
        assertTrue(credentials.get("mcp." + scope + "." + id + ".settings").contains("legacy-secret"));
    }
}
