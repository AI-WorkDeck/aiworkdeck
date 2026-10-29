// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.ai.mcp;

import com.checkba.service.*;
import com.checkba.service.account.AccountService;
import com.checkba.service.ai.*;
import com.checkba.service.ai.tools.ToolContext;
import com.checkba.service.legal.PkulawChannel;
import com.checkba.service.platform.*;
import com.checkba.service.plugin.PluginCredentialStore;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.test.util.ReflectionTestUtils;
import java.nio.file.Path;
import java.util.*;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.BooleanSupplier;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;

class UserMcpConnectionServiceTest {
    @TempDir Path dir;
    final Map<String, String> store = new HashMap<>();
    SystemSettingService settings;
    AccountService account;
    ProjectMemberService members;
    PluginMcpHttpClient http;
    UserMcpConnectionService service;
    Map<String, List<Map<String, Object>>> official;
    static final Map<String, Object> SIMPLE = Map.of("name", "echo", "description", "Echo", "inputSchema",
            Map.of("type", "object", "properties", Map.of("query", Map.of("type", "string")), "required", List.of("query"), "additionalProperties", false));
    @BeforeEach void setup() throws Exception {
        settings = mock(SystemSettingService.class);
        when(settings.get(anyString(), nullable(String.class))).thenAnswer(i -> store.getOrDefault(i.getArgument(0), i.getArgument(1)));
        doAnswer(i -> { store.put(i.getArgument(0), i.getArgument(1)); return null; }).when(settings).set(anyString(), anyString());
        account = mock(AccountService.class); when(account.accountFingerprintOrNull()).thenReturn("account-A");
        members = mock(ProjectMemberService.class); when(members.hasWritePermission(7L, 8L)).thenReturn(true);
        http = mock(PluginMcpHttpClient.class);
        when(http.listTools(anyString(), anyString(), any())).thenReturn(List.of(SIMPLE));
        when(http.call(anyString(), anyString(), anyString(), anyMap(), anyMap(), any())).thenReturn(Map.of("content", List.of(Map.of("type", "text", "text", "synthetic result"))));
        service = new UserMcpConnectionService(settings, new PluginCredentialStore(settings, dir.resolve("key").toString()), account, members, http);
        official = new ObjectMapper().readValue(getClass().getResourceAsStream("/mcp/official-tool-schemas.json"), new TypeReference<>() {});
    }
    String custom() { return (String) service.save(8L, null, new UserMcpConnectionService.Update("Synthetic", "https://example.com/mcp", null, "alice-token")).get("id"); }
    void activate(String id) { service.test(8L, id); service.enable(8L, id, true); }
    Map<String, Object> row(String id, Long user) { return service.list(user).stream().filter(c -> id.equals(c.get("id"))).findFirst().orElseThrow(); }
    ToolContext context(String name, Long user) { return new ToolContext(7L, "conversation", user, null, List.of(), Set.of(name)); }

    @Test void offlineCrudAndWriteOnlyEncryptionAndUserAccountIsolation() {
        assertEquals(6, service.list(8L).size()); verifyNoInteractions(http);
        assertThrows(PluginMcpException.class, () -> service.save(8L, "custom-forged", new UserMcpConnectionService.Update("forged", "https://example.com", null, null)));
        String id = custom();
        assertFalse(store.values().stream().anyMatch(s -> s.contains("alice-token")));
        assertFalse(new ObjectMapper().valueToTree(service.list(8L)).toString().contains("alice-token"));
        assertFalse((boolean) row(id, 8L).get("enabled"));
        assertEquals(6, service.list(9L).size());
        when(account.accountFingerprintOrNull()).thenReturn("account-B");
        assertEquals(6, service.list(8L).size());
        when(account.accountFingerprintOrNull()).thenReturn("account-A");
        service.delete(8L, id); assertEquals(6, service.list(8L).size());
        verifyNoInteractions(http);
    }
    @Test void queuedMutationsFromAnOldAccountAreRejectedBeforeWriting() {
        String id = custom(); activate(id);
        String oldScope = (String) service.snapshot(8L).get("scopeToken");
        when(account.accountFingerprintOrNull()).thenReturn("account-B");
        Map<String, String> before = new HashMap<>(store);
        var update = new UserMcpConnectionService.Update("Queued", "https://example.com/mcp", null, "old-account-token");
        for (Runnable queued : List.<Runnable>of(
                () -> service.save(8L, "qichacha", update, oldScope),
                () -> service.save(8L, null, update, oldScope),
                () -> service.test(8L, id, oldScope),
                () -> service.enable(8L, id, false, oldScope),
                () -> service.delete(8L, id, oldScope))) {
            PluginMcpException failure = assertThrows(PluginMcpException.class, queued::run);
            assertEquals(409, failure.status()); assertEquals("account_changed", failure.code());
        }
        assertEquals(before, store);
        assertEquals(6, service.list(8L).size());
        when(account.accountFingerprintOrNull()).thenReturn("account-A");
        assertEquals(true, row(id, 8L).get("enabled"));
    }

