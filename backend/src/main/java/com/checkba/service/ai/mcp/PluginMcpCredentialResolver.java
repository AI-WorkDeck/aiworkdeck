// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.ai.mcp;

/** Host-owned credential lookup. Never expose the result to plugin UI or tool arguments. */
@FunctionalInterface
public interface PluginMcpCredentialResolver {
    default String resolveForEndpoint(String pluginId, Long userId, String connectionId, String credentialKey, String endpoint) {
        return resolve(pluginId, userId, connectionId, credentialKey);
    }
    default java.util.function.BooleanSupplier guard(String pluginId, Long userId, String connectionId) {
        return () -> true;
    }
    String resolve(String pluginId, Long userId, String connectionId, String credentialKey);
}
