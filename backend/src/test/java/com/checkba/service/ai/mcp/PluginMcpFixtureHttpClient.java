// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.ai.mcp;

import java.util.Map;
import java.util.function.BooleanSupplier;

/** Test classpath only: route one production-valid declaration to an isolated HTTP fixture.
 * The normal client still performs HTTP, session negotiation, discovery, SSE and cancellation.
 * No other URL may reach the fixture or the network through this adapter. */
public final class PluginMcpFixtureHttpClient extends PluginMcpHttpClient {
    public static final String DECLARED_URL = "https://service.example.invalid/mcp";
    private final String fixtureUrl;

    public PluginMcpFixtureHttpClient(int port) {
        super(new PluginMcpEndpointPolicy(true));
        if (port < 1 || port > 65535) throw new IllegalArgumentException("Invalid fixture port");
        fixtureUrl = "http://127.0.0.1:" + port + "/mcp";
    }

    @Override public Map<String, Object> call(String url, String token, String name,
            Map<String, Object> schema, Map<String, Object> arguments, BooleanSupplier allowed) {
        PluginMcpEndpointPolicy.validateUrl(url);
        if (!DECLARED_URL.equals(url)) throw new IllegalArgumentException("Endpoint is outside the fixture allowlist");
        return super.call(fixtureUrl, token, name, schema, arguments, allowed);
    }
}
