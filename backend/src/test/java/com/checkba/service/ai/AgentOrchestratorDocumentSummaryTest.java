// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ai;

import com.checkba.config.AiContextProperties;
import com.checkba.config.AiFailoverProperties;
import com.checkba.controller.ai.AiAgentController;
import com.checkba.model.entity.ProjectAiMessage;
import com.checkba.service.ProjectAiMessageService;
import com.checkba.service.ProjectFileService;
import com.checkba.service.ai.context.ContextCompressor;
import com.checkba.service.ai.context.RunLoopCompactor;
import com.checkba.service.ai.memory.MemoryPipelineService;
import com.checkba.service.ai.skill.SkillRouter;
import dev.langchain4j.agent.tool.ToolExecutionRequest;
import dev.langchain4j.agent.tool.ToolSpecification;
import dev.langchain4j.data.message.AiMessage;
import dev.langchain4j.data.message.ChatMessage;
import dev.langchain4j.data.message.SystemMessage;
import dev.langchain4j.data.message.UserMessage;
import dev.langchain4j.model.StreamingResponseHandler;
import dev.langchain4j.model.chat.StreamingChatLanguageModel;
import dev.langchain4j.model.output.Response;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** Real orchestrator + scripted model: document delivery and a bounded chat-only summary. */
class AgentOrchestratorDocumentSummaryTest {

    private static final String MODEL = "qwen/qwen3.7-flash";

    private ChatModelFactory chatModelFactory;
    private SseEmitterService sse;
    private AgentRunStateService runState;
    private ProjectAiMessageService messageService;
    private ToolRegistry toolRegistry;
    private SkillRouter skillRouter;
    private EditorBridgeService editor;
    private final java.util.concurrent.atomic.AtomicBoolean streaming = new java.util.concurrent.atomic.AtomicBoolean();
    private final java.util.concurrent.atomic.AtomicBoolean wrote = new java.util.concurrent.atomic.AtomicBoolean();
    private List<String> sseEvents;
    private List<String> sseData;
    private AgentOrchestrator orchestrator;

    /** 按脚本逐轮吐内容的模型；记录每轮收到的消息栈（断言接回注入用） */
    private static final class ScriptModel implements StreamingChatLanguageModel {
        private final List<AiMessage> script;
        final AtomicInteger calls = new AtomicInteger();
        Runnable beforeFirstCompletion;
        java.util.function.IntConsumer beforeCompletion;
        final List<List<ToolSpecification>> seenTools = new ArrayList<>();
        dev.langchain4j.model.output.FinishReason finishReason = dev.langchain4j.model.output.FinishReason.STOP;
        Throwable lastError;
        final List<List<ChatMessage>> seenMessages = new CopyOnWriteArrayList<>();

        ScriptModel(List<AiMessage> script) {
            this.script = script;
        }

        @Override
        public void generate(List<ChatMessage> messages, StreamingResponseHandler<AiMessage> handler) {
            int idx = calls.getAndIncrement();
            seenMessages.add(new ArrayList<>(messages));
            if (idx >= script.size()) throw new AssertionError("Unbounded model continuation: " + idx);
            AiMessage msg = script.get(idx);
            if (msg.text() != null && !msg.text().isEmpty()) {
                handler.onNext(msg.text());
            }
            if (idx == 0 && beforeFirstCompletion != null) beforeFirstCompletion.run();
            if (beforeCompletion != null) beforeCompletion.accept(idx);
            if (idx == script.size() - 1 && lastError != null) handler.onError(lastError);
            else handler.onComplete(Response.from(msg, null, idx == script.size() - 1 ? finishReason : dev.langchain4j.model.output.FinishReason.STOP));
        }

        @Override
        public void generate(List<ChatMessage> messages, List<ToolSpecification> tools,
                             StreamingResponseHandler<AiMessage> handler) {
            seenTools.add(List.copyOf(tools));
            generate(messages, handler);
        }
    }

