// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.util;

import jakarta.servlet.http.HttpServletRequest;

import java.util.Locale;
import java.util.regex.Pattern;

/**
 * 防滥用计数用的「真实客户端 IP」，{@code AuthAbuseGuard} 的所有按 IP 计数都从这里取。
 *
 * <p>服务端 profile 后端只监听 127.0.0.1，公网请求必经同机 nginx。对端是回环时才采信
 * {@code X-Real-IP}（deploy 下的 nginx 模板在每个反代 {@code /api/} 的 location 都用
 * {@code $remote_addr} 覆盖它，客户端自带的值进不来）；对端不是回环就用对端地址本身，
 * 头一律不看。{@code X-Forwarded-For} 永远不看：它是可追加的链，客户端能往里塞任意值。
 *
 * <p>case/cloud profile 另开了 {@code forward-headers-strategy: native}（RemoteIpValve），
 * 那里 {@code getRemoteAddr()} 到这一步已是真实地址（非回环），本类原样返回；
 * 没开它的 profile（prod/团队服务器）则由本类从 {@code X-Real-IP} 还原，不再退化成全站一个桶。
 */
public final class ClientIp {

    private static final Pattern IPV4_LOOPBACK = Pattern.compile("127\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}");
    /** 只收 IP 字面量的字符集，防止任意字符串被当成计数键。 */
    private static final Pattern IP_LITERAL = Pattern.compile("[0-9A-Fa-f:.]{2,45}");

    private ClientIp() {}

    public static String of(HttpServletRequest request) {
        if (request == null) return null;
        String remote = request.getRemoteAddr();
        if (isLoopback(remote)) {
            String real = request.getHeader("X-Real-IP");
            if (real != null) {
                real = real.trim();
                if (IP_LITERAL.matcher(real).matches() && (real.indexOf('.') >= 0 || real.indexOf(':') >= 0)) {
                    return real;
                }
            }
        }
        return remote;
    }

    /** 只认 IP 字面量（getRemoteAddr 不会回主机名），不做 DNS 解析。 */
    static boolean isLoopback(String addr) {
        if (addr == null || addr.isBlank()) return false;
        String a = addr.trim().toLowerCase(Locale.ROOT);
        int zone = a.indexOf('%');
        if (zone > 0) a = a.substring(0, zone);
        if (a.startsWith("[") && a.endsWith("]")) a = a.substring(1, a.length() - 1);
        if (a.startsWith("::ffff:")) a = a.substring("::ffff:".length());
        return "::1".equals(a) || "0:0:0:0:0:0:0:1".equals(a) || IPV4_LOOPBACK.matcher(a).matches();
    }
}
