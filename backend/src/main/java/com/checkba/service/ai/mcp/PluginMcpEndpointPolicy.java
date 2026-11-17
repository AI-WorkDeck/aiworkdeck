// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
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
    private final Dns system;
    private final Dns publicDns;
    public PluginMcpEndpointPolicy() { this(false); }
    // Package-private: only isolated local HTTP fixtures can relax the production boundary.
    PluginMcpEndpointPolicy(boolean localTest) { this(localTest, Dns.SYSTEM, new PluginPublicDns()); }
    PluginMcpEndpointPolicy(boolean localTest, Dns system, Dns publicDns) {
        this.localTest = localTest;
        this.system = system;
        this.publicDns = publicDns;
    }

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
        List<InetAddress> addresses = system.lookup(hostname);
        boolean fakeIp = false;
        for (InetAddress address : addresses) {
            if (isFakeIp(address)) fakeIp = true;
            else check(address); // A mixed private/fake answer must still fail closed.
        }
        if (fakeIp) {
            // Literals never gain an exception, even if this Dns is invoked directly.
            if (hostname.contains(":") || hostname.matches("[0-9.]+")) {
                throw new UnknownHostException("IP literal is not a public destination.");
            }
            try {
                addresses = publicDns.lookup(hostname);
                if (addresses.isEmpty()) throw new UnknownHostException("Empty public DNS answer.");
                for (InetAddress address : addresses) check(address);
            } catch (UnknownHostException e) {
                throw new FakeIpResolutionException(e);
            }
        }
        return addresses;
    }

    private static boolean isFakeIp(InetAddress address) {
        byte[] bytes = address.getAddress();
        return bytes.length == 4 && (bytes[0] & 255) == 198 && ((bytes[1] & 255) == 18 || (bytes[1] & 255) == 19);
    }

    public static boolean isFakeIpResolutionFailure(Throwable failure) {
        for (Throwable cause = failure; cause != null; cause = cause.getCause()) {
            if (cause instanceof FakeIpResolutionException) return true;
        }
        return false;
    }

    public static String fakeIpFailureMessage() {
        return com.checkba.service.LangText.of(
                "代理返回了虚拟 IP，且无法确认服务的公网地址。请检查网络或将该服务域名加入代理的真实 DNS 解析列表后重试。",
                "The proxy returned a fake IP and the service's public address could not be verified. Check your network or exclude this service domain from fake-IP DNS, then retry.");
    }

    private static final class FakeIpResolutionException extends UnknownHostException {
        FakeIpResolutionException(Throwable cause) {
            super("Fake-IP DNS could not be resolved to a public destination.");
            initCause(cause);
        }
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
