// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.ai.mcp;

import com.checkba.service.ProjectMemberService;
import com.checkba.service.SystemSettingService;
import com.checkba.service.account.AccountService;
import com.checkba.service.ai.PluginService;
import com.checkba.service.ai.tools.ToolContext;
import com.checkba.service.plugin.PluginConnectionMcpCredentials;
import com.checkba.service.plugin.PluginConnectionService;
import com.checkba.service.plugin.PluginCredentialStore;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;

/** Real AES credential store + connection service + MCP resolver; only outbound HTTP is synthetic. */
class PluginMcpCredentialIntegrationTest {
    @TempDir Path directory;
    final Map<String, String> database = new HashMap<>();
    PluginService plugins;
    AccountService account;
    PluginCredentialStore credentials;
    Connections connections;
    PluginMcpService mcp;
    PluginMcpHttpClient http;
    Map<String, Object> declaration;
    static final String SCOPE = "8.local.qa-plugin.primary";

    @BeforeEach void setup() {
        SystemSettingService settings = mock(SystemSettingService.class);
        when(settings.get(anyString(), nullable(String.class))).thenAnswer(i -> database.getOrDefault(i.getArgument(0), i.getArgument(1)));
        doAnswer(i -> { database.put(i.getArgument(0), i.getArgument(1)); return null; }).when(settings).set(anyString(), anyString());
        credentials = new PluginCredentialStore(settings, directory.resolve("credential.key").toString());
        account = mock(AccountService.class);
        plugins = mock(PluginService.class);
        var metadata = new PluginService.PluginMetadata(); metadata.setId("qa-plugin"); metadata.setPermissions(List.of("network"));
        var contributes = new PluginService.Contributes(); metadata.setContributes(contributes);
        declaration = new LinkedHashMap<>(Map.of("id", "primary", "label", "Synthetic service", "baseUrl", "https://service.example.invalid",
                "auth", Map.of("type", "bearer"), "operations", Map.of("lookup", Map.of("path", "/lookup", "method", "POST"))));
        contributes.setConnections(List.of(declaration));
        var server = new PluginService.McpServerDecl(); server.setId("research"); server.setTransport("streamable-http");
        server.setUrl("https://service.example.invalid/mcp"); server.setConnectionId("primary");
        var tool = new PluginService.McpToolDecl(); tool.setName("echo"); tool.setDescription("Echo synthetic test input");
        tool.setInputSchema(Map.of("type", "object", "properties", Map.of())); server.setTools(List.of(tool));
        contributes.setMcpServers(List.of(server));
        when(plugins.getPlugin("qa-plugin")).thenReturn(metadata); when(plugins.isEnabled("qa-plugin")).thenReturn(true);
        ProjectMemberService members = mock(ProjectMemberService.class); when(members.hasWritePermission(7L, 8L)).thenReturn(true);
        connections = new Connections();
        http = mock(PluginMcpHttpClient.class);
        when(http.call(anyString(), anyString(), anyString(), anyMap(), anyMap(), any())).thenReturn(Map.of("content", List.of()));
        mcp = new PluginMcpService(plugins, members, settings, http);
        mcp.setCredentialResolver(new PluginConnectionMcpCredentials(connections, plugins, settings));
    }
    class Connections extends PluginConnectionService {
        Reply reply = new Reply(200, Map.of());
        RuntimeException transportFailure;
        Connections() { super(plugins, credentials, account, "http://localhost:9696/api/plugins/oauth/callback"); }
        @Override protected Reply exchange(String url, String method, String bearer, String body, boolean form) {
            if (transportFailure != null) throw transportFailure;
            return reply;
        }
    }
    private void call() { mcp.call("qa-plugin", "research", "echo", Map.of(), new ToolContext(7L, "fixture", 8L, null)); }
    private void assertError(String code, int status) {
        PluginMcpException error = assertThrows(PluginMcpException.class, this::call);
        assertEquals(code, error.code()); assertEquals(status, error.status());
        assertFalse(error.getMessage().contains("fixture-secret"));
        verifyNoInteractions(http);
    }
    private void expiredOAuth() {
        declaration.put("auth", Map.of("type", "oauth2", "authorizationUrl", "https://service.example.invalid/authorize",
                "tokenUrl", "https://service.example.invalid/token", "clientId", "fixture-client"));
        String authorization = String.valueOf(connections.authorize("qa-plugin", 8L, "primary").get("authorizationUrl"));
        String state = Arrays.stream(URI.create(authorization).getRawQuery().split("&"))
                .filter(pair -> pair.startsWith("state=")).map(pair -> URLDecoder.decode(pair.substring(6), StandardCharsets.UTF_8)).findFirst().orElseThrow();
        connections.reply = new PluginConnectionService.Reply(200, Map.of("access_token", "fixture-secret", "refresh_token", "fixture-refresh", "expires_in", 0));
        connections.callback(state, "fixture-code");
    }
    @Test void missingConnectionIsAuthenticationRequiredInsteadOfUncaughtStateException() {
        assertEquals(false, mcp.servers("qa-plugin", 8L, 7L).get(0).get("configured"));
        assertError("authentication_required", 403);
    }
    @Test void tamperedEncryptedCredentialRequiresReconnection() {
        connections.connect("qa-plugin", 8L, "primary", "fixture-secret");
        database.put("plugin.credentials." + SCOPE, "corrupted-encrypted-value");
        assertError("authentication_required", 403);
    }
    @Test void malformedDecryptedCredentialRequiresReconnection() {
        credentials.put(SCOPE, "not-json");
        assertError("authentication_required", 403);
    }
    @Test void refresh401RequiresReconnection() {
        expiredOAuth(); connections.reply = new PluginConnectionService.Reply(401, Map.of());
        assertError("authentication_required", 403);
    }
    @Test void refreshTransportFailureIsUnavailableRatherThanPretendingUserMustLogIn() {
        expiredOAuth(); connections.transportFailure = new IllegalStateException("Service request failed");
        assertError("credential_unavailable", 502);
    }
    @Test void refresh503IsUnavailableRatherThanAuthenticationRequired() {
        expiredOAuth(); connections.reply = new PluginConnectionService.Reply(503, Map.of());
        assertError("credential_unavailable", 502);
    }
    @Test void publicConnectionIsConfiguredAndDoesNotSendAnAuthorizationToken() {
        declaration.put("auth", Map.of("type", "none"));
        assertEquals(true, mcp.servers("qa-plugin", 8L, 7L).get(0).get("configured"));
        call();
        verify(http).call(eq("https://service.example.invalid/mcp"), eq(""), eq("echo"), anyMap(), eq(Map.of()), any());
    }
    @Test void connectedCredentialStillReachesTheMcpClientWithoutAppearingInStatus() {
        connections.connect("qa-plugin", 8L, "primary", "fixture-secret");
        assertFalse(mcp.servers("qa-plugin", 8L, 7L).toString().contains("fixture-secret"));
        call();
        verify(http).call(eq("https://service.example.invalid/mcp"), eq("fixture-secret"), eq("echo"), anyMap(), eq(Map.of()), any());
    }
}
