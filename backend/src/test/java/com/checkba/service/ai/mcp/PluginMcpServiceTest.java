// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.ai.mcp;

import com.checkba.service.ProjectMemberService;
import com.checkba.service.SystemSettingService;
import com.checkba.service.ai.*;
import com.checkba.service.ai.tools.ToolContext;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import java.nio.file.*;
import java.util.*;
import java.util.function.BooleanSupplier;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;

class PluginMcpServiceTest {
    @TempDir Path dir;
    PluginService plugins;
    ProjectMemberService members;
    SystemSettingService settings;
    PluginMcpHttpClient http;
    PluginMcpService mcp;
    ToolRegistry registry;
    private final Map<String, String> store = new HashMap<>();
    private static final String MANIFEST = """
        {"id":"qa-plugin","name":"QA","version":"1.0.0","permissions":["network"],
         "settings":[{"key":"apiKey","type":"string","secret":true}],
         "contributes":{"mcpServers":[{"id":"one","transport":"streamable-http","url":"https://example.com/mcp",
           "tools":[{"name":"echo","description":"Echo synthetic text","inputSchema":{"type":"object","properties":{"query":{"type":"string"}},"required":["query"],"additionalProperties":false}}]}]}}
        """;
    @BeforeEach void setup() throws Exception {
        settings = mock(SystemSettingService.class);
        when(settings.get(anyString(), nullable(String.class))).thenAnswer(i -> store.getOrDefault(i.getArgument(0), i.getArgument(1)));
        doAnswer(i -> { store.put(i.getArgument(0), i.getArgument(1)); return null; }).when(settings).set(anyString(), anyString());
        Files.createDirectories(dir.resolve("qa-plugin")); Files.writeString(dir.resolve("qa-plugin/manifest.json"), MANIFEST);
        plugins = new PluginService(settings, dir.toString()); plugins.init();
        members = mock(ProjectMemberService.class); when(members.hasWritePermission(7L, 8L)).thenReturn(true);
        http = mock(PluginMcpHttpClient.class);
        when(http.call(anyString(), anyString(), anyString(), anyMap(), anyMap(), any())).thenReturn(Map.of("content", List.of(Map.of("type", "text", "text", "ok"))));
        mcp = new PluginMcpService(plugins, members, settings, http);
        ClientCapabilityService capabilities = mock(ClientCapabilityService.class);
        when(capabilities.isToolVisible(anyString(), nullable(String.class))).thenReturn(true);
        registry = new ToolRegistry(List.of(), plugins, capabilities); registry.setPluginMcpService(mcp); registry.init();
    }
    private PluginService.McpServerDecl server() { return plugins.getPlugin("qa-plugin").getContributes().getMcpServers().get(0); }
    private ToolContext context() { return new ToolContext(7L, "conversation", 8L, null); }
    @Test void agentRegistryReallyOffersAndExecutesThenRevokes() {
        String name = registry.getAllSpecifications().get(0).name();
        assertTrue(registry.pluginToolNames().contains(name)); assertTrue(registry.toolNamesLongestFirst().contains(name));
        assertTrue(registry.execute(name, "{\"query\":\"hello\"}", context()).success());
        verify(http).call(eq("https://example.com/mcp"), eq(""), eq("echo"), anyMap(), eq(Map.of("query", "hello")), any());
        plugins.setEnabled("qa-plugin", false);
        assertTrue(registry.getAllSpecifications().isEmpty()); assertFalse(registry.resolve(name).isPresent());
        assertFalse(registry.execute(name, "{}", context()).found());
        plugins.setEnabled("qa-plugin", true); assertTrue(registry.hasTool(name));
        plugins.applyRevocations(Map.of("qa-plugin", "fixture revoked")); assertFalse(registry.hasTool(name));
    }
    @Test void identityAndProjectAclCannotBeForgedInArguments() {
        assertEquals("not_authenticated", assertThrows(PluginMcpException.class, () -> mcp.call("qa-plugin", "one", "echo", Map.of(), new ToolContext(7L, null, null, null))).code());
        assertEquals("permission_denied", assertThrows(PluginMcpException.class, () -> mcp.call("qa-plugin", "one", "echo", Map.of(), new ToolContext(99L, null, 8L, null))).code());
        assertThrows(PluginMcpException.class, () -> mcp.call("qa-plugin", "one", "echo", Map.of("query", "x", "userId", 8), context()));
        verifyNoInteractions(http);
    }
    @Test void undeclaredServerToolAndSchemaViolationsNeverCallNetwork() {
        for (Map<String, Object> args : List.<Map<String, Object>>of(Map.of(), Map.of("query", 5), Map.of("query", "x", "extra", true)))
            assertThrows(PluginMcpException.class, () -> mcp.call("qa-plugin", "one", "echo", args, context()));
        assertThrows(PluginMcpException.class, () -> mcp.call("qa-plugin", "other", "echo", Map.of("query", "x"), context()));
        assertThrows(PluginMcpException.class, () -> mcp.call("qa-plugin", "one", "undeclared", Map.of("query", "x"), context()));
        verifyNoInteractions(http);
    }
    @Test void onlyOwnDeclaredSecretCanBeResolved() {
        server().setCredentialKey("external.host.token");
        assertThrows(PluginMcpException.class, () -> mcp.servers("qa-plugin", 8L, 7L));
        assertTrue(mcp.bindings().isEmpty());
        server().setCredentialKey("apiKey"); store.put("plugin.qa-plugin.apiKey", "fixture-token");
        mcp.call("qa-plugin", "one", "echo", Map.of("query", "x"), context());
        verify(http).call(anyString(), eq("fixture-token"), anyString(), anyMap(), anyMap(), any());
        assertFalse(mcp.servers("qa-plugin", 8L, 7L).toString().contains("fixture-token"));
    }
    @Test void userConnectionNeverFallsBackToInstallationToken() {
        server().setConnectionId("primary"); server().setCredentialKey("apiKey"); store.put("plugin.qa-plugin.apiKey", "legacy-secret");
        assertThrows(PluginMcpException.class, () -> mcp.call("qa-plugin", "one", "echo", Map.of("query", "x"), context()));
        mcp.setCredentialResolver((plugin, user, connection, key) -> plugin + ":" + user + ":" + connection);
        mcp.call("qa-plugin", "one", "echo", Map.of("query", "x"), context());
        verify(http).call(anyString(), eq("qa-plugin:8:primary"), anyString(), anyMap(), anyMap(), any());
    }
    @Test void liveGuardRejectsDisableAndRescan() {
        var guard = org.mockito.ArgumentCaptor.forClass(BooleanSupplier.class);
        mcp.call("qa-plugin", "one", "echo", Map.of("query", "x"), context());
        verify(http).call(anyString(), anyString(), anyString(), anyMap(), anyMap(), guard.capture());
        assertTrue(guard.getValue().getAsBoolean()); plugins.rescan(); assertFalse(guard.getValue().getAsBoolean());
    }
    @Test void devInstallAndMissingNetworkRemainDenied() throws Exception {
        Files.writeString(dir.resolve("qa-plugin/.awd-dev"), "{}"); plugins.rescan(); assertTrue(mcp.bindings().isEmpty());
        assertThrows(PluginMcpException.class, () -> mcp.servers("qa-plugin", 8L, 7L));
        Files.delete(dir.resolve("qa-plugin/.awd-dev")); plugins.rescan();
        plugins.getPlugin("qa-plugin").setPermissions(List.of()); assertTrue(mcp.bindings().isEmpty());
    }
    @Test void explicitDevelopmentApprovalEnablesToolsAndRevocationDisablesLiveCalls() throws Exception {
        Files.writeString(dir.resolve("qa-plugin/.awd-dev"), "{}"); plugins.rescan();
        assertTrue(mcp.bindings().isEmpty());
        com.checkba.service.ai.PluginDevTrustService.setTrusted(plugins, "qa-plugin", true);
        assertFalse(mcp.bindings().isEmpty());
        var guard = org.mockito.ArgumentCaptor.forClass(BooleanSupplier.class);
        mcp.call("qa-plugin", "one", "echo", Map.of("query", "x"), context());
        verify(http).call(anyString(), anyString(), anyString(), anyMap(), anyMap(), guard.capture());
        assertTrue(guard.getValue().getAsBoolean());
        com.checkba.service.ai.PluginDevTrustService.setTrusted(plugins, "qa-plugin", false);
        assertTrue(mcp.bindings().isEmpty());
        assertFalse(guard.getValue().getAsBoolean());
    }
    @Test void namespaceIncludesPluginServerAndToolAndFitsProviderLimit() {
        String a = PluginMcpService.agentName("plugin-a", "one", "echo");
        assertNotEquals(a, PluginMcpService.agentName("plugin-b", "one", "echo"));
        assertNotEquals(a, PluginMcpService.agentName("plugin-a", "two", "echo"));
        assertTrue(PluginMcpService.agentName("plugin-a", "two", "x".repeat(128)).length() <= 64);
    }
    @Test void unsupportedSchemaConstraintsFailClosed() {
        server().getTools().get(0).getInputSchema().put("oneOf", List.of(Map.of("type", "string")));
        assertTrue(mcp.bindings().isEmpty());
    }
    @Test void xmlFallbackUsesSchemaNamesAndTypesWithoutJavaMethod() {
        var schema = server().getTools().get(0).getInputSchema();
        Map<String, Object> properties = new LinkedHashMap<>();
        properties.put("query", Map.of("type", "string"));
        properties.put("count", Map.of("type", "integer"));
        properties.put("enabled", Map.of("type", "boolean"));
        properties.put("projectId", Map.of("type", "string"));
        schema.put("properties", properties); schema.put("required", List.of("query", "count", "enabled", "projectId"));
        String name = registry.getAllSpecifications().get(0).name();
        XmlToolCallParser parser = new XmlToolCallParser(registry);
        for (String expression : List.of(
                name + "('text', 3, true, 'external-project')",
                name + "(query='text', count=3, enabled=true, projectId='external-project')")) {
            var parsed = parser.parse("<tool_code>" + expression + "</tool_code>").get(0);
            assertNull(parsed.parseError());
            assertTrue(registry.execute(parsed.toolName(), parsed.argsJson(), context()).success(), parsed.argsJson());
        }
        verify(http, times(2)).call(anyString(), anyString(), anyString(), anyMap(),
                eq(Map.of("query", "text", "count", 3, "enabled", true, "projectId", "external-project")), any());
    }
    @Test void nonObjectSchemasAndUserScopedLegacySecretsAreNotOffered() {
        var tool = server().getTools().get(0);
        tool.setInputSchema(Map.of("type", "array", "items", Map.of("type", "string")));
        assertTrue(mcp.bindings().isEmpty());
        assertEquals("invalid_schema", assertThrows(PluginMcpException.class, () -> mcp.servers("qa-plugin", 8L, 7L)).code());
        tool.setInputSchema(Map.of("type", "object", "properties", Map.of()));
        server().setCredentialKey("apiKey");
        plugins.getPlugin("qa-plugin").getSettings().get(0).setScope("user");
        assertTrue(mcp.bindings().isEmpty());
        assertThrows(PluginMcpException.class, () -> mcp.call("qa-plugin", "one", "echo", Map.of(), context()));
        verifyNoInteractions(http);
    }

}
