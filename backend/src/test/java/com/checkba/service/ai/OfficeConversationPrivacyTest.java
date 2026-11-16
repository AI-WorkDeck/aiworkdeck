// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ai;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;

/**
 * Stored Office history keeps everything except raw tool payloads. Regression: text before
 * the first payload (up to the last non-payload '<') used to be dropped, so restored rows
 * began with a dangling {@code process name="…">}.
 */
class OfficeConversationPrivacyTest {

    private static final String OMITTED = "[工具原始参数与输出不保留 / Raw tool payload not retained]";

    private static String omitted(String tag) {
        return "<" + tag + ">" + OMITTED + "</" + tag + ">";
    }

    @Test
    void keepsProcessTagBeforeFirstPayload() {
        String in = "<process name=\"列出项目文件\"><tool_code>{\"path\":\"/secret\"}</tool_code>"
                + "<tool_output>a.docx</tool_output></process><final>好的</final>";
        assertEquals("<process name=\"列出项目文件\">" + omitted("tool_code") + omitted("tool_output")
                + "</process><final>好的</final>", OfficeConversationPrivacy.forStorage(in));
    }

    @Test
    void keepsThinkingPreamble() {
        String in = "<thinking>先看目录</thinking><process name=\"x\"><tool_code>args</tool_code></process>";
        assertEquals("<thinking>先看目录</thinking><process name=\"x\">" + omitted("tool_code") + "</process>",
                OfficeConversationPrivacy.forStorage(in));
    }

    @Test
    void keepsProseAndComparisonsBeforeToolCall() {
        String in = "金额 a < b 时先核对。\n<tool_code>args</tool_code>\n然后 <b>继续</b>";
        assertEquals("金额 a < b 时先核对。\n" + omitted("tool_code") + "\n然后 <b>继续</b>",
                OfficeConversationPrivacy.forStorage(in));
    }

    @Test
    void scrubsEveryPayloadAndKeepsTextBetween() {
        String in = "<p>一</p><tool_code>A</tool_code><i>二</i><code>B</code><s>三</s><tool_output>C</tool_output>尾";
        assertEquals("<p>一</p>" + omitted("tool_code") + "<i>二</i>" + omitted("code") + "<s>三</s>"
                + omitted("tool_output") + "尾", OfficeConversationPrivacy.forStorage(in));
    }

    @Test
    void keepsPayloadAttributesAndCoversUnclosedPayload() {
        String in = "<process name=\"p\"><tool_code lang=\"json\">{\"a\":1}";
        assertEquals("<process name=\"p\"><tool_code lang=\"json\">" + OMITTED + "</tool_code>",
                OfficeConversationPrivacy.forStorage(in));
    }

    @Test
    void contentWithoutPayloadIsReturnedUnchanged() {
        String in = "<thinking>想</thinking><process name=\"p\"></process><final>a < b, <codex></final>";
        assertSame(in, OfficeConversationPrivacy.forStorage(in));
        assertNull(OfficeConversationPrivacy.forStorage(null));
        assertEquals("", OfficeConversationPrivacy.forStorage(""));
    }

    @Test
    void isIdempotentForTheStartupRescrub() {
        // AgentInboxService.scrubOfficeHistory re-applies forStorage to stored rows at startup.
        String in = "<thinking>t</thinking><process name=\"p\"><tool_code>A</tool_code></process>正文";
        String once = OfficeConversationPrivacy.forStorage(in);
        assertEquals(once, OfficeConversationPrivacy.forStorage(once));
    }
}
