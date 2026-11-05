// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ai;

import org.springframework.core.env.Environment;
import org.springframework.core.env.Profiles;
import org.springframework.stereotype.Component;

/**
 * 模拟 AI 只许在本地开发环境打开：{@code ai.mock.enabled=true} 必须同时激活 {@code dev} profile，
 * 且不能和任何发行/部署 profile（prod、cloud、case、desktop）同时激活，否则启动失败。
 * 失败而不是静默忽略：误配到生产上时，用户看到的会是「模拟回复」，比报错更难发现。
 *
 * <p>模拟档也不能通过 {@code ai.model.provider} 或设置页选中，唯一入口是 {@code ai.mock.enabled}。
 */
@Component
public class MockAiGuard {

    static final String[] RELEASE_PROFILES = {"prod", "cloud", "case", "desktop"};

    public MockAiGuard(Environment env) {
        check(env);
    }

    static void check(Environment env) {
        if ("mock".equalsIgnoreCase(String.valueOf(env.getProperty("ai.model.provider", "")).trim())) {
            throw new IllegalStateException(
                    "ai.model.provider=mock is not allowed; use ai.mock.enabled=true with the dev profile");
        }
        if (!env.getProperty("ai.mock.enabled", Boolean.class, false)) return;
        if (!env.acceptsProfiles(Profiles.of("dev")) || env.acceptsProfiles(Profiles.of(RELEASE_PROFILES))) {
            throw new IllegalStateException(
                    "ai.mock.enabled=true is only allowed with the 'dev' profile and no release profile "
                            + "(prod/cloud/case/desktop). Active profiles: "
                            + String.join(",", env.getActiveProfiles()));
        }
    }
}
