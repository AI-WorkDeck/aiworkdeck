// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.controller.ai;

import com.checkba.controller.AuthController;
import com.checkba.repository.UserRepository;
import com.checkba.service.AdminAccessService;
import com.checkba.service.ProjectMemberService;
import com.checkba.service.ai.*;
import com.checkba.service.plugin.PluginHostFactory;
import com.checkba.service.telemetry.TelemetryService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import java.util.List;
import java.util.Map;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class PluginSettingsControllerTest {
    PluginService plugins;
    ProjectMemberService members;
    PluginContributionService contributions;
    PluginController controller;
    @BeforeEach void setup() {
        plugins = mock(PluginService.class);
        members = mock(ProjectMemberService.class);
        contributions = mock(PluginContributionService.class);
        var plugin = new PluginService.PluginMetadata(); plugin.setId("qa-plugin");
        var setting = new PluginService.PluginSettingDecl();
        setting.setKey("greeting"); setting.setType("string"); setting.setScope("project");
        plugin.setSettings(List.of(setting));
        when(plugins.getPlugin("qa-plugin")).thenReturn(plugin);
        controller = new PluginController(plugins, mock(PluginMarketService.class), mock(PluginRevocationService.class),
                mock(UserRepository.class), mock(AdminAccessService.class), mock(TelemetryService.class),
                mock(ToolRegistry.class), members, contributions, mock(PluginHostFactory.class),
                mock(ChatModelFactory.class), mock(AuxModelResolver.class), mock(TokenUsageService.class));
    }
    @Test void readOnlyProjectMemberCanReadSettings() {
        when(members.hasReadPermission(7L, 8L)).thenReturn(true);
        var settings = List.<Map<String, Object>>of(Map.of("key", "greeting", "value", "Hello", "scope", "project"));
        when(contributions.settingsView("qa-plugin", 8L, 7L)).thenReturn(settings);
        try (var auth = mockStatic(AuthController.class)) {
            auth.when(() -> AuthController.getUserIdFromSession("reader")).thenReturn(8L);
            var response = controller.getPluginSettings("qa-plugin", 7L, "reader");
            assertEquals(200, response.getStatusCode().value());
            assertEquals(settings, response.getBody().get("settings"));
            verify(members, never()).hasWritePermission(7L, 8L);
        }
    }
    @Test void nonmemberCannotReadProjectSettings() {
        try (var auth = mockStatic(AuthController.class)) {
            auth.when(() -> AuthController.getUserIdFromSession("outsider")).thenReturn(9L);
            assertEquals(403, controller.getPluginSettings("qa-plugin", 7L, "outsider").getStatusCode().value());
            verifyNoInteractions(contributions);
        }
    }
    @Test void readOnlyProjectMemberCannotWriteProjectSettings() {
        when(members.hasReadPermission(7L, 8L)).thenReturn(true);
        try (var auth = mockStatic(AuthController.class)) {
            auth.when(() -> AuthController.getUserIdFromSession("reader")).thenReturn(8L);
            assertEquals(403, controller.savePluginSettings("qa-plugin", Map.of("greeting", "Changed"), 7L, "reader").getStatusCode().value());
            verify(members).hasWritePermission(7L, 8L);
            verifyNoInteractions(contributions);
        }
    }
}
