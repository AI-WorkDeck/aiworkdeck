// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.util;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

/** 防滥用计数的客户端 IP：只在回环对端（同机 nginx）时采信 X-Real-IP，X-Forwarded-For 永不采信。 */
class ClientIpTest {

    private static MockHttpServletRequest req(String remote, String realIp, String xff) {
        MockHttpServletRequest r = new MockHttpServletRequest();
        r.setRemoteAddr(remote);
        if (realIp != null) r.addHeader("X-Real-IP", realIp);
        if (xff != null) r.addHeader("X-Forwarded-For", xff);
        return r;
    }

    @Test
    @DisplayName("回环对端：取 nginx 写入的 X-Real-IP（IPv4 / IPv6 / 回环的各种写法）")
    void loopbackPeerUsesRealIp() {
        assertEquals("198.51.100.7", ClientIp.of(req("127.0.0.1", "198.51.100.7", null)));
        assertEquals("2001:db8::1", ClientIp.of(req("0:0:0:0:0:0:0:1", "2001:db8::1", null)));
        assertEquals("198.51.100.7", ClientIp.of(req("::1", " 198.51.100.7 ", null)));
        assertEquals("198.51.100.7", ClientIp.of(req("::ffff:127.0.0.1", "198.51.100.7", null)));
    }

    @Test
    @DisplayName("非回环对端：头一律不看，用对端地址")
    void nonLoopbackPeerIgnoresHeaders() {
        assertEquals("192.0.2.50", ClientIp.of(req("192.0.2.50", "10.0.0.1", "10.0.0.2")));
    }

    @Test
    @DisplayName("X-Forwarded-For 永不采信；回环但没有 / 不像 IP 的 X-Real-IP 退回对端地址")
    void forwardedForAndJunkAreIgnored() {
        assertEquals("127.0.0.1", ClientIp.of(req("127.0.0.1", null, "198.51.100.7")));
        assertEquals("127.0.0.1", ClientIp.of(req("127.0.0.1", "evil.example", null)));
        assertEquals("127.0.0.1", ClientIp.of(req("127.0.0.1", "1.2.3.4, 5.6.7.8", null)));
        assertNull(ClientIp.of(null));
    }
}
