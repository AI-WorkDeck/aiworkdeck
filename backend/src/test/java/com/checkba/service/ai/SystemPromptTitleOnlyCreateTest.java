// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ai;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.charset.StandardCharsets;

import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * s07 回放（矩阵 0/5 DeepSeek、0/3 Qwen 之一）：「新建一份Word文档，标题是『法律意见书』」。
 *
 * <p>病灶之二：基底 prompt 的 Clarification 写着「起草类缺要素就停下来问、不要用占位符」，模型于是
 * 先列文件再 ask_user「这份意见书涉及什么事项」，或编一整套带占位符的模板（长参数更容易在传输中被切断）。
 * 用户只给了类型和标题时，要的就是这份带标题的文档本身——「不要问」清单里必须有这一条。
 */
@DisplayName("仅给文档类型+标题的新建请求：直接建，不反问、不编模板")
class SystemPromptTitleOnlyCreateTest {

    private static String load(String name) throws IOException {
        try (var in = SystemPromptTitleOnlyCreateTest.class.getResourceAsStream("/prompts/" + name)) {
            return new String(in.readAllBytes(), StandardCharsets.UTF_8);
        }
    }

    @Test
    void chineseDoNotAskListCoversTitleOnlyCreate() throws IOException {
        String p = load("system_prompt.md");
        String notAsk = p.substring(p.indexOf("### 什么时候不要问"), p.indexOf("### 一次只问一组"));
        assertTrue(notAsk.contains("只给了文档类型和标题的新建请求"), notAsk);
        assertTrue(notAsk.contains("write_docx"), notAsk);
    }

    @Test
    void englishDoNotAskListCoversTitleOnlyCreate() throws IOException {
        String p = load("system_prompt.en.md");
        String notAsk = p.substring(p.indexOf("### When NOT to ask"), p.indexOf("### Ask everything in ONE round"));
        assertTrue(notAsk.contains("only a document type and title"), notAsk);
        assertTrue(notAsk.contains("write_docx"), notAsk);
    }
}
