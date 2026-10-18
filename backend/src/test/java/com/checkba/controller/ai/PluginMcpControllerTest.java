// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.controller.ai;

import com.checkba.controller.AuthController;
import com.checkba.service.ai.mcp.PluginMcpException;
import com.checkba.service.ai.mcp.PluginMcpService;
import com.checkba.service.ai.tools.ToolContext;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import java.util.List;
import java.util.Map;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;

class PluginMcpControllerTest {
    @Test void callUsesSessionIdentityAndPreservesMcpResult() {
        var service = mock(PluginMcpService.class);
        var controller = new PluginMcpController(service);
        Map<String, Object> result = Map.of("content", List.of(Map.of("type", "text", "text", "fixture")), "isError", false);
        when(service.call(anyString(), anyString(), anyString(), anyMap(), any())).thenReturn(result);
        try (var sessions = mockStatic(AuthController.class)) {
            sessions.when(() -> AuthController.getUserIdFromSession("fixture-session")).thenReturn(42L);
            var response = controller.call("example", new PluginMcpController.CallRequest("primary", "echo", Map.of("userId", 999), 17L), "fixture-session");
            assertEquals(200, response.getStatusCode().value());
            assertEquals(Map.of("code", 0, "result", result), response.getBody());
            var context = ArgumentCaptor.forClass(ToolContext.class);
            verify(service).call(eq("example"), eq("primary"), eq("echo"), eq(Map.of("userId", 999)), context.capture());
            assertEquals(42L, context.getValue().userId()); assertEquals(17L, context.getValue().projectId());
        }
    }
    @Test void unauthenticatedCallReturnsSafeStatusAndErrorCode() {
        var service = mock(PluginMcpService.class);
        when(service.call(anyString(), anyString(), anyString(), anyMap(), any()))
                .thenThrow(new PluginMcpException("not_authenticated", 401, "Sign in first."));
        try (var sessions = mockStatic(AuthController.class)) {
            sessions.when(() -> AuthController.getUserIdFromSession(null)).thenReturn(null);
            var response = new PluginMcpController(service).call("example", new PluginMcpController.CallRequest("one", "echo", Map.of(), 7L), null);
            assertEquals(401, response.getStatusCode().value());
            assertEquals(Map.of("code", 1, "errorCode", "not_authenticated", "message", "Sign in first."), response.getBody());
            var context = ArgumentCaptor.forClass(ToolContext.class);
            verify(service).call(anyString(), anyString(), anyString(), anyMap(), context.capture());
            assertNull(context.getValue().userId());
        }
    }
    @Test void listPassesSessionIdentityAndProjectAclContext() {
        var service = mock(PluginMcpService.class);
        when(service.servers("example", 42L, 17L)).thenReturn(List.of(Map.of("id", "one", "configured", true)));
        try (var sessions = mockStatic(AuthController.class)) {
            sessions.when(() -> AuthController.getUserIdFromSession("fixture-session")).thenReturn(42L);
            var response = new PluginMcpController(service).servers("example", 17L, "fixture-session");
            assertEquals(200, response.getStatusCode().value());
            verify(service).servers("example", 42L, 17L);
        }
    }
}