    @Test void changedEndpointClearsCredentialAndNeverForwardsItToNewHost() {
        String id = custom(); activate(id);
        service.save(8L, id, new UserMcpConnectionService.Update(null, "https://other.example/mcp", null, null));
        assertEquals(false, row(id, 8L).get("configured")); assertEquals(false, row(id, 8L).get("tested"));
        service.test(8L, id);
        verify(http).listTools(eq("https://other.example/mcp"), eq(""), any());
    }
    @Test void realOfficialToolSchemasAllDiscoverAndRemainUnmodified() {
        for (String id : List.of("qichacha", "pkulaw")) {
            when(http.listTools(anyString(), anyString(), any())).thenReturn(official.get(id));
            service.save(8L, id, new UserMcpConnectionService.Update(null, null, null, "synthetic-token"));
            service.test(8L, id); service.enable(8L, id, true);
            assertEquals(official.get(id).size(), ((List<?>) row(id, 8L).get("tools")).size());
        }
        assertEquals(34, service.bindings(8L).size());
    }
    @Test void actualRegistryOffersUserToolsAndExecutesJsonWrapperOnlyInPermittedTurn() {
        String id = custom(); activate(id);
        PluginService plugins = mock(PluginService.class);
        when(plugins.getPluginTools()).thenReturn(Map.of()); when(plugins.getToolSpecifications()).thenReturn(List.of());
        ClientCapabilityService caps = mock(ClientCapabilityService.class);
        when(caps.isToolVisible(anyString(), nullable(String.class))).thenReturn(true);
        ToolRegistry registry = new ToolRegistry(List.of(), plugins, caps); registry.setUserMcpService(service); registry.init();
        String name = service.bindings(8L).get(0).specification().name();
        PlatformAiUserScope.run(8L, () -> {
            assertEquals(name, registry.getAllSpecifications().get(0).name());
            ToolDisclosurePolicy policy = new ToolDisclosurePolicy(true);
            assertEquals("mcp", policy.categoryOf(name));
            assertTrue(policy.narrow(registry.getAllSpecifications(), Set.of()).isEmpty());
            assertEquals(name, policy.narrow(registry.getAllSpecifications(), Set.of("mcp")).get(0).name());
            assertTrue(registry.toolNamesLongestFirst().contains(name));
        });
        PlatformAiUserScope.run(9L, () -> assertTrue(registry.getAllSpecifications().isEmpty()));
        assertTrue(registry.execute(name, "{\"argumentsJson\":\"{\\\"query\\\":\\\"hello\\\"}\"}", context(name, 8L)).success());
        verify(http).call(eq("https://example.com/mcp"), eq("alice-token"), eq("echo"), anyMap(), eq(Map.of("query", "hello")), any());
        clearInvocations(http);
        assertFalse(registry.execute(name, "{\"argumentsJson\":\"{}\"}", context(name, 8L)).success());
        assertFalse(registry.execute(name, "{}", new ToolContext(7L, "c", 8L, null, List.of(), Set.of())).success());
        assertFalse(registry.execute(name, "{}", context(name, 9L)).found());
        verifyNoInteractions(http);
        service.enable(8L, id, false); assertFalse(registry.execute(name, "{}", context(name, 8L)).found());
    }
    @Test void discoveryCannotOverwriteAChangedConfigurationAndDeletedPresetCannotReviveOldGuard() {
        String id = custom();
        when(http.listTools(anyString(), anyString(), any())).thenAnswer(i -> {
            BooleanSupplier guard = i.getArgument(2); assertTrue(guard.getAsBoolean());
            service.save(8L, id, new UserMcpConnectionService.Update("Changed", null, null, "new-token"));
            assertFalse(guard.getAsBoolean()); return List.of(SIMPLE);
        });
        assertThrows(PluginMcpException.class, () -> service.test(8L, id));
        assertEquals("Changed", row(id, 8L).get("name")); assertEquals(false, row(id, 8L).get("tested"));
    }
    @Test void explicitCustomSelectionNeverFallsBackOnCredentialChangeMissingToolOrFailure() {
        when(http.listTools(anyString(), anyString(), any())).thenReturn(official.get("qichacha"));
        service.save(8L, "qichacha", new UserMcpConnectionService.Update(null, null, null, "custom-token")); activate("qichacha");
        QichachaService qcc = new QichachaService();
        PlatformGatewayClient gateway = mock(PlatformGatewayClient.class);
        ReflectionTestUtils.setField(qcc, "userMcp", service);
        ReflectionTestUtils.setField(qcc, "platformGatewayClient", gateway);
        ExternalProviderResolver resolver = mock(ExternalProviderResolver.class);
        when(resolver.resolve(anyString())).thenReturn(ExternalServiceProvider.PLATFORM);
        ReflectionTestUtils.setField(qcc, "externalProviderResolver", resolver);
        PlatformAiUserScope.run(8L, () -> {
            assertEquals("synthetic result", qcc.queryEciInfoJson("Synthetic Co"));
            verify(http).call(anyString(), eq("custom-token"), eq("get_company_registration_info"), anyMap(), eq(Map.of("searchKey", "Synthetic Co")), any());
            assertThrows(PluginMcpException.class, () -> qcc.queryIprJson("absent_tool", "Synthetic Co"));
            service.save(8L, "qichacha", new UserMcpConnectionService.Update(null, null, null, "changed-token"));
            assertTrue(service.hasOverride("qichacha"));
            assertThrows(PluginMcpException.class, () -> qcc.queryEciInfoJson("Synthetic Co"));
            when(http.listTools(anyString(), anyString(), any())).thenThrow(new PluginMcpException("remote_error", 502, "synthetic failure"));
            assertThrows(PluginMcpException.class, () -> service.test(8L, "qichacha"));
            assertTrue(service.hasOverride("qichacha"));
            assertThrows(PluginMcpException.class, () -> qcc.queryEciInfoJson("Synthetic Co"));
            verifyNoInteractions(gateway);
            service.enable(8L, "qichacha", false); assertFalse(service.hasOverride("qichacha"));
            assertEquals("official", row("qichacha", 8L).get("source"));
        });
    }
    @Test void pkulawOverrideUsesExistingChannelAndNeverGatewayOnFailure() {
        when(http.listTools(anyString(), anyString(), any())).thenReturn(official.get("pkulaw"));
        service.save(8L, "pkulaw", new UserMcpConnectionService.Update(null, null, null, "custom-token")); activate("pkulaw");
        PlatformGatewayClient gateway = mock(PlatformGatewayClient.class);
        McpClientService legacy = mock(McpClientService.class);
        ExternalProviderResolver resolver = mock(ExternalProviderResolver.class);
        PkulawChannel channel = new PkulawChannel(legacy, resolver, gateway);
        ReflectionTestUtils.setField(channel, "userMcp", service);
        PlatformAiUserScope.run(8L, () -> {
            assertEquals("synthetic result", channel.callTool("pkulaw-semantic", "search_article", Map.of("text", "synthetic")));
            assertFalse(channel.viaPlatform("pkulaw-semantic"));
            when(http.call(anyString(), anyString(), anyString(), anyMap(), anyMap(), any())).thenThrow(new PluginMcpException("remote_error", 502, "synthetic"));
            assertThrows(PluginMcpException.class, () -> channel.callTool("pkulaw-semantic", "search_article", Map.of("text", "synthetic")));
        });
        verifyNoInteractions(gateway, legacy);
    }
    @Test void credentialsAndCallsInvalidateOnDisconnectOrAccountSwitch() {
        String id = custom(); activate(id);
        String name = service.bindings(8L).get(0).specification().name();
        when(http.call(anyString(), anyString(), anyString(), anyMap(), anyMap(), any())).thenAnswer(i -> {
            BooleanSupplier guard = i.getArgument(5); assertTrue(guard.getAsBoolean());
            when(account.accountFingerprintOrNull()).thenReturn("account-B"); assertFalse(guard.getAsBoolean());
            return Map.of("content", List.of());
        });
        assertThrows(PluginMcpException.class, () -> service.callAgent(name, Map.of("argumentsJson", "{\"query\":\"hello\"}"), context(name, 8L)));
        assertTrue(service.bindings(8L).isEmpty());
    }
    @Test void schemaReferencesAndUnsupportedTransportsNeverReachNetwork() {
        assertThrows(PluginMcpException.class, () -> service.save(8L, null, new UserMcpConnectionService.Update("Bad", "https://example.com", "stdio", null)));
        assertThrows(PluginMcpException.class, () -> service.save(8L, null, new UserMcpConnectionService.Update("Bad", "http://127.0.0.1", null, null)));
        assertThrows(PluginMcpException.class, () -> UserMcpSchema.check(Map.of("type", "object", "$ref", "https://example.com/secret")));
        assertThrows(PluginMcpException.class, () -> UserMcpSchema.check(Map.of("type", "object", "$schema", "https://example.com/meta")));
        verifyNoInteractions(http);
    }
    @Test void strictJsonWrapperRejectsTrailingValuesDuplicatesAndNull() {
        for (String invalid : List.of("{} {}", "{\"query\":1,\"query\":2}", "null", "[]")) {
            assertThrows(PluginMcpException.class, () -> UserMcpSchema.arguments(Map.of("argumentsJson", invalid)));
        }
    }
    @Test void fullSchemaConstraintsRemainEnforcedAndRemoteReadOnlyHintIsNotAnAuthorization() {
        Map<String, Object> schema = Map.of("type", "object", "properties", Map.of("limit", Map.of("type", "integer", "minimum", 1, "maximum", 3, "default", 2),
                "query", Map.of("anyOf", List.of(Map.of("type", "string"), Map.of("type", "null")))), "additionalProperties", false);
        UserMcpSchema.validate(schema, Map.of("limit", 2));
        assertThrows(PluginMcpException.class, () -> UserMcpSchema.validate(schema, Map.of("limit", 4)));
        assertThrows(PluginMcpException.class, () -> UserMcpSchema.validate(schema, Map.of("query", 4)));
        assertThrows(PluginMcpException.class, () -> UserMcpSchema.validate(schema, Map.of("extra", true)));
        var tool = new HashMap<>(SIMPLE); tool.put("annotations", Map.of("readOnlyHint", true));
        when(http.listTools(anyString(), anyString(), any())).thenReturn(List.of(tool));
        String id = custom(); activate(id);
        String name = service.bindings(8L).get(0).specification().name();
        assertThrows(PluginMcpException.class, () -> service.callAgent(name, Map.of("argumentsJson", "{}"), new ToolContext(7L, "c", 8L, null, List.of(), Set.of())));
        verify(http, never()).call(anyString(), anyString(), anyString(), anyMap(), anyMap(), any());
    }
}
