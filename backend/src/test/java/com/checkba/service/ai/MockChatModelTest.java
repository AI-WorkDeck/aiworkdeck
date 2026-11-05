// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ai;

import dev.langchain4j.agent.tool.ToolExecutionRequest;
import dev.langchain4j.agent.tool.ToolSpecification;
import dev.langchain4j.data.message.AiMessage;
import dev.langchain4j.data.message.ChatMessage;
import dev.langchain4j.data.message.SystemMessage;
import dev.langchain4j.data.message.ToolExecutionResultMessage;
import dev.langchain4j.data.message.UserMessage;
import dev.langchain4j.model.StreamingResponseHandler;
import dev.langchain4j.model.output.Response;
import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class MockChatModelTest {

    private static final List<ToolSpecification> TOOLS = List.of(
            ToolSpecification.builder().name("write_docx").build(),
            ToolSpecification.builder().name(MockChatModel.DEMO_TOOL).build());

    @Test
    void agentTurnCallsListFilesOnceThenFinishesWithTheResult() {
        List<ChatMessage> messages = new ArrayList<>(List.of(SystemMessage.from("sys"), UserMessage.from("看看材料")));
        AiMessage first = MockChatModel.reply(messages, TOOLS);
        assertTrue(first.hasToolExecutionRequests());
        ToolExecutionRequest call = first.toolExecutionRequests().get(0);
        assertEquals(MockChatModel.DEMO_TOOL, call.name());
        assertEquals("{}", call.arguments());

        messages.add(first);
        messages.add(ToolExecutionResultMessage.from(call, "01-购销合同.docx\n02-补充协议.docx"));
        AiMessage second = MockChatModel.reply(messages, TOOLS);
        assertFalse(second.hasToolExecutionRequests());
        assertTrue(second.text().startsWith("<final>") && second.text().endsWith("</final>"));
        assertTrue(second.text().contains("01-购销合同.docx"));

        // 编排器若在工具结果后追加提醒消息，也不能再次调工具（防循环）
        messages.add(UserMessage.from("继续"));
        assertFalse(MockChatModel.reply(messages, TOOLS).hasToolExecutionRequests());
    }

    @Test
    void nextTurnAfterAFinalAnswerMayCallTheToolAgain() {
        List<ChatMessage> messages = List.of(UserMessage.from("一"),
                AiMessage.from(ToolExecutionRequest.builder().id("x").name(MockChatModel.DEMO_TOOL).arguments("{}").build()),
                AiMessage.from("<final>done</final>"), UserMessage.from("二"));
        assertTrue(MockChatModel.reply(messages, TOOLS).hasToolExecutionRequests());
    }

    @Test
    void withoutToolsRepliesDeterministicallyAndStreamsTheSameText() {
        List<ChatMessage> messages = List.of(UserMessage.from("你好"));
        Response<AiMessage> sync = MockChatModel.INSTANCE.generate(messages);
        assertEquals(sync.content().text(), MockChatModel.INSTANCE.generate(messages).content().text());
        assertTrue(sync.content().text().contains("你好"));

        StringBuilder streamed = new StringBuilder();
        List<Response<AiMessage>> done = new ArrayList<>();
        MockChatModel.INSTANCE.generate(messages, new StreamingResponseHandler<>() {
            @Override public void onNext(String token) { streamed.append(token); }
            @Override public void onComplete(Response<AiMessage> response) { done.add(response); }
            @Override public void onError(Throwable error) { fail(error); }
        });
        assertEquals(sync.content().text(), streamed.toString());
        assertEquals(1, done.size());
    }

    @Test
    void guardAllowsMockOnlyWithDevProfileAndNoReleaseProfile() {
        assertDoesNotThrow(() -> MockAiGuard.check(env(true, "dev")));
        assertDoesNotThrow(() -> MockAiGuard.check(env(false, "prod")));
        assertThrows(IllegalStateException.class, () -> MockAiGuard.check(env(true)));
        for (String release : MockAiGuard.RELEASE_PROFILES) {
            assertThrows(IllegalStateException.class, () -> MockAiGuard.check(env(true, release)), release);
            assertThrows(IllegalStateException.class, () -> MockAiGuard.check(env(true, "dev", release)), release);
        }
        MockEnvironment yamlMock = env(false, "dev").withProperty("ai.model.provider", "mock");
        assertThrows(IllegalStateException.class, () -> MockAiGuard.check(yamlMock));
    }

    private static MockEnvironment env(boolean mock, String... profiles) {
        MockEnvironment env = new MockEnvironment().withProperty("ai.mock.enabled", String.valueOf(mock));
        env.setActiveProfiles(profiles);
        return env;
    }
}
