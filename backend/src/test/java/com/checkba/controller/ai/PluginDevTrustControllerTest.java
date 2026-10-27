// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.controller.ai;

import com.checkba.controller.AuthController;
import com.checkba.model.entity.User;
import com.checkba.repository.UserRepository;
import com.checkba.service.AdminAccessService;
import com.checkba.service.ai.PluginDevTrustService;
import com.checkba.service.ai.PluginService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import java.nio.file.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class PluginDevTrustControllerTest {
    @TempDir Path root;
    @Test void loginAndAdministratorChecksPrecedeAnyTrustMutation() {
        var plugins = mock(PluginService.class);
        var admins = mock(AdminAccessService.class);
        var users = mock(UserRepository.class);
        var controller = new PluginDevTrustController(plugins, admins, users);
        try (var auth = mockStatic(AuthController.class)) {
            auth.when(() -> AuthController.getUserIdFromSession(null)).thenReturn(null);
            assertEquals(401, controller.get("dev-example", null).getStatusCode().value());
            assertEquals(401, controller.set("dev-example", new PluginDevTrustController.TrustRequest(true), null).getStatusCode().value());
            auth.when(() -> AuthController.getUserIdFromSession("member")).thenReturn(5L);
            var member = new User(); when(users.findById(5L)).thenReturn(Optional.of(member));
            when(admins.isAdmin(member)).thenReturn(false);
            assertEquals(403, controller.set("dev-example", new PluginDevTrustController.TrustRequest(true), "member").getStatusCode().value());
            verifyNoInteractions(plugins);
        }
    }
    @Test void adminCanApproveAndRevokeWhileMembersCanReadStatus() throws Exception {
        Path directory = Files.createDirectories(root.resolve("dev-example"));
        Files.writeString(directory.resolve("manifest.json"), "{\"id\":\"dev-example\"}");
        Files.writeString(directory.resolve(".awd-dev"), "{}");
        var plugins = mock(PluginService.class);
        when(plugins.getPlugin("dev-example")).thenReturn(new PluginService.PluginMetadata());
        when(plugins.isDevInstalled("dev-example")).thenReturn(true);
        when(plugins.getPluginDir("dev-example")).thenReturn(directory.toFile());
        var admins = mock(AdminAccessService.class);
        var users = mock(UserRepository.class);
        var admin = new User(); when(users.findById(1L)).thenReturn(Optional.of(admin)); when(admins.isAdmin(admin)).thenReturn(true);
        var controller = new PluginDevTrustController(plugins, admins, users);
        try (var auth = mockStatic(AuthController.class)) {
            auth.when(() -> AuthController.getUserIdFromSession("admin")).thenReturn(1L);
            auth.when(() -> AuthController.getUserIdFromSession("member")).thenReturn(5L);
            assertEquals(Map.of("code", 0, "devInstalled", true, "trusted", false), controller.get("dev-example", "member").getBody());
            assertEquals(Map.of("code", 0, "devInstalled", true, "trusted", true), controller.set("dev-example", new PluginDevTrustController.TrustRequest(true), "admin").getBody());
            assertTrue(PluginDevTrustService.isServiceTrusted(plugins, "dev-example"));
            assertEquals(200, controller.set("dev-example", new PluginDevTrustController.TrustRequest(false), "admin").getStatusCode().value());
            assertFalse(Files.exists(directory.resolve(PluginDevTrustService.MARKER)));
            assertEquals(400, controller.set("dev-example", new PluginDevTrustController.TrustRequest(null), "admin").getStatusCode().value());
            assertEquals(400, controller.set("../escape", new PluginDevTrustController.TrustRequest(true), "admin").getStatusCode().value());
            assertEquals(404, controller.get("missing-plugin", "admin").getStatusCode().value());
            when(plugins.isDevInstalled("dev-example")).thenReturn(false);
            assertEquals(Map.of("code", 0, "devInstalled", false, "trusted", true), controller.get("dev-example", "member").getBody());
            assertEquals(400, controller.set("dev-example", new PluginDevTrustController.TrustRequest(true), "admin").getStatusCode().value());
        }
    }
}
