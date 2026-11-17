// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.ai.mcp;

import okhttp3.Dns;
import org.junit.jupiter.api.Test;
import java.net.InetAddress;
import java.net.UnknownHostException;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import static org.junit.jupiter.api.Assertions.*;

class PluginMcpEndpointPolicyTest {
    private static List<InetAddress> addresses(String... values) throws UnknownHostException {
        var result = new java.util.ArrayList<InetAddress>();
        for (String value : values) result.add(InetAddress.getByName(value));
        return result;
    }

    @Test void normalPublicDnsDoesNotContactFallback() throws Exception {
        var expected = addresses("93.184.215.14", "2606:4700::1111");
        var policy = new PluginMcpEndpointPolicy(false, host -> expected,
                host -> { throw new AssertionError("Normal DNS must not use public resolver"); });
        assertEquals(expected, policy.lookup("service.example"));
    }

    @Test void fakeIpsAreReplacedWithCheckedAddressesForTheSameHostname() throws Exception {
        var expected = addresses("93.184.215.14", "2606:4700::1111");
        for (String fake : List.of("198.18.0.1", "198.19.255.254")) {
            var policy = new PluginMcpEndpointPolicy(false, host -> addresses(fake), host -> {
                assertEquals("service.example", host);
                return expected;
            });
            assertEquals(expected, policy.lookup("service.example"));
        }
    }

    @Test void privateSystemAnswersCannotBeHiddenByFakeIps() {
        var calls = new AtomicInteger();
        for (String privateIp : List.of("127.0.0.1", "10.0.0.1", "169.254.169.254", "100.64.0.1", "::1", "fc00::1")) {
            for (boolean mixed : List.of(false, true)) {
                var policy = new PluginMcpEndpointPolicy(false,
                        host -> mixed ? addresses("198.18.0.1", privateIp) : addresses(privateIp),
                        host -> { calls.incrementAndGet(); return addresses("93.184.215.14"); });
                assertThrows(UnknownHostException.class, () -> policy.lookup("service.example"));
            }
        }
        assertEquals(0, calls.get());
    }

    @Test void fallbackMustContainOnlyPublicAddresses() {
        for (String invalid : List.of("127.0.0.1", "10.0.0.1", "169.254.169.254", "100.64.0.1", "198.18.0.9", "198.19.0.9", "::1", "fc00::1", "::ffff:127.0.0.1")) {
            var policy = new PluginMcpEndpointPolicy(false, host -> addresses("198.18.0.1"),
                    host -> addresses("93.184.215.14", invalid));
            var failure = assertThrows(UnknownHostException.class, () -> policy.lookup("service.example"));
            assertTrue(PluginMcpEndpointPolicy.isFakeIpResolutionFailure(failure));
        }
    }

    @Test void emptyAndFailedFallbackProduceRecognizableSafeFailure() {
        for (Dns fallback : List.<Dns>of(host -> List.of(), host -> { throw new UnknownHostException("provider detail"); })) {
            var policy = new PluginMcpEndpointPolicy(false, host -> addresses("198.18.0.1"), fallback);
            var failure = assertThrows(UnknownHostException.class, () -> policy.lookup("service.example"));
            assertTrue(PluginMcpEndpointPolicy.isFakeIpResolutionFailure(new java.io.IOException(failure)));
            assertFalse(failure.getMessage().contains("provider detail"));
        }
    }

    @Test void literalFakeIpsRemainBlockedWithoutFallback() {
        var policy = new PluginMcpEndpointPolicy(false, host -> addresses("198.18.0.1"),
                host -> { throw new AssertionError("Literal must not use fallback"); });
        assertThrows(UnknownHostException.class, () -> policy.lookup("198.18.0.1"));
        for (String host : List.of("198.18.0.1", "198.19.0.1", "127.0.0.1", "[::ffff:198.18.0.1]"))
            assertThrows(PluginMcpException.class, () -> policy.validate("https://" + host + "/service"));
    }

    @Test void connectionAndMcpSurfaceTheDnsFailureWithoutLeakingProviderDetails() {
        var policy = new PluginMcpEndpointPolicy(false, host -> addresses("198.18.0.1"),
                host -> { throw new UnknownHostException("private upstream detail"); });
        class Service extends com.checkba.service.plugin.PluginConnectionService {
            Service() { super(null, null, null, ""); }
            void request() { exchange("https://service.example/operation", "GET", "synthetic-secret", "", false); }
        }
        var service = new Service();
        org.springframework.test.util.ReflectionTestUtils.setField(service, "http",
                new okhttp3.OkHttpClient.Builder().dns(policy).proxy(java.net.Proxy.NO_PROXY).build());
        var failure = assertThrows(IllegalStateException.class, service::request);
        assertEquals(PluginMcpEndpointPolicy.fakeIpFailureMessage(), failure.getMessage());
        var controller = new com.checkba.controller.ai.PluginConnectionController(service, null, null, null, null, null);
        assertEquals("dns_resolution_failed", controller.error(failure).getBody().get("errorCode"));
        assertFalse(failure.getMessage().contains("private upstream detail"));
        assertFalse(failure.getMessage().contains("synthetic-secret"));
        var mcp = assertThrows(PluginMcpException.class,
                () -> new PluginMcpHttpClient(policy).listTools("https://service.example/mcp", "synthetic-secret", () -> true));
        assertEquals("dns_resolution_failed", mcp.code());
        assertEquals(PluginMcpEndpointPolicy.fakeIpFailureMessage(), mcp.getMessage());
    }
}
