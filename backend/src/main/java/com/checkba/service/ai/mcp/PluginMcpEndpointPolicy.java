// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.ai.mcp;

import java.net.InetAddress;
import java.net.URI;
import java.net.UnknownHostException;
import java.util.List;
import okhttp3.Dns;

/** Validate the actual addresses used by OkHttp DNS, not a separate preflight lookup. */
public final class PluginMcpEndpointPolicy implements Dns {
    private final boolean localTest;
    public PluginMcpEndpointPolicy() { this(false); }
    // Package-private: only isolated local HTTP fixtures can relax the production boundary.
    PluginMcpEndpointPolicy(boolean localTest) { this.localTest = localTest; }

    public static void validateUrl(String value) { new PluginMcpEndpointPolicy().validate(value); }
    void validate(String value) {
        try {
            URI u = URI.create(value);
            String host = u.getHost();
            if (host == null || u.getUserInfo() != null || u.getFragment() != null || u.getRawQuery() != null
                    || !("https".equals(u.getScheme()) || (localTest && "http".equals(u.getScheme()) && "127.0.0.1".equals(host))))
                throw new IllegalArgumentException();
            // OkHttp bypasses Dns for IP literals, so these need an explicit check too.
            if (host.contains(":") || host.matches("[0-9.]+")) {
                for (InetAddress address : InetAddress.getAllByName(host)) check(address);
            }
        } catch (Exception e) {
            throw new PluginMcpException("invalid_endpoint", 400, "MCP requires a public HTTPS endpoint without credentials, query or fragment.");
        }
    }

    @Override public List<InetAddress> lookup(String hostname) throws UnknownHostException {
        List<InetAddress> addresses = Dns.SYSTEM.lookup(hostname);
        for (InetAddress address : addresses) check(address);
        return addresses;
    }

    private void check(InetAddress a) throws UnknownHostException {
        if (localTest && a.isLoopbackAddress()) return;
        byte[] b = a.getAddress();
        boolean blocked = a.isAnyLocalAddress() || a.isLoopbackAddress() || a.isLinkLocalAddress()
                || a.isSiteLocalAddress() || a.isMulticastAddress();
        if (b.length == 4) {
            int x = b[0] & 255, y = b[1] & 255;
            blocked |= x == 0 || x >= 224 || (x == 100 && y >= 64 && y <= 127)
                    || (x == 192 && y == 0 && (b[2] & 255) == 0) || (x == 198 && (y == 18 || y == 19));
        } else {
            blocked |= (b[0] & 0xfe) == 0xfc;
        }
        if (blocked) throw new UnknownHostException("MCP endpoint resolved to a non-public address.");
    }
}
