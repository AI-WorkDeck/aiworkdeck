// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
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
import dev.langchain4j.data.message.ToolExecutionResultMessage;
import dev.langchain4j.data.message.UserMessage;
import dev.langchain4j.model.StreamingResponseHandler;
import dev.langchain4j.model.chat.StreamingChatLanguageModel;
import dev.langchain4j.model.output.Response;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Productive Agent work has no arbitrary 30/120-turn stop.
 * This runs the real loop through more than 100 changing tool rounds before a final answer.
 */
class AgentOrchestratorPassDepthTest {

    private static final String MODEL = "qwen/qwen3.7-flash";

    private ChatModelFactory chatModelFactory;
    private ProjectAiMessageService messageService;
    private ToolRegistry toolRegistry;
    private OfficePassStateStore passStateStore;
    private List<String> sseEvents;
    private List<String> sseData;
    private AgentOrchestrator orchestrator;

    /** 121 productive tool rounds, then a final answer. */
    private static final class LoopingModel implements StreamingChatLanguageModel {
        final AtomicInteger calls = new AtomicInteger();
        final java.util.concurrent.CountDownLatch finished = new java.util.concurrent.CountDownLatch(1);

        @Override
        public void generate(List<ChatMessage> messages, StreamingResponseHandler<AiMessage> handler) {
            int n = calls.incrementAndGet();
            if (n <= 1001) {
                handler.onComplete(Response.from(AiMessage.from(List.of(ToolExecutionRequest.builder()
                        .id("t" + n).name("office_pass_step")
                        .arguments("{\"editsJson\":\"[]\",\"round\":" + n + "}").build()))));
            } else {
                handler.onNext("完成");
                handler.onComplete(Response.from(AiMessage.from("完成")));
                finished.countDown();
            }
        }

        @Override
        public void generate(List<ChatMessage> messages, List<ToolSpecification> tools,
                             StreamingResponseHandler<AiMessage> handler) {
            generate(messages, handler);
        }
    }

    @BeforeEach
    void setUp() {
        chatModelFactory = mock(ChatModelFactory.class);
        sseEvents = new CopyOnWriteArrayList<>();
        sseData = new CopyOnWriteArrayList<>();
        SseEmitterService sse = mock(SseEmitterService.class);
        doAnswer(inv -> {
            sseEvents.add(inv.getArgument(1));
            sseData.add(String.valueOf((Object) inv.getArgument(2)));
            return null;
        }).when(sse).send(any(), any(), any());

        messageService = mock(ProjectAiMessageService.class);
        // dev-board#729 ⑤：编排器改用 countByConversationId 判首轮；mock 默认回 0 会误判首轮、起异步标题线程
        // 与下一次 when(...) 打架（CI 上 Mockito WrongTypeOfReturnValue）。计数跟随 list 桩，保持各用例原语义。
        when(messageService.countByConversationId(any())).thenAnswer(inv -> (long) messageService.listByConversationId(inv.getArgument(0)).size());
        when(messageService.listByConversationId(any()))
                .thenReturn(List.of(mock(ProjectAiMessage.class), mock(ProjectAiMessage.class)));
        when(messageService.upsertAssistantMessage(any(), any(), any(), any(), any())).thenReturn(1L);

        ContextAssemblerService assembler = mock(ContextAssemblerService.class);
        when(assembler.assemble(any(), any(), any(), any(), any(), any(), any(), any(), any(), any(), any()))
                .thenAnswer(inv -> new ArrayList<ChatMessage>(List.of(
                        SystemMessage.from("system"), UserMessage.from("请校对全文"))));

        toolRegistry = mock(ToolRegistry.class);
        when(toolRegistry.getAllSpecifications(any(), any())).thenReturn(List.of());
        when(toolRegistry.resolve(anyString())).thenReturn(java.util.Optional.empty());
        when(toolRegistry.execute(any(), any(), any()))
                .thenAnswer(inv -> new ToolRegistry.ToolResult("{\"pass\":{\"done\":false}}", null, true));

        SkillRouter skillRouter = mock(SkillRouter.class);
        when(skillRouter.visibleTools(any(), any())).thenAnswer(inv -> inv.getArgument(1));
        when(skillRouter.activeSkill(any())).thenReturn(java.util.Optional.empty());
        XmlToolCallParser parser = mock(XmlToolCallParser.class);
        when(parser.containsToolCall(any())).thenReturn(false);

        AiContextProperties contextProperties = new AiContextProperties();
        AgentRunStateService runState = new AgentRunStateService(
                mock(com.checkba.repository.AgentRunRecordRepository.class),
                mock(com.checkba.service.telemetry.TelemetryTurnTracker.class));
        passStateStore = new OfficePassStateStore();
        orchestrator = new AgentOrchestrator(
                chatModelFactory, messageService, sse, mock(TokenUsageService.class), assembler,
                toolRegistry, skillRouter, parser, mock(MemoryPipelineService.class),
                mock(ProjectFileService.class), mock(EditorBridgeService.class),
                mock(ConversationFileChangeService.class), mock(TodoListService.class),
                mock(DocumentCheckpointService.class), runState,
                mock(com.checkba.version.WorkSessionService.class), new AiFailoverProperties(),
                new RunLoopCompactor(contextProperties, new ContextCompressor(null, null, contextProperties)),
                mock(com.checkba.service.telemetry.TelemetryService.class),
                mock(com.checkba.service.telemetry.TelemetryTurnTracker.class),
                mock(com.checkba.service.telemetry.MatterClassifierService.class),
                passStateStore);
    }

