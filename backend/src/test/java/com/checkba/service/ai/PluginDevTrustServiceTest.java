// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.ai;

import com.checkba.service.SystemSettingService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.nio.file.attribute.PosixFilePermission;
import java.security.MessageDigest;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;

class PluginDevTrustServiceTest {
    @TempDir Path root;
    PluginService plugins;
    Path directory;
    static final String MANIFEST = "{\"id\":\"dev-example\",\"name\":\"Fixture\",\"version\":\"1.0.0\",\"permissions\":[\"network\"]}";
    @BeforeEach void setup() throws Exception {
        directory = Files.createDirectories(root.resolve("dev-example"));
        Files.writeString(directory.resolve("manifest.json"), MANIFEST);
        Files.writeString(directory.resolve(".awd-dev"), "{}");
        var settings = mock(SystemSettingService.class);
        when(settings.get(anyString(), nullable(String.class))).thenAnswer(i -> i.getArgument(1));
        plugins = new PluginService(settings, root.toString()); plugins.init();
    }
    @Test void defaultDenyGrantBindsEntireManifestAndRevokeRemovesApproval() throws Exception {
        assertEquals(new PluginDevTrustService.Status(true, false), PluginDevTrustService.status(plugins, "dev-example"));
        assertTrue(PluginDevTrustService.setTrusted(plugins, "dev-example", true).trusted());
        Path marker = directory.resolve(PluginDevTrustService.MARKER);
        assertEquals(HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(MANIFEST.getBytes(StandardCharsets.UTF_8))) + "\n", Files.readString(marker));
        if (Files.getFileStore(marker).supportsFileAttributeView("posix")) {
            assertEquals(Set.of(PosixFilePermission.OWNER_READ, PosixFilePermission.OWNER_WRITE), Files.getPosixFilePermissions(marker));
        }
        Files.writeString(directory.resolve("manifest.json"), MANIFEST + "\n");
        assertFalse(PluginDevTrustService.isServiceTrusted(plugins, "dev-example"), "even a raw whitespace change invalidates approval before rescan");
        assertTrue(PluginDevTrustService.setTrusted(plugins, "dev-example", true).trusted());
        assertFalse(PluginDevTrustService.setTrusted(plugins, "dev-example", false).trusted());
        assertFalse(Files.exists(marker));
        try (var paths = Files.list(directory)) { assertFalse(paths.anyMatch(p -> p.getFileName().toString().endsWith(".tmp"))); }
    }
    @Test void upgradesPermissionsAndEndpointChangesRequireNewApproval() throws Exception {
        for (String changed : List.of(MANIFEST.replace("1.0.0", "1.0.1"),
                MANIFEST.replace("[\"network\"]", "[\"network\",\"file_read\"]"),
                MANIFEST.replace("}", ",\"contributes\":{\"connections\":[{\"id\":\"primary\",\"baseUrl\":\"https://example.com\"}]}}"))) {
            Files.writeString(directory.resolve("manifest.json"), MANIFEST); plugins.rescan();
            PluginDevTrustService.setTrusted(plugins, "dev-example", true);
            Files.writeString(directory.resolve("manifest.json"), changed); plugins.rescan();
            assertFalse(PluginDevTrustService.isServiceTrusted(plugins, "dev-example"));
        }
    }
    @Test void installedNonDevelopmentPluginNeedsNoMarkerAndCannotWriteOne() throws Exception {
        Files.delete(directory.resolve(".awd-dev")); plugins.rescan();
        assertEquals(new PluginDevTrustService.Status(false, true), PluginDevTrustService.status(plugins, "dev-example"));
        assertThrows(IllegalArgumentException.class, () -> PluginDevTrustService.setTrusted(plugins, "dev-example", true));
        assertFalse(Files.exists(directory.resolve(PluginDevTrustService.MARKER)));
    }
    @Test void arbitraryIdsCannotResolveOrWritePaths() {
        var registry = mock(PluginService.class);
        for (String id : Arrays.asList(null, "../dev-example", "dev-example/../other", "dev-example\\other", "/tmp/example", "bad%2fid", "missing")) {
            assertFalse(PluginDevTrustService.isServiceTrusted(registry, id));
            assertThrows(RuntimeException.class, () -> PluginDevTrustService.setTrusted(registry, id, true));
        }
        verify(registry, never()).getPluginDir(anyString());
    }
    @Test void mismatchedDirectoryAndSymlinkedFilesNeverGrantTrust() throws Exception {
        PluginDevTrustService.setTrusted(plugins, "dev-example", true);
        Path marker = directory.resolve(PluginDevTrustService.MARKER);
        Path outside = root.resolve("outside"); Files.writeString(outside, "untouched");
        Files.delete(marker); Files.createSymbolicLink(marker, outside);
        assertFalse(PluginDevTrustService.isServiceTrusted(plugins, "dev-example"));
        assertThrows(IllegalArgumentException.class, () -> PluginDevTrustService.setTrusted(plugins, "dev-example", true));
        PluginDevTrustService.setTrusted(plugins, "dev-example", false);
        assertEquals("untouched", Files.readString(outside));
        Files.delete(directory.resolve("manifest.json")); Files.createSymbolicLink(directory.resolve("manifest.json"), outside);
        assertFalse(PluginDevTrustService.isServiceTrusted(plugins, "dev-example"));
        assertThrows(IllegalStateException.class, () -> PluginDevTrustService.setTrusted(plugins, "dev-example", true));
        var registry = mock(PluginService.class);
        when(registry.getPlugin("dev-example")).thenReturn(plugins.getPlugin("dev-example"));
        when(registry.isDevInstalled("dev-example")).thenReturn(true);
        when(registry.getPluginDir("dev-example")).thenReturn(root.toFile());
        assertFalse(PluginDevTrustService.isServiceTrusted(registry, "dev-example"));
        assertThrows(IllegalStateException.class, () -> PluginDevTrustService.setTrusted(registry, "dev-example", true));
        Path linkParent = Files.createDirectory(root.resolve("links"));
        Path link = Files.createSymbolicLink(linkParent.resolve("dev-example"), directory);
        when(registry.getPluginDir("dev-example")).thenReturn(link.toFile());
        assertFalse(PluginDevTrustService.isServiceTrusted(registry, "dev-example"));
        assertThrows(IllegalStateException.class, () -> PluginDevTrustService.setTrusted(registry, "dev-example", true));
    }
    @Test void oversizedOrMalformedMarkersAndMissingManifestFailClosed() throws Exception {
        for (String marker : List.of("", "true", "f".repeat(65), "f".repeat(64) + "\nextra")) {
            Files.writeString(directory.resolve(PluginDevTrustService.MARKER), marker);
            assertFalse(PluginDevTrustService.isServiceTrusted(plugins, "dev-example"));
        }
        Files.delete(directory.resolve("manifest.json"));
        assertFalse(PluginDevTrustService.isServiceTrusted(plugins, "dev-example"));
    }
}
