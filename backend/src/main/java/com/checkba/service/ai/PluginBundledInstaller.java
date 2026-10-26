// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.ai;

import com.checkba.service.SystemSettingService;
import com.checkba.util.Semver;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import java.nio.file.*;
import java.util.*;

/** Copies trusted host-distributed Web plugins once; uninstall is remembered, marketplace replacements win. */
@Service
public class PluginBundledInstaller {
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final Set<String> IDS = Set.of(
            "search", "voice", "desensitize", "litigation-visual",
            "calendar", "favorites", "clipboard", "insight",
            "theme-inkwash-zen", "theme-anime-twilight", "theme-aurora-glass");
    private static final String MARKER = ".awd-bundled";
    private final SystemSettingService settings;
    private final Path source;
    private final Path destination;
    public PluginBundledInstaller(SystemSettingService settings,
            @Value("${ai.plugins.bundled-dir:}") String source, @Value("${ai.plugins.dir:plugins}") String destination) {
        this.settings = settings;
        this.source = source.isBlank() ? null : Path.of(source);
        this.destination = Path.of(destination);
    }

    public List<Map<String, Object>> available() {
        if (source == null || !Files.isDirectory(source)) return List.of();
        List<Map<String, Object>> result = new ArrayList<>();
        for (String id : new TreeSet<>(IDS)) {
            Path manifest = source.resolve(id).resolve("manifest.json");
            if (!Files.isRegularFile(manifest)) continue;
            try {
                Map<String, Object> row = JSON.readValue(Files.readString(manifest), new TypeReference<>() {});
                if (!id.equals(row.get("id"))) throw new IllegalArgumentException("Bundled plugin id mismatch");
                row.put("bundled", true);
                result.add(row);
            } catch (java.io.IOException e) { throw new IllegalStateException("Invalid bundled plugin manifest", e); }
        }
        return result;
    }

    public synchronized void installDefaults() {
        for (Map<String, Object> meta : available()) {
            String id = String.valueOf(meta.get("id"));
            String seen = settings.get("plugin.bundled." + id, "");
            Path target = destination.resolve(id);
            String version = String.valueOf(meta.get("version"));
            if (seen.isEmpty()) {
                if (!Files.exists(target)) {
                    install(id);
                    migrateDisabled(id);
                }
                settings.set("plugin.bundled." + id, version);
            } else if (Files.isRegularFile(target.resolve(MARKER)) && Semver.isSemver(version)
                    && Semver.isSemver(seen) && Semver.compare(version, seen) > 0) {
                install(id);
            }
        }
    }

    public synchronized void install(String id) {
        Map<String, Object> meta = available().stream().filter(m -> id.equals(m.get("id"))).findFirst()
                .orElseThrow(() -> new IllegalArgumentException("Bundled plugin not available"));
        Path target = destination.resolve(id);
        if (Files.exists(target) && !Files.isRegularFile(target.resolve(MARKER))) {
            throw new IllegalArgumentException("An independently installed plugin already uses this id");
        }
        Path staging = null, backup = null;
        boolean committed = false;
        try {
            Files.createDirectories(destination);
            staging = Files.createTempDirectory(destination.toAbsolutePath().getParent(), ".bundle-install-");
            Path root = source.resolve(id).toRealPath();
            // Source projects may include src/tests; only signed-distribution payload goes into an installation.
            List<Path> payload = new ArrayList<>(); payload.add(root.resolve("manifest.json"));
            for (String sub : List.of("web", "l10n", "skills", "themes", "templates", "profiles")) if (Files.isDirectory(root.resolve(sub))) {
                try (var files = Files.walk(root.resolve(sub))) { payload.addAll(files.toList()); }
            }
            for (Path file : payload) {
                if (Files.isSymbolicLink(file) || !file.toRealPath().startsWith(root)) throw new IllegalArgumentException("Bundled plugin contains a symbolic link");
                Path output = staging.resolve(root.relativize(file));
                if (Files.isDirectory(file)) Files.createDirectories(output);
                else { Files.createDirectories(output.getParent()); Files.copy(file, output); }
            }
            PluginManifestContractValidator.validateViews(cn.hutool.json.JSONUtil.toBean(
                    Files.readString(staging.resolve("manifest.json")), PluginService.PluginMetadata.class), staging.toFile());
            Files.writeString(staging.resolve(MARKER), String.valueOf(meta.get("version")));
            if (Files.exists(target)) {
                backup = destination.toAbsolutePath().getParent().resolve(".bundle-backup-" + UUID.randomUUID());
                Files.move(target, backup, StandardCopyOption.ATOMIC_MOVE);
            }
            try { Files.move(staging, target, StandardCopyOption.ATOMIC_MOVE); }
            catch (Exception e) { if (backup != null) Files.move(backup, target, StandardCopyOption.ATOMIC_MOVE); throw e; }
            committed = true;
            settings.set("plugin.bundled." + id, String.valueOf(meta.get("version")));
        } catch (java.io.IOException e) { throw new IllegalStateException("Unable to install bundled plugin", e); }
        finally { delete(staging); if (committed) delete(backup); }
    }

    private void migrateDisabled(String id) {
        try {
            List<String> old = JSON.readValue(settings.get("ai.skills.disabled", "[]"), new TypeReference<>() {});
            List<String> members = "voice".equals(id) ? List.of("text-to-speech", "meeting-recorder") : List.of(id);
            if (!old.containsAll(members)) return;
            Set<String> disabled = new LinkedHashSet<>(JSON.readValue(settings.get(PluginService.DISABLED_KEY, "[]"), new TypeReference<List<String>>() {}));
            disabled.add(id);
            settings.set(PluginService.DISABLED_KEY, JSON.writeValueAsString(disabled));
        } catch (java.io.IOException e) { throw new IllegalStateException("Invalid plugin activation state", e); }
    }
    private static void delete(Path path) {
        if (path == null || !Files.exists(path)) return;
        try (var files = Files.walk(path)) {
            for (Path file : files.sorted(Comparator.reverseOrder()).toList()) Files.deleteIfExists(file);
        } catch (java.io.IOException e) { throw new IllegalStateException("Unable to clean plugin installation staging", e); }
    }
}
