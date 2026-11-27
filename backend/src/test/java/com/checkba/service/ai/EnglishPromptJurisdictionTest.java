// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.ai;

import org.junit.jupiter.api.Test;
import org.springframework.core.io.ClassPathResource;

import java.nio.charset.StandardCharsets;

import static org.junit.jupiter.api.Assertions.*;

/**
 * 0.91.0（国际站上线检查）：英文界面下律师问「你能做什么」，模型把 law_* 工具的「仅限中国大陆法」
 * 复述成「研究中国及其他法域的法律」。英文系统提示要求自我介绍时按用户事项所适用的法域描述，不点名国家。
 */
class EnglishPromptJurisdictionTest {

    @Test
    void englishPromptKeepsSelfDescriptionJurisdictionNeutral() throws Exception {
        String prompt = new String(new ClassPathResource("prompts/system_prompt.en.md").getInputStream().readAllBytes(),
                StandardCharsets.UTF_8);
        String identity = prompt.substring(0, prompt.indexOf("# Core Protocol"));
        assertTrue(identity.contains("jurisdiction-neutral"));
        assertTrue(identity.contains("When you describe what you can do"), "self-description rule sits in the identity section");
        assertTrue(identity.contains("Do not name a particular country's law as your specialty or say you research PRC law"));
        assertTrue(identity.contains("cover mainland China law only"), "accurate about what the law tools cover");
        assertTrue(identity.contains("When a matter is governed by PRC law, use the law tools as usual"));
        assertFalse(identity.contains("Mainland China Law"), "the English identity never claims a PRC specialty");
    }
}
