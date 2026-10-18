// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.ai;

import java.io.File;
import java.nio.file.Files;
import java.util.HashSet;
import java.util.Set;

/** Shared validation for independently packaged sidebar/workspace views. */
public final class PluginManifestContractValidator {
    private PluginManifestContractValidator() {}
    public static void validateServices(PluginService.PluginMetadata meta) {
        var connections = com.checkba.service.plugin.PluginConnectionService.parseDeclarations(meta);
        var servers = com.checkba.service.ai.mcp.PluginMcpService.declarations(meta);
        if ((!connections.isEmpty() || !servers.isEmpty()) && (meta.getPermissions() == null || !meta.getPermissions().contains("network"))) {
            throw new IllegalArgumentException("Remote plugin services require network permission");
        }
        for (var server : servers) {
            if (server.getConnectionId() != null) {
                if (server.getCredentialKey() != null) throw new IllegalArgumentException("Choose connectionId or credentialKey");
                var connection = connections.stream().filter(c -> c.id().equals(server.getConnectionId())).findFirst()
                        .orElseThrow(() -> new IllegalArgumentException("MCP connection is not declared"));
                var target = java.net.URI.create(server.getUrl());
                var origin = java.net.URI.create(connection.baseUrl());
                int targetPort = target.getPort() == -1 ? 443 : target.getPort();
                int originPort = origin.getPort() == -1 ? 443 : origin.getPort();
                if (!target.getHost().equalsIgnoreCase(origin.getHost()) || targetPort != originPort) {
                    throw new IllegalArgumentException("MCP connection must use the same service origin");
                }
            }
        }
    }
    public static void validateViews(PluginService.PluginMetadata meta, File directory) {
        if (meta.getContributes() == null || meta.getContributes().getViews() == null) return;
        Set<String> ids = new HashSet<>();
        Set<String> placements = new HashSet<>();
        for (PluginService.PluginViewDecl view : meta.getContributes().getViews()) {
            if (view == null || view.getId() == null || !view.getId().matches("[a-z][a-z0-9-]{0,49}")
                    || !ids.add(view.getId()) || !Set.of("sidebar", "workspace").contains(view.getPlacement())
                    || !placements.add(view.getPlacement()) || !Set.of("project", "global").contains(view.getScope())) {
                throw new IllegalArgumentException("Invalid plugin view: unique id and one view per placement are required");
            }
            String entry = view.getEntry();
            if (entry == null || !entry.startsWith("web/") || entry.contains("\\") || entry.contains("..") || entry.contains(":")) {
                throw new IllegalArgumentException("View entry must be a file below web/");
            }
            try {
                File root = directory.getCanonicalFile();
                File target = new File(root, entry).getCanonicalFile();
                if (!target.toPath().startsWith(new File(root, "web").toPath()) || !Files.isRegularFile(target.toPath())) {
                    throw new IllegalArgumentException("Plugin view entry is missing or escapes web/");
                }
            } catch (java.io.IOException e) { throw new IllegalArgumentException("Invalid plugin view path", e); }
            if (view.getAllowedDocks() != null && view.getAllowedDocks().stream().anyMatch(d -> !Set.of("left", "right", "bottom").contains(d))) {
                throw new IllegalArgumentException("Invalid view dock");
            }
            if (view.getDefaultDock() != null && (!Set.of("left", "right", "bottom").contains(view.getDefaultDock())
                    || (view.getAllowedDocks() != null && !view.getAllowedDocks().contains(view.getDefaultDock())))) {
                throw new IllegalArgumentException("Default dock must be allowed");
            }
        }
    }
}