    private LoopingModel run(String conversationId) {
        LoopingModel model = new LoopingModel();
        when(chatModelFactory.getStreamingChatModel(MODEL)).thenReturn(model);
        AiAgentController.AgentChatRequest request = new AiAgentController.AgentChatRequest();
        request.setProjectId(1L);
        request.setConversationId(conversationId);
        request.setMessage("请校对全文");
        request.setModel(MODEL);
        orchestrator.handleUserMessage(request, 7L);
        return model;
    }

    private String bubbleEndData() {
        for (int i = 0; i < sseEvents.size(); i++) {
            if ("bubble_end".equals(sseEvents.get(i))) return sseData.get(i);
        }
        return null;
    }

    @Test
    @DisplayName("普通任务可连续完成 1001 个有进展的工具轮次且不耗尽 Java 栈")
    void productiveRunExceedsOneThousandRounds() throws Exception {
        LoopingModel model = run("conv-nopass");

        assertTrue(model.finished.await(20, java.util.concurrent.TimeUnit.SECONDS));
        assertEquals(1002, model.calls.get());
        assertTrue(String.valueOf(bubbleEndData()).contains("finished"));
    }

    @Test
    void recoveryAndDurableToolBuffersAreBoundedAndMarkTheDroppedPrefix() {
        AgentOrchestrator.RunGuard guard = new AgentOrchestrator.RunGuard("conv-buffer", "run-buffer", 1L);
        guard.appendStream("old".repeat(AgentOrchestrator.STREAM_RECOVERY_LIMIT));
        guard.appendStream("LATEST_STREAM");
        assertTrue(guard.streamSnapshot().contains(AgentOrchestrator.STREAM_TRUNCATED_MARKER));
        assertTrue(guard.streamSnapshot().endsWith("LATEST_STREAM"));
        assertTrue(guard.streamSnapshot().length() <= AgentOrchestrator.STREAM_RECOVERY_LIMIT);

        StringBuilder executionLog = new StringBuilder();
        for (int i = 0; i < 200; i++) {
            AgentOrchestrator.appendBoundedExecutionLog(executionLog,
                    "<process name=\"test\"><tool_output>" + i + ":" + "x".repeat(4000)
                            + "</tool_output></process>\n");
        }
        assertTrue(executionLog.toString().contains(AgentOrchestrator.EXECUTION_LOG_TRUNCATED_MARKER));
        assertTrue(executionLog.toString().contains("199:"));
        assertTrue(executionLog.length() <= AgentOrchestrator.EXECUTION_LOG_LIMIT);
    }

