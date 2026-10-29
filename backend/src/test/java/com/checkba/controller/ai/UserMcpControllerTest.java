// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.controller.ai;

import com.checkba.config.CorsConfig;
import com.checkba.controller.AuthController;
import com.checkba.service.ProjectMemberService;
import com.checkba.service.SystemSettingService;
import com.checkba.service.account.AccountService;
import com.checkba.service.ai.mcp.PluginMcpHttpClient;
import com.checkba.service.ai.mcp.UserMcpConnectionService;
import com.checkba.service.plugin.PluginCredentialStore;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

class UserMcpControllerTest {
    @TempDir Path dir;

    @Test void realHttpRoutesBindMutationsToLoadedAccountAndKeepCredentialsWriteOnly() throws Exception {
        var settings = mock(SystemSettingService.class);
        Map<String, String> store = new HashMap<>();
        when(settings.get(anyString(), nullable(String.class))).thenAnswer(i -> store.getOrDefault(i.getArgument(0), i.getArgument(1)));
        doAnswer(i -> { store.put(i.getArgument(0), i.getArgument(1)); return null; }).when(settings).set(anyString(), anyString());
        var account = mock(AccountService.class);
        when(account.accountFingerprintOrNull()).thenReturn("account-A");
        var http = mock(PluginMcpHttpClient.class);
        when(http.listTools(anyString(), anyString(), any())).thenReturn(List.of(Map.of("name", "echo", "inputSchema", Map.of("type", "object"))));
        var service = new UserMcpConnectionService(settings, new PluginCredentialStore(settings, dir.resolve("key").toString()),
                account, mock(ProjectMemberService.class), http);
        var mvc = MockMvcBuilders.standaloneSetup(new UserMcpController(service))
                .addFilters(new CorsConfig.CorsPreflightFilter(Set.of(), false)).build();
        var json = new ObjectMapper();
        try (var sessions = mockStatic(AuthController.class)) {
            sessions.when(() -> AuthController.getUserIdFromSession(null)).thenReturn(null);
            sessions.when(() -> AuthController.getUserIdFromSession("test-session")).thenReturn(8L);
            mvc.perform(get("/api/mcp/connections")).andExpect(status().isUnauthorized());
            mvc.perform(options("/api/mcp/connections").header("Origin", "http://127.0.0.1:5173")
                    .header("Access-Control-Request-Method", "POST").header("Access-Control-Request-Headers", "X-MCP-Scope, Content-Type"))
                    .andExpect(status().isOk()).andExpect(header().string("Access-Control-Allow-Origin", "http://127.0.0.1:5173"))
                    .andExpect(header().string("Access-Control-Allow-Headers", org.hamcrest.Matchers.containsString("X-MCP-Scope")));
            String snapshot = mvc.perform(get("/api/mcp/connections").header("X-Session-Id", "test-session"))
                    .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
            String scope = json.readTree(snapshot).path("scopeToken").asText();
            String body = "{\"name\":\"Synthetic\",\"url\":\"https://example.com/mcp\",\"token\":\"fixture-secret\"}";
            mvc.perform(post("/api/mcp/connections").header("X-Session-Id", "test-session")
                    .contentType("application/json").content(body)).andExpect(status().isConflict());
            String created = mvc.perform(post("/api/mcp/connections").header("X-Session-Id", "test-session").header("X-MCP-Scope", scope)
                    .contentType("application/json").content(body)).andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
            assertFalse(created.contains("fixture-secret"));
            assertFalse(store.values().stream().anyMatch(value -> value.contains("fixture-secret")));
            String path = "/api/mcp/connections/" + json.readTree(created).path("connection").path("id").asText();
            mvc.perform(post(path + "/test").header("X-Session-Id", "test-session").header("X-MCP-Scope", scope))
                    .andExpect(status().isOk()).andExpect(jsonPath("$.connection.tested").value(true));
            mvc.perform(post(path + "/enable").header("X-Session-Id", "test-session").header("X-MCP-Scope", scope)
                    .contentType("application/json").content("{\"enabled\":true}"))
                    .andExpect(status().isOk()).andExpect(jsonPath("$.connection.source").value("custom"));
            when(account.accountFingerprintOrNull()).thenReturn("account-B");
            mvc.perform(put(path).header("X-Session-Id", "test-session").header("X-MCP-Scope", scope)
                    .contentType("application/json").content(body)).andExpect(status().isConflict())
                    .andExpect(jsonPath("$.errorCode").value("account_changed"));
            assertEquals(5, service.list(8L).size());
            when(account.accountFingerprintOrNull()).thenReturn("account-A");
            mvc.perform(delete(path).header("X-Session-Id", "test-session").header("X-MCP-Scope", scope))
                    .andExpect(status().isOk());
            assertEquals(5, service.list(8L).size());
        }
    }
}
