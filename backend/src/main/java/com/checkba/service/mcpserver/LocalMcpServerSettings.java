// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.mcpserver;

import com.checkba.service.SystemSettingService;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.HexFormat;

/**
 * 本机 MCP 服务器的开关与访问令牌。
 *
 * <p>默认关闭；只有用户显式开启才签发令牌。库里只存令牌的 SHA-256，明文只在开启 / 轮换时返回一次。
 * 关闭即清掉摘要，旧令牌立即失效。
 */
@Service
@RequiredArgsConstructor
public class LocalMcpServerSettings {

    static final String KEY_ENABLED = "mcp_server.enabled";
    static final String KEY_TOKEN_SHA256 = "mcp_server.token_sha256";
    /** 令牌前缀：便于密钥扫描识别，也和 awdk_ / awdt_ 区分开。 */
    static final String TOKEN_PREFIX = "awdm_";

    private static final SecureRandom RANDOM = new SecureRandom();

    private final SystemSettingService settings;

    public boolean isEnabled() {
        return "true".equals(settings.get(KEY_ENABLED, "false"))
                && !settings.get(KEY_TOKEN_SHA256, "").isEmpty();
    }

    /** 开启（或轮换令牌）：签发新令牌并返回明文，旧令牌作废。 */
    public synchronized String enableAndIssueToken() {
        byte[] raw = new byte[32];
        RANDOM.nextBytes(raw);
        String token = TOKEN_PREFIX + Base64.getUrlEncoder().withoutPadding().encodeToString(raw);
        settings.set(KEY_TOKEN_SHA256, sha256(token));
        settings.set(KEY_ENABLED, "true");
        return token;
    }

    public synchronized void disable() {
        settings.set(KEY_ENABLED, "false");
        settings.set(KEY_TOKEN_SHA256, "");
    }

    /** 开启状态下令牌是否匹配（常量时间比较）。关闭时一律 false。 */
    public boolean verify(String token) {
        if (token == null || !token.startsWith(TOKEN_PREFIX) || !isEnabled()) return false;
        String expected = settings.get(KEY_TOKEN_SHA256, "");
        return MessageDigest.isEqual(expected.getBytes(StandardCharsets.US_ASCII),
                sha256(token).getBytes(StandardCharsets.US_ASCII));
    }

    static String sha256(String value) {
        try {
            return HexFormat.of().formatHex(
                    MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