    @BeforeEach
    void setUp() {
        chatModelFactory = mock(ChatModelFactory.class);
        sseEvents = new CopyOnWriteArrayList<>();
        sseData = new CopyOnWriteArrayList<>();
        sse = mock(SseEmitterService.class);
        doAnswer(inv -> {
            sseEvents.add(inv.getArgument(1));
            sseData.add(String.valueOf((Object) inv.getArgument(2)));
            return null;
        }).when(sse).send(any(), any(), any());

        messageService = mock(ProjectAiMessageService.class);
        when(messageService.countByConversationId(any())).thenAnswer(inv -> (long) messageService.listByConversationId(inv.getArgument(0)).size());
        when(messageService.listByConversationId(any()))
                .thenReturn(List.of(mock(ProjectAiMessage.class), mock(ProjectAiMessage.class)));
        when(messageService.upsertAssistantMessage(any(), any(), any(), any(), any())).thenReturn(1L);

        ContextAssemblerService assembler = mock(ContextAssemblerService.class);
        when(assembler.assemble(any(), any(), any(), any(), any(), any(), any(), any(), any(), any(), any()))
                .thenAnswer(inv -> new ArrayList<ChatMessage>(List.of(
                        SystemMessage.from("system"), UserMessage.from("请修改示例信并说明调整"))));

        toolRegistry = mock(ToolRegistry.class);
        when(toolRegistry.getAllSpecifications(any(), any())).thenReturn(List.of(
                ToolSpecification.builder().name("doc_start_stream").description("stream body").build()));
        when(toolRegistry.resolve(anyString())).thenReturn(java.util.Optional.empty());
        when(toolRegistry.execute(any(), any(), any()))
                .thenReturn(new ToolRegistry.ToolResult("ok", null, true));

        skillRouter = mock(SkillRouter.class);
        when(skillRouter.visibleTools(any(), any())).thenAnswer(inv -> inv.getArgument(1));
        when(skillRouter.activeSkill(any())).thenReturn(java.util.Optional.empty());
        XmlToolCallParser parser = new XmlToolCallParser(toolRegistry);

        editor = mock(EditorBridgeService.class);
        when(editor.isStreamingMode(any())).thenAnswer(inv -> streaming.get());
        when(editor.hasStreamedContent(any())).thenAnswer(inv -> wrote.get());
        doAnswer(inv -> { streaming.set(inv.getArgument(1)); return null; })
                .when(editor).setStreamingMode(any(), org.mockito.ArgumentMatchers.anyBoolean());
        doAnswer(inv -> { if (!inv.getArgument(1, String.class).isBlank()) wrote.set(true); return null; })
                .when(editor).noteStreamContent(any(), any());
        when(toolRegistry.execute(eq("doc_start_stream"), any(), any())).thenAnswer(inv -> {
            streaming.set(true); wrote.set(false);
            return new ToolRegistry.ToolResult("stream started", null, true);
        });
        AiContextProperties contextProperties = new AiContextProperties();
        runState = new AgentRunStateService(
                mock(com.checkba.repository.AgentRunRecordRepository.class),
                mock(com.checkba.service.telemetry.TelemetryTurnTracker.class));
        orchestrator = new AgentOrchestrator(
                chatModelFactory, messageService, sse, mock(TokenUsageService.class), assembler,
                toolRegistry, skillRouter, parser, mock(MemoryPipelineService.class),
                mock(ProjectFileService.class), editor,
                mock(ConversationFileChangeService.class), mock(TodoListService.class),
                mock(DocumentCheckpointService.class), runState,
                mock(com.checkba.version.WorkSessionService.class), new AiFailoverProperties(),
                new RunLoopCompactor(contextProperties, new ContextCompressor(null, null, contextProperties)),
                mock(com.checkba.service.telemetry.TelemetryService.class),
                mock(com.checkba.service.telemetry.TelemetryTurnTracker.class),
                mock(com.checkba.service.telemetry.MatterClassifierService.class),
                new com.checkba.service.ai.OfficePassStateStore());
    }

    private static AiMessage startStream() {
        return AiMessage.from(List.of(ToolExecutionRequest.builder().id("stream")
                .name("doc_start_stream").arguments("{}").build()));
    }

