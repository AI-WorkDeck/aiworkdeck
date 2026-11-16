// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ai;

import dev.langchain4j.agent.tool.ToolExecutionRequest;
import dev.langchain4j.data.message.AiMessage;
import dev.langchain4j.model.output.FinishReason;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * finishReason 结构化消费的两个判定（2026-08 对标 DeepSeek Harness）。
 *
 * <p>背景：此前全链路不读 finishReason——LENGTH 截断的原生工具调用会被照常执行
 * （参数恰好仍可解析时最危险：半篇正文的 write_file 直接覆盖用户文件）；
 * 「正常终止 + 零内容」的空响应会静默 FINISHED，用户面前一片空白且无任何重试入口。
 */
class AgentOrchestratorFinishReasonTest {

    private static AiMessage withToolCall() {
        return AiMessage.from(List.of(ToolExecutionRequest.builder()
                .id("c1").name("write_file").arguments("{\"path\":\"a.md\",\"content\":\"半截")
                .build()));
    }

    @Test
    @DisplayName("空响应判定：无工具、正文空白、零 token 流出，三个条件缺一不可")
    void emptyResponseNeedsAllThreeConditions() {
        assertTrue(AgentOrchestrator.isEmptyResponse(AiMessage.from(" "), false));
        assertTrue(AgentOrchestrator.isEmptyResponse(null, false), "内容缺失同样按空响应重试");

        assertFalse(AgentOrchestrator.isEmptyResponse(AiMessage.from("正文"), false), "有正文不算空");
        assertFalse(AgentOrchestrator.isEmptyResponse(withToolCall(), false), "有工具调用不算空");
        assertFalse(AgentOrchestrator.isEmptyResponse(AiMessage.from(" "), true),
                "只要有 token 给用户看过就绝不能悄悄重放——会看到重复内容");
    }

    private static AiMessage calls(String... names) {
        List<ToolExecutionRequest> reqs = new java.util.ArrayList<>();
        for (int i = 0; i < names.length; i++) {
            reqs.add(ToolExecutionRequest.builder().id("c" + i).name(names[i]).arguments("{\"arguments\": \"\"}").build());
        }
        return AiMessage.from(reqs);
    }

    @Test
    @DisplayName("伪工具 final（O11 DeepSeek V4 Pro）：本轮只有 final 才当收尾；夹带真工具照常执行")
    void pseudoFinalOnlyWhenEveryCallIsFinal() {
        assertTrue(AgentOrchestrator.isPseudoFinalCall(calls("final")));
        assertTrue(AgentOrchestrator.isPseudoFinalCall(calls("Final", " final ")));

        assertFalse(AgentOrchestrator.isPseudoFinalCall(calls("final", "slide_set_text")), "混了真工具不能吞掉真调用");
        assertFalse(AgentOrchestrator.isPseudoFinalCall(calls("finalize_report")));
        assertFalse(AgentOrchestrator.isPseudoFinalCall(AiMessage.from("纯文本")));
        assertFalse(AgentOrchestrator.isPseudoFinalCall(null));
    }

    @Test
    @DisplayName("LENGTH 截断轮判定：只有 LENGTH + 带工具调用才拦，其余一概放行（含 finishReason 为 null 的通道）")
    void truncatedToolCallRoundRequiresLengthAndToolCalls() {
        assertTrue(AgentOrchestrator.isTruncatedToolCallRound(FinishReason.LENGTH, withToolCall()));

        assertFalse(AgentOrchestrator.isTruncatedToolCallRound(FinishReason.LENGTH, AiMessage.from("纯文本被截断")),
                "纯文本截断走「暂停 + 继续」收尾，不走工具纠正回路");
        assertFalse(AgentOrchestrator.isTruncatedToolCallRound(FinishReason.STOP, withToolCall()),
                "正常终止的工具调用照常执行");
        assertFalse(AgentOrchestrator.isTruncatedToolCallRound(FinishReason.TOOL_EXECUTION, withToolCall()));
        assertFalse(AgentOrchestrator.isTruncatedToolCallRound(null, withToolCall()),
                "部分通道不回 finishReason（含回放评测），行为必须与改造前一致");
        assertFalse(AgentOrchestrator.isTruncatedToolCallRound(FinishReason.LENGTH, null));
    }

    @Test
    @DisplayName("截断纠正提醒：被截断的是 write_docx 时给出分段 + append=true 的精确恢复办法（tasks-10 t03），其余工具不加")
    void truncationCorrectionNamesTheWriteDocxRecovery() {
        String nativeDocx = AgentOrchestrator.truncationCorrection(true, "write_docx ");
        assertTrue(nativeDocx.contains("单次输出长度上限"), nativeDocx);
        assertTrue(nativeDocx.contains("append=true"), nativeDocx);

        String xmlDocx = AgentOrchestrator.truncationCorrection(false,
                "<tool_code>write_docx(fileName=\"差异说明.docx\", markdownContent=\"# 差异说明 一、");
        assertTrue(xmlDocx.contains("标签未闭合"), xmlDocx);
        assertTrue(xmlDocx.contains("append=true"), xmlDocx);

        assertFalse(AgentOrchestrator.truncationCorrection(true, "write_file ").contains("append=true"));
        assertFalse(AgentOrchestrator.truncationCorrection(false, "<todo_write").contains("append=true"));
        assertFalse(AgentOrchestrator.truncationCorrection(false, null).contains("append=true"));
    }
}
