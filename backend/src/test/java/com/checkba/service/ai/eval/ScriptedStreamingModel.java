// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ai.eval;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import dev.langchain4j.agent.tool.ToolExecutionRequest;
import dev.langchain4j.agent.tool.ToolSpecification;
import dev.langchain4j.data.message.AiMessage;
import dev.langchain4j.data.message.ChatMessage;
import dev.langchain4j.model.StreamingResponseHandler;
import dev.langchain4j.model.chat.StreamingChatLanguageModel;
import dev.langchain4j.model.output.Response;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;
import java.util.UUID;

/**
 * 回放式流式模型：不访问任何真实 LLM，按用例中预录的 turns 逐轮回放。
 *
 * - text 轮：以单个 token 回放整段文本（XML 协议路径）；
 * - toolCalls 轮：回放原生 function calling 请求（native 协议路径）。
 *
 * 若编排器请求的轮数超过脚本长度，抛异常（说明编排器行为发生了变化）。
 */
public class ScriptedStreamingModel implements StreamingChatLanguageModel {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final Deque<EvalCase.Turn> remaining;
    private final List<Boolean> toolsOfferedPerCall = new ArrayList<>();
    private final List<List<String>> toolNamesOfferedPerCall = new ArrayList<>();
    private final List<String> promptTextPerCall = new ArrayList<>();
    private final List<Integer> offeredToolCountPerCall = new ArrayList<>();
    private final List<Integer> offeredSchemaTokensPerCall = new ArrayList<>();

    public ScriptedStreamingModel(List<EvalCase.Turn> turns) {
        this.remaining = new ArrayDeque<>(turns);
    }

    /** 每次 LLM 调用是否携带了工具规格（ASK 模式应全为 false） */
    public List<Boolean> toolsOfferedPerCall() {
        return List.copyOf(toolsOfferedPerCall);
    }

    /** 每次 LLM 调用携带的工具名列表（无工具调用记为空列表；供 Skill 可见性裁剪断言） */
    public List<List<String>> toolNamesOfferedPerCall() {
        return List.copyOf(toolNamesOfferedPerCall);
    }

    /** 每次 LLM 调用收到的完整上下文文本（供「回喂了某条提醒」类断言） */
    public List<String> promptTextPerCall() {
        return List.copyOf(promptTextPerCall);
    }

    /** 每次 LLM 调用下发的工具个数（未携带工具记 0；S0 测量基建，tool-surface-audit） */
    public List<Integer> offeredToolCountPerCall() {
        return List.copyOf(offeredToolCountPerCall);
    }

    /** 每次 LLM 调用下发的工具 schema token（o200k，口径见 {@link ToolSurfaceMetrics}；未携带工具记 0） */
    public List<Integer> offeredSchemaTokensPerCall() {
        return List.copyOf(offeredSchemaTokensPerCall);
    }

    /** 剩余未消费的脚本轮数（用例结束后应为 0） */
    public int remainingTurns() {
        return remaining.size();
    }

    @Override
    public void generate(List<ChatMessage> messages, StreamingResponseHandler<AiMessage> handler) {
        offeredToolCountPerCall.add(0);
        offeredSchemaTokensPerCall.add(0);
        serve(messages, false, List.of(), handler);
    }

    @Override
    public void generate(List<ChatMessage> messages, List<ToolSpecification> toolSpecifications,
                         StreamingResponseHandler<AiMessage> handler) {
        List<ToolSpecification> specs = toolSpecifications == null ? List.of() : toolSpecifications;
        offeredToolCountPerCall.add(specs.size());
        offeredSchemaTokensPerCall.add(ToolSurfaceMetrics.schemaTokens(specs));
        serve(messages, true, specs.stream().map(ToolSpecification::name).toList(), handler);
    }

    private void serve(List<ChatMessage> messages, boolean toolsOffered, List<String> toolNames,
                       StreamingResponseHandler<AiMessage> handler) {
        toolsOfferedPerCall.add(toolsOffered);
        toolNamesOfferedPerCall.add(List.copyOf(toolNames));
        promptTextPerCall.add(messages == null ? ""
                : messages.stream().map(String::valueOf).collect(java.util.stream.Collectors.joining("\n")));
        EvalCase.Turn turn = remaining.poll();
        if (turn == null) {
            throw new IllegalStateException(
                    "回放脚本已耗尽：编排器请求了比用例预录更多的 LLM 轮次（第 "
                            + (toolsOfferedPerCall.size()) + " 轮）");
        }
        if (turn.toolCalls != null && !turn.toolCalls.isEmpty()) {
            List<ToolExecutionRequest> requests = new ArrayList<>();
            for (EvalCase.NativeCall call : turn.toolCalls) {
                requests.add(ToolExecutionRequest.builder()
                        .id(UUID.randomUUID().toString())
                        .name(call.name)
                        .arguments(toJson(call.arguments))
                        .build());
            }
            handler.onComplete(Response.from(AiMessage.from(requests)));
        } else {
            String text = (turn.text == null || turn.text.isEmpty()) ? " " : turn.text;
            handler.onNext(text);
            handler.onComplete(Response.from(AiMessage.from(text)));
        }
    }

    private static String toJson(Object value) {
        try {
            return MAPPER.writeValueAsString(value == null ? java.util.Map.of() : value);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("无法序列化 native toolCall 参数", e);
        }
    }
}
