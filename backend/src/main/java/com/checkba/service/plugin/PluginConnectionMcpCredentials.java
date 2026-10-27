// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.plugin;

import com.checkba.service.SystemSettingService;
import com.checkba.service.ai.PluginService;
import com.checkba.service.ai.mcp.PluginMcpCredentialResolver;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

@Service
@RequiredArgsConstructor
public class PluginConnectionMcpCredentials implements PluginMcpCredentialResolver {
    private final PluginConnectionService connections;
    private final PluginService plugins;
    private final SystemSettingService settings;

    @Override public java.util.function.BooleanSupplier guard(String pluginId, Long userId, String connectionId) {
        return connectionId == null ? () -> true : connections.guard(pluginId, userId, connectionId);
    }
    @Override public String resolveForEndpoint(String pluginId, Long userId, String connectionId, String key, String endpoint) {
        if (connectionId != null) return connections.bearerTokenForEndpoint(pluginId, userId, connectionId, endpoint);
        return resolve(pluginId, userId, null, key);
    }
    @Override public String resolve(String pluginId, Long userId, String connectionId, String key) {
        if (connectionId != null) throw new IllegalArgumentException("An explicit endpoint is required for connection credentials");
        if (key == null) return "";
        var plugin = plugins.getPlugin(pluginId);
        if (plugin == null || !plugins.isEnabled(pluginId) || !key.matches("[A-Za-z][A-Za-z0-9_-]{0,63}")
                || plugin.getSettings() == null || plugin.getSettings().stream().noneMatch(s -> key.equals(s.getKey())
                && Boolean.TRUE.equals(s.getSecret()) && (s.getScope() == null || "installation".equals(s.getScope())))) {
            throw new IllegalArgumentException("Invalid plugin credential reference");
        }
        return settings.get("plugin." + pluginId + "." + key, "");
    }
}
