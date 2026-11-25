// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.ai;

import static org.junit.jupiter.api.Assertions.*;

import com.checkba.service.AppLanguageScope;
import java.util.List;
import org.junit.jupiter.api.Test;

/** X39: helpers behind "Continue a cut-off answer". */
class ContinuationHelpersTest {

    @Test
    void onlyAnAnswerEndingInTheInterruptedMarkerIsResumable() {
        assertEquals("前半段正文。", AgentOrchestrator.stripInterruptedMarker("前半段正文。\n\n[生成出错，已中断]"));
        assertEquals("First half.", AgentOrchestrator.stripInterruptedMarker("First half.\n\n[Generation error, interrupted]\n"));
        assertNull(AgentOrchestrator.stripInterruptedMarker("A complete answer."));
        assertNull(AgentOrchestrator.stripInterruptedMarker("[生成出错，已中断] then more text"));
        assertNull(AgentOrchestrator.stripInterruptedMarker(null));
    }

    @Test
    void appliedWritesListsOnlySuccessfulWriteCalls() {
        String log = "<process name=\"Replace\"><tool_code>doc_replace_at_anchor({\"anchor\": \"a1\", \"text\": \"15 日\"})</tool_code></process>"
                + "<tool_output status=\"SUCCESS\">ok</tool_output>"
                + "<process name=\"Read\"><tool_code>doc_get_document_text({})</tool_code></process><tool_output status=\"SUCCESS\">…</tool_output>"
                + "<process name=\"Comment\"><tool_code>doc_add_comment({\"text\": \"x\"})</tool_code></process><tool_output status=\"FAILURE\">Error</tool_output>"
                + "正文……";
        List<String> w = AgentOrchestrator.appliedWrites(log);
        assertEquals(1, w.size(), String.valueOf(w));
        assertTrue(w.get(0).startsWith("doc_replace_at_anchor("), w.get(0));
    }

    @Test
    void theInstructionSaysContinueAndListsWhatNotToRedo() {
        String zh = AppLanguageScope.call("zh-CN", () -> AgentOrchestrator.continuationInstruction(List.of("doc_replace_at_anchor({\"anchor\": \"a1\"})")));
        assertTrue(zh.startsWith("你上一条回答在上文末尾被截断。请从断开处直接接着写"), zh);
        assertTrue(zh.contains("不要再次执行") && zh.contains("doc_replace_at_anchor"), zh);
        String en = AppLanguageScope.call("en-US", () -> AgentOrchestrator.continuationInstruction(List.of()));
        assertEquals("Your previous answer was cut off at the end of the text above. Continue exactly from where it stopped. Do not repeat or summarize what is already written, and do not restart.", en);
    }

    @Test
    void theStoredSeamDoesNotOpenASecondFinalBlock() {
        String prefix = "<final>**风险提示**\n第一，违约金过高。建议分两档，并";
        assertEquals(prefix + "为每档设上限。</final>",
                AgentOrchestrator.joinContinuation(prefix, prefix + "<final>为每档设上限。</final>"));
        // prefix already closed: the continuation's own block is kept
        String closed = "<final>完整的一段。</final>";
        assertEquals(closed + "<final>新的一段</final>", AgentOrchestrator.joinContinuation(closed, closed + "<final>新的一段</final>"));
        // not a continuation save: untouched
        assertEquals("<final>x</final>", AgentOrchestrator.joinContinuation(null, "<final>x</final>"));
    }
}
