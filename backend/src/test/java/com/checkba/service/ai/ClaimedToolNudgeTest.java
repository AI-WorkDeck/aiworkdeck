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

    private static AgentOrchestrator.RunGuard docGuard(String userMessage) {
        var g = guard();
        g.activeDocKind = "slide";
        g.userMessage = userMessage;
        return g;
    }

    @Test
    @DisplayName("office-tier1：不点名工具的口头完成（「已为第1页添加演讲者备注」）在开着文档、用户要求修改时也纠正一次")
    void plainLanguageEditClaimIsNudged() {
        var g = docGuard("给第1页加演讲者备注：开场先介绍承办律师团队");
        String nudge = AgentOrchestrator.claimedToolNudgeIfNeeded(g, "<final>已为第1页添加演讲者备注。</final>", AgentMode.AGENT, TOOLS);
        assertNotNull(nudge);
        assertNull(AgentOrchestrator.claimedToolNudgeIfNeeded(g, "<final>已为第1页添加演讲者备注。</final>", AgentMode.AGENT, TOOLS), "每轮只纠正一次");
        var en = docGuard("Freeze the first row");
        assertNotNull(AgentOrchestrator.claimedToolNudgeIfNeeded(en, "I've frozen the header row.", AgentMode.AGENT, TOOLS));
    }

    @Test
    @DisplayName("口头完成的误报边界：没开文档 / 用户只是回顾提问 / 本轮执行过工具 / 问答模式 → 不触发")
    void plainLanguageEditClaimFalseAlarms() {
        var noDoc = guard();
        noDoc.userMessage = "加一条备注";
        assertNull(AgentOrchestrator.claimedToolNudgeIfNeeded(noDoc, "已添加备注。", AgentMode.AGENT, TOOLS));
        assertNull(AgentOrchestrator.claimedToolNudgeIfNeeded(docGuard("备注之前有没有？"), "是的，之前已添加过备注。", AgentMode.AGENT, TOOLS));
        var ran = docGuard("冻结首行");
        ran.noteToolResult("sheet_freeze_panes", true);
        assertNull(AgentOrchestrator.claimedToolNudgeIfNeeded(ran, "已冻结第 1 行。", AgentMode.AGENT, TOOLS));
        assertNull(AgentOrchestrator.claimedToolNudgeIfNeeded(docGuard("冻结首行"), "已冻结第 1 行。", AgentMode.ASK, TOOLS));
    }

    @Test
    @DisplayName("纠正一轮后仍零工具、仍宣称完成 → 回答末尾如实补一句没改成；纠正前或执行过工具则不补")
    void honestNoticeAfterRepeatedFalseClaim() {
        var g = docGuard("冻结首行");
        String claim = "<final>已冻结第 1 行（表头行）。</final>";
        assertNull(AgentOrchestrator.falseClaimNotice(g, claim, TOOLS), "还没纠正过");
        assertNotNull(AgentOrchestrator.claimedToolNudgeIfNeeded(g, claim, AgentMode.AGENT, TOOLS));
        String notice = AgentOrchestrator.falseClaimNotice(g, claim, TOOLS);
        assertNotNull(notice);
        assertTrue(notice.contains("没有执行") || notice.contains("no change"), notice);
        g.noteToolResult("sheet_freeze_panes", true);
        assertNull(AgentOrchestrator.falseClaimNotice(g, claim, TOOLS), "纠正后真的执行了");
    }
}
