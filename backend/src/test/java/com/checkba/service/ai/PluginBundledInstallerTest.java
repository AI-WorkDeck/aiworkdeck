// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.ai;

import com.checkba.service.SystemSettingService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.io.TempDir;
import java.nio.file.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;

class PluginBundledInstallerTest {
    @TempDir Path temp;
    Map<String, String> settings = new HashMap<>();
    PluginBundledInstaller installer;
    Path source, plugins;
    @BeforeEach void setup() throws Exception {
        source = temp.resolve("bundled"); plugins = temp.resolve("plugins");
        SystemSettingService store = mock(SystemSettingService.class);
        when(store.get(anyString(), anyString())).thenAnswer(i -> settings.getOrDefault(i.getArgument(0), i.getArgument(1)));
        doAnswer(i -> settings.put(i.getArgument(0), i.getArgument(1))).when(store).set(anyString(), anyString());
        installer = new PluginBundledInstaller(store, source.toString(), plugins.toString());
        bundle("1.0.0");
    }
    void bundle(String version) throws Exception {
        Files.createDirectories(source.resolve("search/web"));
        Files.writeString(source.resolve("search/manifest.json"), """
            {"id":"search","version":"%s","frontendEntry":"web/index.html","contributes":{"views":[
            {"id":"main","entry":"web/index.html","placement":"sidebar","scope":"project"}]}}
            """.formatted(version));
        Files.writeString(source.resolve("search/web/index.html"), version);
    }
    void uninstall() throws Exception {
        try (var paths = Files.walk(plugins.resolve("search"))) {
            for (Path path : paths.sorted(Comparator.reverseOrder()).toList()) Files.delete(path);
        }
    }
    @Test void defaultsMigrateOnceAndRespectUninstallAndExplicitReinstall() throws Exception {
        settings.put("ai.skills.disabled", "[\"search\"]");
        installer.installDefaults();
        assertTrue(Files.isRegularFile(plugins.resolve("search/web/index.html")));
        assertTrue(settings.get(PluginService.DISABLED_KEY).contains("search"));
        uninstall(); installer.installDefaults();
        assertFalse(Files.exists(plugins.resolve("search")));
        installer.install("search");
        assertTrue(Files.isRegularFile(plugins.resolve("search/web/index.html")));
    }
    @Test void updateOnlyOwnedBundleAndDoNotOverwriteMarketInstall() throws Exception {
        installer.installDefaults(); bundle("1.1.0"); installer.installDefaults();
        assertEquals("1.1.0", Files.readString(plugins.resolve("search/web/index.html")));
        Files.delete(plugins.resolve("search/.awd-bundled"));
        bundle("1.2.0"); installer.installDefaults();
        assertEquals("1.1.0", Files.readString(plugins.resolve("search/web/index.html")));
        assertThrows(IllegalArgumentException.class, () -> installer.install("search"));
    }
    @Test void shippedSearchBundleReplacesTheOriginalInstalledVersion() throws Exception {
        installer.installDefaults();
        Path shipped = Path.of("../official-plugins/search");
        Files.copy(shipped.resolve("manifest.json"), source.resolve("search/manifest.json"), StandardCopyOption.REPLACE_EXISTING);
        try (var paths = Files.walk(shipped.resolve("web"))) {
            for (Path file : paths.toList()) {
                Path target = source.resolve("search").resolve(shipped.relativize(file));
                if (Files.isDirectory(file)) Files.createDirectories(target);
                else Files.copy(file, target, StandardCopyOption.REPLACE_EXISTING);
            }
        }
        installer.installDefaults();
        assertNotEquals("1.0.0", settings.get("plugin.bundled.search"));
        assertEquals(Files.readString(shipped.resolve("web/index.html")), Files.readString(plugins.resolve("search/web/index.html")));
    }
    @Test void invalidUpdateKeepsWorkingPluginAndTemporaryDirectoriesAreOutsideScanRoot() throws Exception {
        installer.installDefaults(); bundle("1.1.0"); Files.delete(source.resolve("search/web/index.html"));
        assertThrows(IllegalArgumentException.class, () -> installer.installDefaults());
        assertEquals("1.0.0", Files.readString(plugins.resolve("search/web/index.html")));
        try (var entries = Files.list(plugins)) { assertEquals(List.of("search"), entries.map(p -> p.getFileName().toString()).toList()); }
    }
    @Test void fixedBusinessBundlesUpgradeExistingOriginalInstallations() throws Exception {
        for (String id : List.of("voice", "calendar", "desensitize", "litigation-visual", "insight",
                "theme-inkwash-zen", "theme-anime-twilight", "theme-aurora-glass")) {
            Path shipped = Path.of("../official-plugins").resolve(id);
            String manifest = Files.readString(shipped.resolve("manifest.json"));
            var original = cn.hutool.json.JSONUtil.parseObj(manifest);
            String version = original.getStr("version");
            assertTrue(com.checkba.util.Semver.compare(version, "1.0.0") > 0, id + " must upgrade the original installation");
            original.set("version", "1.0.0");
            Files.createDirectories(source.resolve(id).resolve("web"));
            Files.writeString(source.resolve(id).resolve("manifest.json"), original.toString());
            Files.writeString(source.resolve(id).resolve("web/index.html"), "old plugin");
            if (Files.isDirectory(shipped.resolve("themes"))) {
                try (var paths = Files.walk(shipped.resolve("themes"))) {
                    for (Path file : paths.toList()) {
                        Path target = source.resolve(id).resolve(shipped.relativize(file));
                        if (Files.isDirectory(file)) Files.createDirectories(target);
                        else Files.copy(file, target, StandardCopyOption.REPLACE_EXISTING);
                    }
                }
            }
            installer.installDefaults();
            Files.copy(shipped.resolve("manifest.json"), source.resolve(id).resolve("manifest.json"), StandardCopyOption.REPLACE_EXISTING);
            try (var paths = Files.walk(shipped.resolve("web"))) {
                for (Path file : paths.toList()) {
                    Path target = source.resolve(id).resolve(shipped.relativize(file));
                    if (Files.isDirectory(file)) Files.createDirectories(target);
                    else Files.copy(file, target, StandardCopyOption.REPLACE_EXISTING);
                }
            }
            installer.installDefaults();
            assertEquals(version, settings.get("plugin.bundled." + id));
            assertEquals(Files.readString(shipped.resolve("web/index.html")), Files.readString(plugins.resolve(id).resolve("web/index.html")));
            if (Files.isDirectory(shipped.resolve("themes"))) {
                assertTrue(Files.isDirectory(plugins.resolve(id).resolve("themes")), id + " must copy themes/ directory");
            }
        }
    }
    @Test void symlinkPayloadIsRejectedWithoutReplacingExistingInstallation() throws Exception {
        installer.installDefaults(); bundle("1.1.0");
        Path outside = temp.resolve("outside"); Files.writeString(outside, "not a plugin resource");
        Files.createSymbolicLink(source.resolve("search/web/escape"), outside);
        assertThrows(IllegalArgumentException.class, () -> installer.installDefaults());
        assertEquals("1.0.0", Files.readString(plugins.resolve("search/web/index.html")));
    }
}
