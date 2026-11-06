// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ai;

import com.checkba.service.LangText;
import dev.langchain4j.agent.tool.ToolExecutionRequest;
import dev.langchain4j.agent.tool.ToolSpecification;
import dev.langchain4j.data.message.AiMessage;
import dev.langchain4j.data.message.ChatMessage;
import dev.langchain4j.data.message.ToolExecutionResultMessage;
import dev.langchain4j.data.message.UserMessage;
import dev.langchain4j.model.StreamingResponseHandler;
import dev.langchain4j.model.chat.ChatLanguageModel;
import dev.langchain4j.model.chat.StreamingChatLanguageModel;
import dev.langchain4j.model.output.Response;

import java.util.List;

/**
 * 本地开发用的模拟模型（{@code ai.mock.enabled=true}，只允许在 dev profile 下打开，见 {@link MockAiGuard}）。
 *
 * <p>不访问网络、输出确定：
 * <ul>
 *   <li>本轮提供了 {@value #DEMO_TOOL} 且本轮还没调过工具 → 发起一次原生工具调用（只读，列出项目文件）；</li>
 *   <li>本轮已经调过工具 → 用工具结果的摘录收尾；</li>
 *   <li>没有工具（ASK 模式、辅助调用）→ 固定文字回复。</li>
 * </ul>
 * 「本轮」= 从消息列表末尾往前，直到遇到一条不带工具请求的 AI 回复为止。只要本轮出现过工具请求就收尾，
 * 所以不会循环调用工具。
 */
public final class MockChatModel implements ChatLanguageModel, StreamingChatLanguageModel {

    public static final String MODEL_ID = "awd-dev-mock";
    static final String DEMO_TOOL = "doc_list_project_files";
    private static final int EXCERPT_CHARS = 400;

    public static final MockChatModel INSTANCE = new MockChatModel();

    private MockChatModel() {
    }

    @Override
    public Response<AiMessage> generate(List<ChatMessage> messages) {
        return Response.from(reply(messages, List.of()));
    }

    @Override
    public Response<AiMessage> generate(List<ChatMessage> messages, List<ToolSpecification> toolSpecifications) {
        return Response.from(reply(messages, toolSpecifications));
    }

    @Override
    public void generate(List<ChatMessage> messages, StreamingResponseHandler<AiMessage> handler) {
        stream(reply(messages, List.of()), handler);
    }

    @Override
    public void generate(List<ChatMessage> messages, List<ToolSpecification> toolSpecifications,
                         StreamingResponseHandler<AiMessage> handler) {
        stream(reply(messages, toolSpecifications), handler);
    }

    private static void stream(AiMessage message, StreamingResponseHandler<AiMessage> handler) {
        if (!message.hasToolExecutionRequests()) {
            String text = message.text();
            // 分几段推送，前端能看到流式效果；切分位置固定，输出仍然确定
            int step = Math.max(1, text.length() / 4);
            for (int i = 0; i < text.length(); i += step) {
                handler.onNext(text.substring(i, Math.min(text.length(), i + step)));
            }
        }
        handler.onComplete(Response.from(message));
    }

    static AiMessage reply(List<ChatMessage> messages, List<ToolSpecification> tools) {
        List<ChatMessage> list = messages == null ? List.of() : messages;
        ToolExecutionResultMessage toolResult = null;
        boolean toolRequestedThisTurn = false;
        for (int i = list.size() - 1; i >= 0; i--) {
            ChatMessage m = list.get(i);
            if (m instanceof ToolExecutionResultMessage r && toolResult == null) {
                toolResult = r;
            } else if (m instanceof AiMessage ai) {
                if (!ai.hasToolExecutionRequests()) break;
                toolRequestedThisTurn = true;
            }
        }
        if (toolRequestedThisTurn) {
            String name = toolResult == null ? DEMO_TOOL : toolResult.toolName();
            String result = toolResult == null ? "" : excerpt(toolResult.text());
            return AiMessage.from("<final>" + LangText.of(
                    "【模拟 AI】已调用工具 " + name + "，结果摘录：\n" + result
                            + "\n\n这是开发环境的模拟回复，没有调用任何真实模型。",
                    "[Mock AI] Called tool " + name + ". Result excerpt:\n" + result
                            + "\n\nThis is a development mock reply; no real model was called.") + "</final>");
        }
        boolean demoToolOffered = tools != null
                && tools.stream().anyMatch(t -> DEMO_TOOL.equals(t.name()));
        if (demoToolOffered) {
            return AiMessage.from(ToolExecutionRequest.builder()
                    .id("mock-call-" + list.size())
                    .name(DEMO_TOOL)
                    .arguments("{}")
                    .build());
        }
        String question = excerpt(lastUserText(list));
        return AiMessage.from("<final>" + LangText.of(
                "【模拟 AI】收到：" + question + "\n\n这是开发环境的模拟回复，没有调用任何真实模型。"
                        + "配置真实模型后关闭 AI_MOCK_ENABLED 即可。",
                "[Mock AI] Received: " + question + "\n\nThis is a development mock reply; no real model was called. "
                        + "Configure a real model and turn off AI_MOCK_ENABLED to use it.") + "</final>");
    }

    private static String lastUserText(List<ChatMessage> messages) {
        for (int i = messages.size() - 1; i >= 0; i--) {
            if (messages.get(i) instanceof UserMessage u) {
                return u.hasSingleText() ? u.singleText() : "";
            }
        }
        return "";
    }

    private static String excerpt(String text) {
        if (text == null) return "";
        String t = text.strip();
        return t.length() <= EXCERPT_CHARS ? t : t.substring(0, EXCERPT_CHARS) + "…";
    }
}