    @Test
    void persistenceTruncationDoesNotTruncateTheToolResultGivenBackToTheModel() {
        String full = "x".repeat(20_000) + "FULL_TAIL";
        when(toolRegistry.execute(any(), any(), any()))
                .thenReturn(new ToolRegistry.ToolResult(full, null, true));
        java.util.concurrent.atomic.AtomicBoolean modelSawTail = new java.util.concurrent.atomic.AtomicBoolean();
        AtomicInteger calls = new AtomicInteger();
        StreamingChatLanguageModel model = new StreamingChatLanguageModel() {
            @Override public void generate(List<ChatMessage> messages, StreamingResponseHandler<AiMessage> handler) {
                if (calls.incrementAndGet() == 1) {
                    handler.onComplete(Response.from(AiMessage.from(List.of(ToolExecutionRequest.builder()
                            .id("large").name("read").arguments("{}").build()))));
                    return;
                }
                modelSawTail.set(messages.stream().filter(ToolExecutionResultMessage.class::isInstance)
                        .map(ToolExecutionResultMessage.class::cast).anyMatch(m -> m.text().endsWith("FULL_TAIL")));
                handler.onNext("done");
                handler.onComplete(Response.from(AiMessage.from("done")));
            }

            @Override public void generate(List<ChatMessage> messages, List<ToolSpecification> tools,
                                           StreamingResponseHandler<AiMessage> handler) {
                generate(messages, handler);
            }
        };
        when(chatModelFactory.getStreamingChatModel(MODEL)).thenReturn(model);

        AiAgentController.AgentChatRequest request = new AiAgentController.AgentChatRequest();
        request.setProjectId(1L);
        request.setConversationId("conv-full-tool-result");
        request.setMessage("read");
        request.setModel(MODEL);
        orchestrator.handleUserMessage(request, 7L);

        assertTrue(modelSawTail.get(), "the model must receive the complete tool observation");
        org.mockito.ArgumentCaptor<String> saved = org.mockito.ArgumentCaptor.forClass(String.class);
        verify(messageService, atLeastOnce()).upsertAssistantMessage(any(), any(), any(), any(), saved.capture());
        assertTrue(saved.getAllValues().stream().anyMatch(v -> v.contains("...(truncated)") || v.contains("...(截断)")));
        assertTrue(saved.getAllValues().stream().noneMatch(v -> v.contains("FULL_TAIL")));
    }

    /** O12：DeepSeek V4 Pro 用不存在的原生 final 工具表示「答完了」；此前每次回「未知工具」，它再发，直到轮数耗尽。 */
    private int runPseudoFinal(String conversationId, String finalText) {
        return runPseudoFinal(conversationId, finalText, "{\"success\":true}", "{\"arguments\": \"\"}", true);
    }

    private int runPseudoFinal(String conversationId, String finalText, String toolOutput, String finalArgs) {
        return runPseudoFinal(conversationId, finalText, toolOutput, finalArgs, true);
    }

    private int runPseudoFinal(String conversationId, String finalText, String toolOutput, String finalArgs, boolean expectFinished) {
        List<String> executed = new CopyOnWriteArrayList<>();
        when(toolRegistry.execute(any(), any(), any())).thenAnswer(inv -> {
            executed.add(inv.getArgument(0));
            return new ToolRegistry.ToolResult(toolOutput, null, true);
        });
        AtomicInteger calls = new AtomicInteger();
        StreamingChatLanguageModel model = new StreamingChatLanguageModel() {
            @Override public void generate(List<ChatMessage> messages, StreamingResponseHandler<AiMessage> handler) {
                int n = calls.incrementAndGet();
                if (n == 1) {
                    handler.onComplete(Response.from(AiMessage.from(List.of(ToolExecutionRequest.builder()
                            .id("w").name("slide_set_text").arguments("{}").build()))));
                    return;
                }
                if (n > 4) { // 修复前：一直发 final，这里兜底让测试结束
                    handler.onNext("x");
                    handler.onComplete(Response.from(AiMessage.from("x")));
                    return;
                }
                if (!finalText.isEmpty()) handler.onNext(finalText);
                List<ToolExecutionRequest> fin = List.of(ToolExecutionRequest.builder()
                        .id("f" + n).name("final").arguments(finalArgs).build());
                handler.onComplete(Response.from(finalText.isEmpty() ? AiMessage.from(fin) : AiMessage.from(finalText, fin)));
            }

            @Override public void generate(List<ChatMessage> messages, List<ToolSpecification> tools,
                                           StreamingResponseHandler<AiMessage> handler) {
                generate(messages, handler);
            }
        };
        when(chatModelFactory.getStreamingChatModel(MODEL)).thenReturn(model);
        AiAgentController.AgentChatRequest request = new AiAgentController.AgentChatRequest();
        request.setProjectId(1L);
        request.setConversationId(conversationId);
        request.setMessage("把第三页标题改短");
        request.setModel(MODEL);
        orchestrator.handleUserMessage(request, 7L);
        assertEquals(List.of("slide_set_text"), executed, "final 不能当工具执行");
        if (expectFinished) assertTrue(String.valueOf(bubbleEndData()).contains("finished"));
        return calls.get();
    }

