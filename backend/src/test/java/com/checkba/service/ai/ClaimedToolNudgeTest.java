// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.ai;

import com.checkba.model.ai.AgentMode;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.Set;
import java.util.function.Predicate;

import static org.junit.jupiter.api.Assertions.*;

class ClaimedToolNudgeTest {

    private static final Predicate<String> TOOLS = Set.of("save_memory", "doc_export_pdf", "write_docx")::contains;

    private static AgentOrchestrator.RunGuard guard() {
        return new AgentOrchestrator.RunGuard("conv-t", "run-t", 0L);
    }

    @Test
    @DisplayName("零工具轮次、回答点名真实工具（百炼 qwen 实录「我调用了 save_memory」）→ 纠正一次")
    void claimWithoutAnyToolIsNudgedOnce() {
        var g = guard();
        String answer = "<final>已记录您的偏好。</final><walkthrough>我调用了 save_memory 工具保存偏好。</walkthrough>";
        String nudge = AgentOrchestrator.claimedToolNudgeIfNeeded(g, answer, AgentMode.AGENT, TOOLS);
        assertNotNull(nudge);
        assertTrue(nudge.contains("save_memory"), nudge);
        assertNull(AgentOrchestrator.claimedToolNudgeIfNeeded(g, answer, AgentMode.AGENT, TOOLS), "每轮只纠正一次");
    }

    @Test
    @DisplayName("本轮执行过工具 / 问答模式 / 只提到非工具的下划线词 → 不触发")
    void noFalseAlarms() {
        var ran = guard();
        ran.noteToolResult("doc_export_pdf", true);
        assertNull(AgentOrchestrator.claimedToolNudgeIfNeeded(ran, "I called doc_export_pdf.", AgentMode.AGENT, TOOLS));
        assertNull(AgentOrchestrator.claimedToolNudgeIfNeeded(guard(), "I called doc_export_pdf.", AgentMode.ASK, TOOLS));
        assertNull(AgentOrchestrator.claimedToolNudgeIfNeeded(guard(), "字段 due_date 与 user_id 都有值。", AgentMode.AGENT, TOOLS));
        assertNull(AgentOrchestrator.claimedToolNudgeIfNeeded(guard(), "合同第三条约定 7 日内验收。", AgentMode.AGENT, TOOLS));
        // 回放用例里的真实形态：标签属性、代码块、截断的 tool_code、已发过文字调用纠正
        assertNull(AgentOrchestrator.claimedToolNudgeIfNeeded(guard(),
                "<artifact type=\"save_memory\" name=\"x\">1. a</artifact><final>已生成。</final>", AgentMode.AGENT, TOOLS));
        assertNull(AgentOrchestrator.claimedToolNudgeIfNeeded(guard(),
                "写法如下：\n```\n<tool_code>write_docx(fileName=\"a.docx\")</tool_code>\n```", AgentMode.AGENT, TOOLS));
        assertNull(AgentOrchestrator.claimedToolNudgeIfNeeded(guard(),
                "<tool_code>write_docx(fileName=\"a.docx\", markdownContent=\"# 标", AgentMode.AGENT, TOOLS));
        var nudged = guard();
        nudged.protocolNudged = true;
        assertNull(AgentOrchestrator.claimedToolNudgeIfNeeded(nudged, "I called save_memory.", AgentMode.AGENT, TOOLS));
    }
}