    private ScriptModel run(AiMessage... script) {
        ScriptModel model = new ScriptModel(List.of(script));
        run(model);
        return model;
    }

    private void run(ScriptModel model) {
        when(chatModelFactory.getStreamingChatModel(MODEL)).thenReturn(model);
        AiAgentController.AgentChatRequest request = new AiAgentController.AgentChatRequest();
        request.setProjectId(1L); request.setConversationId("doc-summary");
        request.setMessage("请改写信件，并书面说明调整内容"); request.setModel(MODEL);
        orchestrator.handleUserMessage(request, 7L);
    }

    private String eventText(String type) {
        StringBuilder result = new StringBuilder();
        for (int i = 0; i < sseEvents.size(); i++)
            if (type.equals(sseEvents.get(i))) result.append(sseData.get(i));
        return result.toString();
    }

    private String persisted() {
        ArgumentCaptor<String> captor = ArgumentCaptor.forClass(String.class);
        verify(messageService, org.mockito.Mockito.atLeastOnce())
                .upsertAssistantMessage(any(), any(), any(), any(), captor.capture());
        return captor.getAllValues().get(captor.getAllValues().size() - 1);
    }

    @Test
    void missingSummaryGetsOneToolFreeRoundAndBothPartsPersist() {
        ScriptModel model = run(startStream(), AiMessage.from("信件正文。"), AiMessage.from("<final>调整了开头和结尾。</final>"));
        assertEquals(3, model.calls.get());
        assertFalse(model.seenTools.get(0).isEmpty(), "tool-free assertion needs a non-empty normal tool catalog");
        assertTrue(model.seenTools.get(2).isEmpty());
        assertTrue(eventText("text_delta").contains("调整了开头和结尾"));
        assertTrue(eventText("doc_stream_data").contains("信件正文"));
        assertFalse(eventText("doc_stream_data").contains("调整了"));
        assertTrue(persisted().contains("信件正文"));
        assertTrue(persisted().contains("<final>调整了开头和结尾。</final>"));
        assertEquals(1, sseEvents.stream().filter("doc_stream_end"::equals).count());
        verify(toolRegistry, times(1)).execute(any(), any(), any());
    }

    @Test
    void existingFinalStaysOutOfDocumentAndNeedsNoExtraCall() {
        ScriptModel model = run(startStream(), AiMessage.from("信件正文。<final>调整了开头。</final>"));
        assertEquals(2, model.calls.get());
        assertFalse(eventText("doc_stream_data").contains("调整了"));
        assertTrue(eventText("text_delta").contains("调整了"));
    }

    @Test
    void plainTextSummaryIsWrappedForChat() {
        ScriptModel model = run(startStream(), AiMessage.from("信件正文。"), AiMessage.from("调整了开头和结尾。"));
        assertEquals(3, model.calls.get());
        assertTrue(persisted().contains("<final>调整了开头和结尾。</final>"));
    }

    @Test
    void noBodyNeverAsksForSummary() {
        run(startStream(), AiMessage.from("<thinking>隐藏正文</thinking>"));
        assertFalse(eventText("doc_stream_data").contains("隐藏正文"));
    }
    @Test
    void summaryNativeToolIsNotExecutedOrPersistedAsACall() {
        ScriptModel model = run(startStream(), AiMessage.from("信件正文。"), startStream());
        assertEquals(3, model.calls.get());
        verify(toolRegistry, times(1)).execute(any(), any(), any());
        assertTrue(persisted().contains("未能生成完整的修改说明"));
    }

    @Test
    void summaryXmlToolAndArtifactNeverExecute() {
        run(startStream(), AiMessage.from("信件正文。"), AiMessage.from(
                "<tool_code>doc_start_stream()</tool_code><artifact type=\"implementation_plan\">重写</artifact>"));
        verify(toolRegistry, times(1)).execute(any(), any(), any());
        assertTrue(persisted().contains("未能生成完整的修改说明"));
        assertFalse(eventText("text_delta").contains("重写"));
        assertFalse(eventText("bubble_end").contains("awaiting_approval"));
    }

