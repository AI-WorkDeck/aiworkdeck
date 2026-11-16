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

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.IntFunction;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * 轮数提醒（gap R5 / P4）走真实编排器循环：长跑的轮次在第 15 轮看到一次末位提醒，但从不暂停
 * （所有者决定：只提醒不暂停）；批量调用只算一轮。
 */
class AgentOrchestratorRunBudgetTest {

    private static final String MODEL = "qwen/qwen3.7-flash";

    private ChatModelFactory chatModelFactory;
    private ProjectAiMessageService messageService;
    private TodoListService todoListService;
    private List<String> sseEvents;
    private List<String> sseData;
    private AgentOrchestrator orchestrator;

    /** 前 toolRounds 次回复各发一批工具调用（批由 batch 生成），之后给最终回答。记录每次看到的末位消息。 */
    private static final class ScriptModel implements StreamingChatLanguageModel {
        final int toolRounds;
        final IntFunction<List<ToolExecutionRequest>> batch;
        final AtomicInteger calls = new AtomicInteger();
        final List<String> lastUserText = new CopyOnWriteArrayList<>();

        ScriptModel(int toolRounds, IntFunction<List<ToolExecutionRequest>> batch) {
            this.toolRounds = toolRounds;
            this.batch = batch;
        }

        @Override
        public void generate(List<ChatMessage> messages, StreamingResponseHandler<AiMessage> handler) {
            int n = calls.incrementAndGet();
            ChatMessage last = messages.isEmpty() ? null : messages.get(messages.size() - 1);
            lastUserText.add(last instanceof UserMessage u ? u.singleText() : "");
            if (n <= toolRounds) {
                handler.onComplete(Response.from(AiMessage.from(batch.apply(n))));
            } else {
                handler.onNext("<final>完成</final>");
                handler.onComplete(Response.from(AiMessage.from("<final>完成</final>")));
            }
        }

        @Override
        public void generate(List<ChatMessage> messages, List<ToolSpecification> tools,
                             StreamingResponseHandler<AiMessage> handler) {
            generate(messages, handler);
        }
    }

    private static List<ToolExecutionRequest> reads(int round, int count) {
        List<ToolExecutionRequest> out = new ArrayList<>();
        for (int i = 0; i < count; i++) {
            out.add(ToolExecutionRequest.builder().id("t" + round + "_" + i).name("doc_get_paragraph")
                    .arguments("{\"index\":" + (round * 100 + i) + "}").build());
        }
        return out;
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
        when(messageService.countByConversationId(any())).thenAnswer(inv -> (long) messageService.listByConversationId(inv.getArgument(0)).size());
        when(messageService.listByConversationId(any()))
                .thenReturn(List.of(mock(ProjectAiMessage.class), mock(ProjectAiMessage.class)));
        when(messageService.upsertAssistantMessage(any(), any(), any(), any(), any())).thenReturn(1L);

        ContextAssemblerService assembler = mock(ContextAssemblerService.class);
        when(assembler.assemble(any(), any(), any(), any(), any(), any(), any(), any(), any(), any(), any()))
                .thenAnswer(inv -> new ArrayList<ChatMessage>(List.of(
                        SystemMessage.from("system"), UserMessage.from("审查这份合同"))));

        ToolRegistry toolRegistry = mock(ToolRegistry.class);
        when(toolRegistry.getAllSpecifications(any(), any())).thenReturn(List.of());
        when(toolRegistry.resolve(anyString())).thenReturn(java.util.Optional.empty());
        AtomicInteger outputs = new AtomicInteger();
        when(toolRegistry.execute(any(), any(), any()))
                .thenAnswer(inv -> new ToolRegistry.ToolResult("{\"paragraph\":\"p" + outputs.incrementAndGet() + "\"}", null, true));

        SkillRouter skillRouter = mock(SkillRouter.class);
        when(skillRouter.visibleTools(any(), any())).thenAnswer(inv -> inv.getArgument(1));
        when(skillRouter.activeSkill(any())).thenReturn(java.util.Optional.empty());
        XmlToolCallParser parser = mock(XmlToolCallParser.class);
        when(parser.containsToolCall(any())).thenReturn(false);

        todoListService = mock(TodoListService.class);
        AiContextProperties contextProperties = new AiContextProperties();
        AgentRunStateService runState = new AgentRunStateService(
                mock(com.checkba.repository.AgentRunRecordRepository.class),
                mock(com.checkba.service.telemetry.TelemetryTurnTracker.class));
        orchestrator = new AgentOrchestrator(
                chatModelFactory, messageService, sse, mock(TokenUsageService.class), assembler,
                toolRegistry, skillRouter, parser, mock(MemoryPipelineService.class),
                mock(ProjectFileService.class), mock(EditorBridgeService.class),
                mock(ConversationFileChangeService.class), todoListService,
                mock(DocumentCheckpointService.class), runState,
                mock(com.checkba.version.WorkSessionService.class), new AiFailoverProperties(),
                new RunLoopCompactor(contextProperties, new ContextCompressor(null, null, contextProperties)),
                mock(com.checkba.service.telemetry.TelemetryService.class),
                mock(com.checkba.service.telemetry.TelemetryTurnTracker.class),
                mock(com.checkba.service.telemetry.MatterClassifierService.class),
                new OfficePassStateStore());
    }

    private void run(ScriptModel model, String conversationId) {
        when(chatModelFactory.getStreamingChatModel(MODEL)).thenReturn(model);
        AiAgentController.AgentChatRequest request = new AiAgentController.AgentChatRequest();
        request.setProjectId(1L);
        request.setConversationId(conversationId);
        request.setMessage("审查这份合同");
        request.setModel(MODEL);
        orchestrator.handleUserMessage(request, 7L);
    }

    private String bubbleEndData() {
        for (int i = sseEvents.size() - 1; i >= 0; i--) {
            if ("bubble_end".equals(sseEvents.get(i))) return sseData.get(i);
        }
        return null;
    }

    @Test
    void longRunIsNeverPausedAndSeesTheRoundNudgeOnce() {
        ScriptModel model = new ScriptModel(60, n -> reads(n, 1));
        run(model, "conv-long-run");

        assertEquals(61, model.calls.get(), "all 60 tool rounds and the final answer run");
        String end = bubbleEndData();
        assertTrue(end.contains("finished"), end);
        assertFalse(end.contains("paused"), end);

        for (int i = 0; i < model.lastUserText.size(); i++) {
            boolean nudged = model.lastUserText.get(i).contains("轮工具调用");
            assertEquals(i == RunBudget.SOFT_NUDGE_ROUND, nudged, "call " + (i + 1) + ": " + model.lastUserText.get(i));
        }
    }

    @Test
    void longReviewWithBatchedCallsFinishes() {
        // 29 rounds × 4 calls = 116 tool calls (e.g. many comments): rounds, not calls, are counted
        ScriptModel model = new ScriptModel(29, n -> reads(n, 4));
        run(model, "conv-long-review");

        assertEquals(30, model.calls.get());
        String end = bubbleEndData();
        assertTrue(end.contains("finished"), end);
        assertFalse(end.contains("paused"), end);
    }
}
