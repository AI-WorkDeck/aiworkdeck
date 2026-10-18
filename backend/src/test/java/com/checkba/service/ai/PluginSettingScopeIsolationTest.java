// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.ai;

import com.checkba.service.ProjectFileService;
import com.checkba.service.SystemSettingService;
import com.checkba.storage.StorageServiceFactory;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;

/** Uses the real manifest parser and contribution service; settings storage is an isolated map. */
class PluginSettingScopeIsolationTest {
    @TempDir Path root;
    final Map<String, String> database = new HashMap<>();
    PluginService plugins;
    PluginContributionService service;
    @BeforeEach void setup() throws Exception {
        SystemSettingService settings = mock(SystemSettingService.class);
        when(settings.get(anyString(), nullable(String.class))).thenAnswer(i -> database.getOrDefault(i.getArgument(0), i.getArgument(1)));
        doAnswer(i -> { database.put(i.getArgument(0), i.getArgument(1)); return null; }).when(settings).set(anyString(), anyString());
        Path directory = Files.createDirectories(root.resolve("qa-plugin"));
        Files.writeString(directory.resolve("manifest.json"), """
                {"id":"qa-plugin","name":"QA","version":"1.0.0","settings":[
                  {"key":"user.8.foo","type":"string","secret":true,"scope":"installation"},
                  {"key":"project.7.bar","type":"string","secret":true,"scope":"installation"},
                  {"key":"foo","type":"string","scope":"user"},
                  {"key":"bar","type":"string","scope":"project"}]}
                """);
        plugins = new PluginService(settings, root.toString()); plugins.init();
        assertEquals(4, plugins.getPlugin("qa-plugin").getSettings().size());
        service = new PluginContributionService(plugins, settings, mock(ProjectFileService.class), mock(StorageServiceFactory.class));
    }
    private Object value(String key, Long user, Long project) {
        return service.settingsView("qa-plugin", user, project).stream().filter(row -> key.equals(row.get("key"))).findFirst().orElseThrow().get("value");
    }
    @Test void userSettingCannotReadOrOverwriteDottedInstallationSecret() {
        service.saveSettings("qa-plugin", Map.of("user.8.foo", "synthetic-user-secret"), 8L, 7L);
        assertNull(value("foo", 8L, 7L), "Ordinary user settings must not expose installation secrets");
        service.saveSettings("qa-plugin", Map.of("foo", "user-value"), 8L, 7L);
        assertEquals("synthetic-user-secret", database.get("plugin.qa-plugin.user.8.foo"));
        assertEquals("user-value", value("foo", 8L, 7L));
        assertNull(value("foo", 9L, 7L));
    }
    @Test void projectSettingCannotReadOrOverwriteDottedInstallationSecret() {
        service.saveSettings("qa-plugin", Map.of("project.7.bar", "synthetic-project-secret"), 8L, 7L);
        assertNull(value("bar", 8L, 7L), "Ordinary project settings must not expose installation secrets");
        service.saveSettings("qa-plugin", Map.of("bar", "project-value"), 8L, 7L);
        assertEquals("synthetic-project-secret", database.get("plugin.qa-plugin.project.7.bar"));
        assertEquals("project-value", value("bar", 9L, 7L));
        assertNull(value("bar", 8L, 10L));
    }
    @Test void changingOneDeclaredKeysScopeNeverReusesValuesFromAnotherScope() {
        var declaration = plugins.getPlugin("qa-plugin").getSettings().stream().filter(row -> "foo".equals(row.getKey())).findFirst().orElseThrow();
        for (String scope : List.of("installation", "user", "project")) {
            declaration.setScope(scope);
            assertNull(value("foo", 8L, 7L));
            service.saveSettings("qa-plugin", Map.of("foo", scope + "-value"), 8L, 7L);
        }
        for (String scope : List.of("installation", "user", "project")) {
            declaration.setScope(scope);
            assertEquals(scope + "-value", value("foo", 8L, 7L));
        }
        assertEquals("installation-value", database.get("plugin.qa-plugin.foo"), "Legacy installation storage remains compatible");
    }
}
