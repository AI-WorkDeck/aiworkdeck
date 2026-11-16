// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.controller.ai;

import com.checkba.controller.AuthController;
import com.checkba.model.entity.User;
import com.checkba.repository.UserRepository;
import com.checkba.service.AdminAccessService;
import com.checkba.service.SystemSettingService;
import com.checkba.service.ai.PluginService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.mockito.MockedStatic;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

/**
 * /api/plugins/list 带出工具的五个授权字段（PluginPane 据此作废旧实例）与待批准的升级；
 * 批准接口只收管理员、只收与当前定义一致的凭据。
 */
class PluginControllerToolApprovalTest {
    @TempDir Path pluginDirectory;

    private void write(String access) throws Exception {
        Path dir = pluginDirectory.resolve("demo-tools");
        Files.createDirectories(dir);
        Files.writeString(dir.resolve("manifest.json"), """
                {"id":"demo-tools","name":"Demo","version":"1.0.0","permissions":["tasks"],
                 "tools":[{"name":"demo_tools_add","description":"Add","access":"%s","confirm":"auto",
                   "inputSchema":{"type":"object","properties":{"title":{"type":"string"}}},
                   "handler":{"type":"service","service":"calendar","operation":"create"},"permissions":["tasks"]}]}
                """.formatted(access));
    }

    @Test void listExposesToolAuthorityAndApprovalNeedsAdminAndCurrentToken() throws Exception {
        Map<String, String> store = new HashMap<>();
        SystemSettingService settings = mock(SystemSettingService.class);
        when(settings.get(anyString(), anyString())).thenAnswer(i -> store.getOrDefault(i.<String>getArgument(0), i.getArgument(1)));
        doAnswer(i -> store.put(i.getArgument(0), i.getArgument(1))).when(settings).set(anyString(), anyString());
        write("write");
        PluginService plugins = new PluginService(settings, pluginDirectory.toString());
        plugins.init();
        UserRepository users = mock(UserRepository.class);
        AdminAccessService admins = mock(AdminAccessService.class);
        PluginController controller = new PluginController(plugins, null, null, users, admins,
                mock(com.checkba.service.telemetry.TelemetryService.class), null, null, null, null, null, null, null);

        var tool = new ObjectMapper().valueToTree(controller.listPlugins().get(0)).path("tools").get(0);
        assertEquals("write", tool.path("access").asText());
        assertEquals("auto", tool.path("confirm").asText());
        assertEquals("create", tool.path("handler").path("operation").asText());
        assertEquals("string", tool.path("inputSchema").path("properties").path("title").path("type").asText());
        assertTrue(controller.listPlugins().get(0).getPendingToolChanges().isEmpty());

        write("destructive");
        plugins.rescan();
        var view = controller.listPlugins().get(0);
        assertEquals(1, view.getPendingToolChanges().size());
        var change = view.getPendingToolChanges().get(0);
        assertEquals("demo_tools_add", change.get("name"));
        assertEquals(java.util.List.of("access"), change.get("reasons"));
        assertNotNull(view.getToolApprovalToken());

        User user = new User();
        when(users.findById(7L)).thenReturn(Optional.of(user));
        try (MockedStatic<AuthController> auth = mockStatic(AuthController.class)) {
            auth.when(() -> AuthController.getUserIdFromSession("member")).thenReturn(7L);
            assertEquals(403, controller.approveToolChanges("demo-tools", Map.of("token", view.getToolApprovalToken()), "member").getStatusCode().value());
            when(admins.isAdmin(user)).thenReturn(true);
            assertEquals(409, controller.approveToolChanges("demo-tools", Map.of("token", "stale"), "member").getStatusCode().value());
            assertEquals(1, controller.listPlugins().get(0).getPendingToolChanges().size());
            assertEquals(200, controller.approveToolChanges("demo-tools", Map.of("token", view.getToolApprovalToken()), "member").getStatusCode().value());
            assertTrue(controller.listPlugins().get(0).getPendingToolChanges().isEmpty());
        }
    }

    @Test void listNeverPairsPreviousChangesWithAReplacementDefinitionsToken() throws Exception {
        write("write");
        PluginService plugins = spy(new PluginService(null, pluginDirectory.toString()));
        plugins.init();
        write("destructive");
        plugins.rescan();
        String reviewedToken = plugins.toolApprovalToken("demo-tools");
        // Force the interleaving between the old two reads: the first read captures
        // the displayed changes, then a reinstall completes before the token read.
        doAnswer(invocation -> {
            Object previous = invocation.callRealMethod();
            Path manifest = pluginDirectory.resolve("demo-tools/manifest.json");
            Files.writeString(manifest, Files.readString(manifest).replace("\"auto\"", "\"never\""));
            plugins.rescan();
            return previous;
        }).when(plugins).pendingToolChanges("demo-tools");
        PluginController controller = new PluginController(plugins, null, null, mock(UserRepository.class),
                mock(AdminAccessService.class), mock(com.checkba.service.telemetry.TelemetryService.class),
                null, null, null, null, null, null, null);

        var view = controller.listPlugins().get(0);
        assertEquals(java.util.List.of("access"), view.getPendingToolChanges().get(0).get("reasons"));
        assertEquals(reviewedToken, view.getToolApprovalToken(),
                "The approval token must describe exactly the changes shown, never a later reinstall");
    }
}