    @Test
    @DisplayName("原生伪工具 final 带正文：当本轮收尾，不再回「未知工具」让模型重发")
    void pseudoFinalWithTextEndsTheTurn() {
        assertEquals(2, runPseudoFinal("conv-final-text", "已把标题改短。"));
    }

    @Test
    @DisplayName("原生伪工具 final 无正文：同样收尾，不当空响应重试")
    void pseudoFinalWithoutTextEndsTheTurn() {
        assertEquals(2, runPseudoFinal("conv-final-blank", ""));
    }

    @Test
    @DisplayName("X39：续写不新建用户行，写回同一条回答（去掉中断标记后接着追加），提示词换成续写指令")
    void continueTurnAppendsToTheSameAnswerWithoutAUserRow() {
        String conv = "conv-continue";
        when(messageService.listHistoryForAssembly(conv)).thenReturn(List.of(
                new com.checkba.repository.ProjectAiMessageRepository.HistoryLine(5L, "USER", "写一份备忘录", 0L),
                new com.checkba.repository.ProjectAiMessageRepository.HistoryLine(9L, "ASSISTANT",
                        "前半段正文。\n\n[生成出错，已中断]", 0L)));
        when(messageService.upsertAssistantMessage(any(), any(), any(), any(), any())).thenReturn(9L);
        StreamingChatLanguageModel model = new StreamingChatLanguageModel() {
            @Override public void generate(List<ChatMessage> messages, StreamingResponseHandler<AiMessage> handler) {
                handler.onNext("后半段。");
                handler.onComplete(Response.from(AiMessage.from("后半段。")));
            }
            @Override public void generate(List<ChatMessage> messages, List<ToolSpecification> tools,
                                           StreamingResponseHandler<AiMessage> handler) { generate(messages, handler); }
        };
        when(chatModelFactory.getStreamingChatModel(MODEL)).thenReturn(model);
        AiAgentController.AgentChatRequest request = new AiAgentController.AgentChatRequest();
        request.setProjectId(1L);
        request.setConversationId(conv);
        request.setMessage("continue");
        request.setModel(MODEL);
        request.setContinueTurn(true);
        orchestrator.handleUserMessage(request, 7L);

        verify(messageService, never()).saveMessage(any(), any(), any(), eq("USER"), any(), any(), any());
        org.mockito.ArgumentCaptor<Long> ids = org.mockito.ArgumentCaptor.forClass(Long.class);
        org.mockito.ArgumentCaptor<String> contents = org.mockito.ArgumentCaptor.forClass(String.class);
        verify(messageService, atLeastOnce()).upsertAssistantMessage(any(), any(), any(), ids.capture(), contents.capture());
        assertTrue(ids.getAllValues().stream().allMatch(id -> Long.valueOf(9L).equals(id)), "always the interrupted row: " + ids.getAllValues());
        String last = contents.getAllValues().get(contents.getAllValues().size() - 1);
        assertTrue(last.contains("前半段正文。") && last.contains("后半段。") && !last.contains("已中断"), last);
        assertTrue(last.indexOf("前半段正文。") < last.indexOf("后半段。"), last);
        assertTrue(request.getMessage().contains("从断开处直接接着写") || request.getMessage().contains("Continue exactly"), request.getMessage());
    }