    @Test
    void summaryFailureDoesNotRetryOrRepeatDocument() {
        ScriptModel model = new ScriptModel(List.of(startStream(), AiMessage.from("信件正文。"), AiMessage.from("半句")));
        model.lastError = new java.io.IOException("connection reset");
        run(model);
        assertEquals(3, model.calls.get());
        assertTrue(eventText("error").contains("修改说明生成失败"));
        assertEquals(1, persisted().split("信件正文", -1).length - 1, "error history must retain the document body once");
        assertFalse(eventText("text_delta").contains("半句"));
        verify(toolRegistry, times(1)).execute(any(), any(), any());
    }

    @Test
    void truncatedBodyPausesWithoutRequestingSummary() {
        ScriptModel model = new ScriptModel(List.of(startStream(), AiMessage.from("信件正文未完")));
        model.finishReason = dev.langchain4j.model.output.FinishReason.LENGTH;
        run(model);
        assertEquals(2, model.calls.get());
        assertTrue(eventText("bubble_end").contains("paused"));
    }

    @Test
    void truncatedSummaryEndsWithHonestNoticeWithoutAnotherRound() {
        ScriptModel model = new ScriptModel(List.of(startStream(), AiMessage.from("信件正文。"), AiMessage.from("修改了")));
        model.finishReason = dev.langchain4j.model.output.FinishReason.LENGTH;
        run(model);
        assertEquals(3, model.calls.get());
        assertTrue(persisted().contains("未能生成完整的修改说明"));
        assertFalse(eventText("bubble_end").contains("paused"));
    }

    @Test
    void questionWaitsForUserInsteadOfRequestingSummary() {
        ScriptModel model = run(startStream(), AiMessage.from("信件正文。<question>请确认署名</question>"));
        assertEquals(2, model.calls.get());
        assertTrue(eventText("bubble_end").contains("awaiting_input"));
    }

    @Test
    void approvalWaitsForUserInsteadOfRequestingSummary() {
        ScriptModel model = run(startStream(), AiMessage.from("信件正文。<artifact type=\"implementation_plan\">后续修改计划</artifact>"));
        assertEquals(2, model.calls.get());
        assertTrue(eventText("bubble_end").contains("awaiting_approval"));
    }

    @Test
    void cancellationAfterBodyNeverRequestsSummary() {
        ScriptModel model = new ScriptModel(List.of(startStream(), AiMessage.from("信件正文。")));
        model.beforeCompletion = index -> { if (index == 1) orchestrator.setCancelled("doc-summary"); };
        run(model);
        assertEquals(2, model.calls.get());
        assertTrue(sseEvents.contains("cancelled"));
    }

    @Test
    void summaryOnlyFlagSurvivesRestartSnapshot() {
        AgentOrchestrator.RunGuard original = new AgentOrchestrator.RunGuard("c", "r", 1);
        original.documentSummaryOnly = true;
        var snapshot = ReflectionTestUtils.invokeMethod(orchestrator, "snapshotRestartGuard", original);
        AgentOrchestrator.RunGuard restored = new AgentOrchestrator.RunGuard("c", "r", 1);
        ReflectionTestUtils.invokeMethod(orchestrator, "restoreRestartGuard", restored, snapshot);
        assertTrue(restored.documentSummaryOnly);
    }

    @Test
    void summaryAccountFailureKeepsBodyAndAccountAction() {
        ScriptModel model = new ScriptModel(List.of(startStream(), AiMessage.from("信件正文。"), AiMessage.from("半句")));
        model.lastError = new com.checkba.service.account.AccountException(
                com.checkba.service.account.AccountException.Kind.CONFLICT, "Credits 不足", "no_credits");
        run(model);
        assertEquals(3, model.calls.get());
        assertTrue(eventText("error").contains("no_credits"));
        assertTrue(persisted().contains("信件正文"));
        assertTrue(persisted().contains("Credits 不足"));
    }

}
