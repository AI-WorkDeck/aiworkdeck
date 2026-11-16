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
    /**
     * Declarative Agent tools (spec section 20): same rules as {@code scripts/plugin-dev.mjs validate}.
     * Legacy entries (name/description/permissions only) are not inspected. Throws IllegalArgumentException.
     */
    public static void validateTools(PluginService.PluginMetadata meta) {
        if (meta.getTools() == null) return;
        String prefix = String.valueOf(meta.getId()).replace('-', '_') + "_";
        Set<String> declaredPermissions = meta.getPermissions() == null ? Set.of() : new HashSet<>(meta.getPermissions());
        Set<String> seen = new HashSet<>();
        java.util.List<com.checkba.service.plugin.PluginConnectionService.Connection> connections = null;
        for (PluginService.PluginToolInfo tool : meta.getTools()) {
            if (tool == null || !tool.isDeclarative()) continue;
            String label = "tools." + tool.getName() + ": ";
            if (tool.getName() == null || !tool.getName().matches("[A-Za-z][A-Za-z0-9_]{1,63}")) throw new IllegalArgumentException(label + "invalid tool name");
            if (!seen.add(tool.getName())) throw new IllegalArgumentException(label + "duplicate tool name");
            if (tool.getDescription() == null || tool.getDescription().isBlank()) throw new IllegalArgumentException(label + "description must not be blank");
            if (!Set.of("read", "write", "destructive").contains(tool.getAccess())) throw new IllegalArgumentException(label + "access is required: read | write | destructive");
            if (tool.getConfirm() != null && !Set.of("auto", "always", "never").contains(tool.getConfirm())) throw new IllegalArgumentException(label + "invalid confirm");
            String type = tool.handlerType();
            if (!Set.of("jar", "service", "connection", "view").contains(type)) throw new IllegalArgumentException(label + "unknown handler.type: " + type);
            if (!"jar".equals(type) && !tool.getName().startsWith(prefix)) throw new IllegalArgumentException(label + "non-JAR tool name must start with " + prefix);
            if (tool.getPermissions() != null) for (String permission : tool.getPermissions()) {
                if (!declaredPermissions.contains(permission)) throw new IllegalArgumentException(label + "permission not declared in manifest.permissions: " + permission);
            }
            if (tool.getInputSchema() != null) {
                try { com.checkba.service.ai.mcp.PluginMcpSchema.object(tool.getInputSchema()); }
                catch (RuntimeException e) { throw new IllegalArgumentException(label + "invalid inputSchema"); }
            }
            var handler = tool.getHandler();
            if ("service".equals(type)) {
                if (com.checkba.service.plugin.HostServiceRegistry.spec(handler.getService(), handler.getOperation()).isEmpty()) {
                    throw new IllegalArgumentException(label + "unknown host service operation: " + handler.getService() + "." + handler.getOperation());
                }
            } else if ("connection".equals(type)) {
                if (connections == null) connections = com.checkba.service.plugin.PluginConnectionService.parseDeclarations(meta);
                var connection = connections.stream().filter(c -> c.id().equals(handler.getConnectionId())).findFirst()
                        .orElseThrow(() -> new IllegalArgumentException(label + "handler.connectionId is not a declared connection: " + handler.getConnectionId()));
                if (connection.operations() == null || !connection.operations().containsKey(handler.getOperation())) {
                    throw new IllegalArgumentException(label + "unknown connection operation: " + handler.getConnectionId() + "." + handler.getOperation());
                }
            } else if ("view".equals(type)) {
                boolean declared = meta.getContributes() != null && meta.getContributes().getViews() != null
                        && meta.getContributes().getViews().stream().anyMatch(v -> v != null && v.getId() != null && v.getId().equals(handler.getViewId()));
                if (!declared) throw new IllegalArgumentException(label + "handler.viewId is not a declared view: " + handler.getViewId());
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