    @Test
    @DisplayName("X39 + Q24：续写的模型调用带本轮计费标记（同一 runId），费用记进这一轮的页脚")
    void continueTurnRunsUnderThisRunsPlatformTurnTag(@org.junit.jupiter.api.io.TempDir java.nio.file.Path dir) throws Exception {
        var identity = new com.checkba.service.telemetry.InstallIdentityService(dir.toString());
        var idField = AgentOrchestrator.class.getDeclaredField("installIdentity");
        idField.setAccessible(true);
        idField.set(orchestrator, identity);
        var runsField = AgentOrchestrator.class.getDeclaredField("activeRuns");
        runsField.setAccessible(true);
        @SuppressWarnings("unchecked")
        var runs = (java.util.Map<String, AgentOrchestrator.RunGuard>) runsField.get(orchestrator);

        String conv = "conv-continue-tag";
        when(messageService.listHistoryForAssembly(conv)).thenReturn(List.of(
                new com.checkba.repository.ProjectAiMessageRepository.HistoryLine(5L, "USER", "写一份备忘录", 0L),
                new com.checkba.repository.ProjectAiMessageRepository.HistoryLine(9L, "ASSISTANT",
                        "前半段正文。\n\n[生成出错，已中断]", 0L)));
        when(messageService.upsertAssistantMessage(any(), any(), any(), any(), any())).thenReturn(9L);
        String[] seenTag = new String[1];
        String[] seenRun = new String[1];
        StreamingChatLanguageModel model = new StreamingChatLanguageModel() {
            @Override public void generate(List<ChatMessage> messages, StreamingResponseHandler<AiMessage> handler) {
                seenTag[0] = PlatformTurnScope.current();
                AgentOrchestrator.RunGuard g = runs.get(conv);
                seenRun[0] = g == null ? null : g.runId;
                handler.onNext("后半段。");
                handler.onComplete(Response.from(AiMessage.from("后半段。")));
            }
            @Override public void generate(List<ChatMessage> messages, List<ToolSpecification> tools,
                                           StreamingResponseHandler<AiMessage> handler) { generate(messages, handler); }
        };
        when(chatModelFactory.getStreamingChatModel(MODEL)).thenReturn(model);
        AiAgentController.AgentChatRequest request = new AiAgentController.AgentChatRequest();
        request.setProjectId(1L);
        request.setConversationId(conv);
        request.setMessage("continue");
        request.setModel(MODEL);
        request.setContinueTurn(true);
        orchestrator.handleUserMessage(request, 7L);

        assertNotNull(seenRun[0], "the continuation ran as a registered run");
        assertNotNull(seenTag[0], "the continuation's model call carries a platform turn tag");
        assertEquals(identity.turnTag(conv, seenRun[0]), seenTag[0], "tag = this run's tag, so its cost lands in this turn's footer");
        assertNull(PlatformTurnScope.current(), "scope is cleared after the turn");
    }

    @Test
    @DisplayName("X39：最后一行不是中途断开的回答时不能续写")
    void continueIsRefusedWhenTheLastAnswerWasNotCutOff() {
        when(messageService.listHistoryForAssembly("conv-done")).thenReturn(List.of(
                new com.checkba.repository.ProjectAiMessageRepository.HistoryLine(9L, "ASSISTANT", "完整回答。", 0L)));
        assertFalse(orchestrator.canContinue("conv-done"));
        when(messageService.listHistoryForAssembly("conv-cut")).thenReturn(List.of(
                new com.checkba.repository.ProjectAiMessageRepository.HistoryLine(9L, "ASSISTANT", "半截\n\n[生成出错，已中断]", 0L)));
        assertTrue(orchestrator.canContinue("conv-cut"));
    }

    @Test
    @DisplayName("D34：上一步工具失败、final 无正文也无参数：补一轮「请回复用户」提醒，不让用户只看到一条失败")
    void pseudoFinalBlankAfterAFailedToolIsRetried() {
        int calls = runPseudoFinal("conv-final-after-fail", "",
                "Error: this file cannot be read: it is damaged or not a valid document.", "{}", false);
        assertTrue(calls > 2, "blank final after a failed tool must not end the turn silently, calls=" + calls);
    }

    @Test
    @DisplayName("D34：final 无正文但参数里有答复：答复当正文收尾")
    void pseudoFinalAnswerInArgumentsBecomesTheReply() {
        assertEquals(2, runPseudoFinal("conv-final-args", "", "{\"success\":true}", "{\"answer\": \"两份已读，第三份打不开。\"}"));
        org.mockito.ArgumentCaptor<String> saved = org.mockito.ArgumentCaptor.forClass(String.class);
        verify(messageService, atLeastOnce()).upsertAssistantMessage(any(), any(), any(), any(), saved.capture());
        assertTrue(saved.getAllValues().stream().anyMatch(v -> v.contains("两份已读，第三份打不开。")), String.valueOf(saved.getAllValues()));
    }
}
