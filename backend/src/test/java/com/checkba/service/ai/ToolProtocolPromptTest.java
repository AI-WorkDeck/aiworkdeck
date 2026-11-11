// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.ai;

import org.junit.jupiter.api.Test;
import org.springframework.core.io.ClassPathResource;
import org.springframework.util.StreamUtils;

import java.nio.charset.StandardCharsets;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** 工具协议提示变体（gap P2）：XML 变体逐字节不变，原生变体不再教文本协议。 */
class ToolProtocolPromptTest {

    private static String read(String path) throws Exception {
        return StreamUtils.copyToString(new ClassPathResource(path).getInputStream(), StandardCharsets.UTF_8);
    }

    @Test
    void xmlVariantIsTheOriginalTextWithMarkersRemoved() throws Exception {
        for (String file : new String[] {"prompts/system_prompt.md", "prompts/system_prompt.en.md"}) {
            String raw = read(file);
            String xml = ToolProtocolPrompt.select(raw, false);
            assertFalse(xml.contains("awd:protocol"), file);
            // 改造前的原文标志句都在，且 native 段一个字都没混进来
            assertTrue(xml.contains("## Output Structure (REQUIRED ORDER)"), file);
            assertTrue(xml.contains("<tool_code>tool_name(args)</tool_code>"), file);
            assertTrue(xml.contains("[REQUIRED] Briefly analyze user intent"), file);
            assertFalse(xml.contains("function calling") || xml.contains("function-calling"), file);
        }
    }

    @Test
    void nativeVariantTeachesNoTextProtocol() throws Exception {
        for (String file : new String[] {"prompts/system_prompt.md", "prompts/system_prompt.en.md"}) {
            String nat = ToolProtocolPrompt.select(read(file), true);
            assertFalse(nat.contains("awd:protocol"), file);
            assertFalse(nat.contains("<tool_code"), file);
            assertFalse(nat.contains("<thinking>"), file);
            assertFalse(nat.contains("<process"), file);
            assertFalse(nat.contains("tool_output"), file);
            // 前端据以路由的回答标签必须还在
            for (String tag : new String[] {"<final>", "<question>", "<artifact type=", "<walkthrough>", "<title>"}) {
                assertTrue(nat.contains(tag), file + " 缺 " + tag);
            }
        }
        assertTrue(ToolProtocolPrompt.select(read("prompts/system_prompt.md"), true).contains("不要把工具调用写成文字"));
        assertTrue(ToolProtocolPrompt.select(read("prompts/system_prompt.en.md"), true)
                .contains("never write a tool call as text"));
    }

    @Test
    void bothLanguagesCarryTheSameVariantBlocks() throws Exception {
        assertEquals(count(read("prompts/system_prompt.md")), count(read("prompts/system_prompt.en.md")));
        assertEquals(4, count(read("prompts/system_prompt.md")));
    }

    private static int count(String raw) {
        return raw.split("<!-- awd:protocol:xml -->\n", -1).length - 1;
    }

    @Test
    void detectsTextCallAttemptsButNotCodeSamples() {
        assertTrue(XmlToolCallParser.containsUnexecutedCallAttempt(
                "<tool_code=create_folder>\n<parameter=folderName>x</parameter>\n</tool_code>"));
        assertTrue(XmlToolCallParser.containsUnexecutedCallAttempt(
                "先确认一下。\n<ask_user>\n<parameter=question>改成哪种？</parameter>\n</ask_user>"));
        assertTrue(XmlToolCallParser.containsUnexecutedCallAttempt("<function=law_search>{\"query\":\"x\"}</function>"));
        assertTrue(XmlToolCallParser.containsUnexecutedCallAttempt("<｜DSML｜invoke name=\"write_docx\">"));
        assertTrue(XmlToolCallParser.containsUnexecutedCallAttempt("<tool_call>{\"name\":\"law_search\"}</tool_call>"));
        assertFalse(XmlToolCallParser.containsUnexecutedCallAttempt("<final>已完成，共修改 3 处。</final>"));
        assertFalse(XmlToolCallParser.containsUnexecutedCallAttempt(
                "<final>写法：\n```xml\n<tool_code>law_search(query=\"x\")</tool_code>\n```\n以及 `<parameter=q>`。</final>"));
        assertFalse(XmlToolCallParser.containsUnexecutedCallAttempt("<question>受让方是自然人还是公司？</question>"));
        assertFalse(XmlToolCallParser.containsUnexecutedCallAttempt(null));
    }

    @Test
    void detectsThinkingOnlyTurns() {
        assertTrue(XmlToolCallParser.isThinkingOnly("<thinking>需要查法条。</thinking>"));
        assertTrue(XmlToolCallParser.isThinkingOnly("<thinking>需要查法条"));
        assertTrue(XmlToolCallParser.isThinkingOnly("<thinking>分析</thinking>\n<title>查法条</title>\n"));
        assertFalse(XmlToolCallParser.isThinkingOnly("<thinking>分析</thinking>你好，有什么可以帮您？"));
        assertFalse(XmlToolCallParser.isThinkingOnly("<thinking>分析</thinking><final>答案</final>"));
        assertFalse(XmlToolCallParser.isThinkingOnly(""));
        assertFalse(XmlToolCallParser.isThinkingOnly("你好"));
    }
}
