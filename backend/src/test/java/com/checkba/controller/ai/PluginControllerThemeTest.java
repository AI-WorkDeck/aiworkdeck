// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.controller.ai;

import com.checkba.controller.AuthController;
import com.checkba.model.entity.User;
import com.checkba.repository.UserRepository;
import com.checkba.service.AdminAccessService;
import com.checkba.service.ai.PluginContributionService;
import com.checkba.service.ai.PluginService;
import com.checkba.service.SystemSettingService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.io.TempDir;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.mockito.MockedStatic;
import java.util.Map;
import java.util.Optional;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class PluginControllerThemeTest {
    @TempDir Path pluginDirectory;

    @Test void listPreservesLocalizedThemesAndExplicitViewAbsence() throws Exception {
        for (String variant : List.of("omitted", "null", "empty", "gallery")) {
            Path dir = pluginDirectory.resolve("skin-" + variant);
            Files.createDirectories(dir.resolve("web"));
            Files.createDirectories(dir.resolve("themes"));
            Files.createDirectories(dir.resolve("l10n"));
            Files.writeString(dir.resolve("web/index.html"), "<html>preview</html>");
            Files.writeString(dir.resolve("themes/skin.json"), "{}");
            String views = switch (variant) {
                case "null" -> ", \"views\": null";
                case "empty" -> ", \"views\": []";
                case "gallery" -> ", \"views\": [{\"id\":\"gallery\",\"name\":\"Gallery\",\"entry\":\"web/index.html\",\"placement\":\"workspace\",\"scope\":\"global\"}]";
                default -> "";
            };
            Files.writeString(dir.resolve("manifest.json"), """
                    {"id":"skin-%s","name":"Skin","version":"1.0.2","frontendEntry":"web/index.html",
                     "contributes":{"themes":[{"id":"sample-skin","name":"%%theme.name%%",
                     "description":"%%theme.description%%","file":"themes/skin.json"}]%s}}
                    """.formatted(variant, views));
            String translations = "{\"theme.name\":\"Localized skin\",\"theme.description\":\"Localized description\"}";
            Files.writeString(dir.resolve("l10n/zh-CN.json"), translations);
            Files.writeString(dir.resolve("l10n/en-US.json"), translations);
        }
        SystemSettingService settings = mock(SystemSettingService.class);
        when(settings.get(anyString(), anyString())).thenAnswer(inv -> inv.getArgument(1));
        PluginService plugins = new PluginService(settings, pluginDirectory.toString());
        plugins.init();
        PluginController controller = new PluginController(plugins, null, null, null, null,
                null, null, null, null, null, null, null, null);
        var views = controller.listPlugins();
        assertEquals(4, views.size());
        ObjectMapper mapper = new ObjectMapper();
        for (var view : views) {
            var json = mapper.valueToTree(view);
            assertEquals("web/index.html", json.path("frontendEntry").asText());
            var themes = json.path("contributes").path("themes");
            assertTrue(themes.isArray(), view.getId() + " must expose themes to the real plugin list consumer");
            assertEquals(1, themes.size());
            assertEquals("sample-skin", themes.get(0).path("id").asText());
            assertEquals("Localized skin", themes.get(0).path("name").asText());
            assertEquals("Localized description", themes.get(0).path("description").asText());
            assertEquals("themes/skin.json", themes.get(0).path("file").asText());
            var declarations = json.path("contributes").path("views");
            if (view.getId().equals("skin-empty")) {
                assertTrue(declarations.isArray());
                assertEquals(0, declarations.size());
            } else if (view.getId().equals("skin-gallery")) {
                assertEquals("workspace", declarations.get(0).path("placement").asText());
                assertEquals("global", declarations.get(0).path("scope").asText());
            } else {
                assertTrue(declarations.isNull());
            }
        }
        // Localization must not replace tokens in registered metadata or package bytes.
        for (var plugin : plugins.getPlugins()) {
            assertEquals("%theme.name%", plugin.getContributes().getThemes().get(0).getName());
            assertTrue(Files.readString(pluginDirectory.resolve(plugin.getId()).resolve("manifest.json")).contains("%theme.name%"));
        }
    }

    @Test void onlyAdministratorsCanChangeTheSharedThemeSelection() {
        UserRepository users = mock(UserRepository.class);
        AdminAccessService admins = mock(AdminAccessService.class);
        PluginContributionService themes = mock(PluginContributionService.class);
        PluginController controller = new PluginController(null, null, null, users, admins,
                null, null, null, themes, null, null, null, null);
        User user = new User();
        when(users.findById(7L)).thenReturn(Optional.of(user));
        try (MockedStatic<AuthController> auth = mockStatic(AuthController.class)) {
            assertEquals(403, controller.selectContributedTheme(Map.of("ref", ""), null).getStatusCode().value());
            auth.when(() -> AuthController.getUserIdFromSession("member")).thenReturn(7L);
            assertEquals(403, controller.selectContributedTheme(Map.of("ref", ""), "member").getStatusCode().value());
            verifyNoInteractions(themes);
            when(admins.isAdmin(user)).thenReturn(true);
            when(themes.selectedThemeRef()).thenReturn("theme-inkwash-zen:inkwash-zen");
            var result = controller.selectContributedTheme(Map.of("ref", "theme-inkwash-zen:inkwash-zen"), "member");
            assertEquals(200, result.getStatusCode().value());
            assertEquals("theme-inkwash-zen:inkwash-zen", result.getBody().get("selected"));
            verify(themes).selectTheme("theme-inkwash-zen:inkwash-zen");
        }
    }
}
