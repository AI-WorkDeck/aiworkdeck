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
import dev.langchain4j.data.message.ToolExecutionResultMessage;
import dev.langchain4j.data.message.UserMessage;
import dev.langchain4j.model.StreamingResponseHandler;
import dev.langchain4j.model.chat.StreamingChatLanguageModel;
import dev.langchain4j.model.output.Response;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 破坏性工具确认闸（agent-app-control P2-1）：destructive 工具分发前暂停、发 ask_user 卡；
 * 答「执行」按原参数重放一次，其他答复告诉模型已取消。原生与 XML 两条路径同口径。
 */
class AgentOrchestratorDestructiveConfirmTest {

    private static final String MODEL = "qwen/qwen3.7-flash";
    private static final String ARGS = "{\"targetsJson\":\"[\\\"合同草稿.docx\\\"]\"}";

    private ChatModelFactory chatModelFactory;
    private SseEmitterService sse;
    private AgentRunStateService runState;
    private ToolRegistry toolRegistry;
    private XmlToolCallParser parser;
    private List<String> sseEvents;
    private List<String> sseData;
    private AgentOrchestrator orchestrator;

    private static final class ScriptModel implements StreamingChatLanguageModel {
        private final List<AiMessage> script;
        final AtomicInteger calls = new AtomicInteger();
        volatile List<ChatMessage> lastMessages = List.of();

        ScriptModel(List<AiMessage> script) {
            this.script = script;
        }

        @Override
        public void generate(List<ChatMessage> messages, StreamingResponseHandler<AiMessage> handler) {
            lastMessages = new ArrayList<>(messages);
            AiMessage msg = script.get(Math.min(calls.getAndIncrement(), script.size() - 1));
            if (msg.text() != null && !msg.text().isEmpty()) handler.onNext(msg.text());
            handler.onComplete(Response.from(msg));
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
        sse = mock(SseEmitterService.class);
        doAnswer(inv -> {
            sseEvents.add(inv.getArgument(1));
            sseData.add(String.valueOf((Object) inv.getArgument(2)));
            return null;
        }).when(sse).send(any(), any(), any());

        ProjectAiMessageService messageService = mock(ProjectAiMessageService.class);
        when(messageService.countByConversationId(any())).thenAnswer(inv -> (long) messageService.listByConversationId(inv.getArgument(0)).size());
        when(messageService.listByConversationId(any()))
                .thenReturn(List.of(mock(ProjectAiMessage.class), mock(ProjectAiMessage.class)));
        when(messageService.upsertAssistantMessage(any(), any(), any(), any(), any())).thenReturn(1L);

        ContextAssemblerService assembler = mock(ContextAssemblerService.class);
        when(assembler.assemble(any(), any(), any(), any(), any(), any(), any(), any(), any(), any(), any()))
                .thenAnswer(inv -> new ArrayList<ChatMessage>(List.of(
                        SystemMessage.from("system"), UserMessage.from("把合同草稿.docx删了"))));

        toolRegistry = mock(ToolRegistry.class);
        when(toolRegistry.getAllSpecifications(any(), any())).thenReturn(List.of());
        when(toolRegistry.resolve(anyString())).thenReturn(java.util.Optional.empty());
        when(toolRegistry.requiresConfirmation("move_to_trash")).thenReturn(true);
        when(toolRegistry.execute(any(), any(), any()))
                .thenReturn(new ToolRegistry.ToolResult("trashed: 1", null, true));

        SkillRouter skillRouter = mock(SkillRouter.class);
        when(skillRouter.visibleTools(any(), any())).thenAnswer(inv -> inv.getArgument(1));
        when(skillRouter.activeSkill(any())).thenReturn(java.util.Optional.empty());
        parser = mock(XmlToolCallParser.class);
        when(parser.containsToolCall(any())).thenReturn(false);

        AiContextProperties contextProperties = new AiContextProperties();
        runState = new AgentRunStateService(
                mock(com.checkba.repository.AgentRunRecordRepository.class),
                mock(com.checkba.service.telemetry.TelemetryTurnTracker.class));
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
                new com.checkba.service.ai.OfficePassStateStore());
    }

    private ScriptModel run(String conversationId, String message, AiMessage... script) {
        ScriptModel model = new ScriptModel(List.of(script));
        when(chatModelFactory.getStreamingChatModel(MODEL)).thenReturn(model);
        AiAgentController.AgentChatRequest request = new AiAgentController.AgentChatRequest();
        request.setProjectId(1L);
        request.setConversationId(conversationId);
        request.setMessage(message);
        request.setModel(MODEL);
        orchestrator.handleUserMessage(request, 7L);
        return model;
    }

    private static AiMessage trashCall() {
        return AiMessage.from(List.of(ToolExecutionRequest.builder()
                .id("t1").name("move_to_trash").arguments(ARGS).build()));
    }

    private String askUserEvent() {
        for (int i = 0; i < sseEvents.size(); i++) {
            if ("ask_user".equals(sseEvents.get(i))) return sseData.get(i);
        }
        return null;
    }

    private static String answer(String eventJson, String label) {
        String id = cn.hutool.json.JSONUtil.parseObj(eventJson).getStr("id");
        return "<ask_user_answer id=\"" + id + "\">\nQuestion: q\nSelected:\n- " + label + "\n</ask_user_answer>";
    }

    private static String lastUserText(ScriptModel model) {
        List<ChatMessage> m = model.lastMessages;
        return dev.langchain4j.data.message.UserMessage.class.cast(m.get(m.size() - 1)).singleText();
    }

    private void assertGateCard(ScriptModel model, String conv) {
        assertEquals(1, model.calls.get(), "暂停确认后不得递归下一轮");
        verify(toolRegistry, never()).execute(eq("move_to_trash"), any(), any());
        assertEquals(AgentRunStateService.RunStatus.AWAITING_INPUT, runState.get(conv).status());
        String card = askUserEvent();
        assertNotNull(card, "应发出 ask_user 卡");
        var json = cn.hutool.json.JSONUtil.parseObj(card);
        assertTrue(json.getStr("question").startsWith("确认执行「"), json.getStr("question"));
        assertTrue(json.getStr("question").contains("合同草稿.docx"), json.getStr("question"));
        assertEquals(List.of("执行", "取消"), json.getJSONArray("options").stream()
                .map(o -> ((cn.hutool.json.JSONObject) o).getStr("label")).toList());
    }

    @Test
    @DisplayName("原生路径：destructive 工具不执行，发确认卡并停在 AWAITING_INPUT")
    void nativeDestructiveCallPausesWithConfirmCard() {
        ScriptModel model = run("conv-n1", "把合同草稿.docx删了", trashCall(), AiMessage.from("不该被用到"));
        assertGateCard(model, "conv-n1");
    }

    @Test
    @DisplayName("答「执行」：以原参数重放恰好一次，结果交给模型；再答同一张卡不会重复执行")
    void approvalReplaysOriginalArgsExactlyOnce() {
        ScriptModel first = run("conv-n2", "把合同草稿.docx删了", trashCall());
        String card = askUserEvent();
        assertNotNull(card);
        ScriptModel second = run("conv-n2", answer(card, "执行"), AiMessage.from("已移入回收站"));
        verify(toolRegistry, times(1)).execute(eq("move_to_trash"), eq(ARGS), any());
        assertTrue(lastUserText(second).contains("trashed: 1"), lastUserText(second));
        // 同一张卡的答复重复到达：挂起调用已被取走，不再执行
        run("conv-n2", answer(card, "执行"), AiMessage.from("好的"));
        verify(toolRegistry, times(1)).execute(eq("move_to_trash"), any(), any());
    }

    @Test
    @DisplayName("答「取消」（或「其他」自由输入）：不执行，模型被告知用户取消了")
    void cancelAndFreeTextNeverExecute() {
        run("conv-n3", "把合同草稿.docx删了", trashCall());
        String card = askUserEvent();
        ScriptModel second = run("conv-n3", answer(card, "取消"), AiMessage.from("好，已取消"));
        verify(toolRegistry, never()).execute(eq("move_to_trash"), any(), any());
        assertTrue(lastUserText(second).contains("用户取消了「"), lastUserText(second));

        sseEvents.clear(); sseData.clear();
        run("conv-n4", "把合同草稿.docx删了", trashCall());
        String card2 = askUserEvent();
        String id = cn.hutool.json.JSONUtil.parseObj(card2).getStr("id");
        run("conv-n4", "<ask_user_answer id=\"" + id + "\">\nOther: 先别删\n</ask_user_answer>", AiMessage.from("好"));
        verify(toolRegistry, never()).execute(eq("move_to_trash"), any(), any());
    }

    @Test
    @DisplayName("XML 兜底路径同口径：不执行、发确认卡；答执行后重放一次")
    void xmlPathIsGatedToo() {
        when(parser.containsToolCall(org.mockito.ArgumentMatchers.<String>any())).thenAnswer(inv -> String.valueOf((Object) inv.getArgument(0)).contains("move_to_trash"));
        when(parser.parse(org.mockito.ArgumentMatchers.<String>any())).thenReturn(List.of(new XmlToolCallParser.ParsedCall(
                "move_to_trash", ARGS, "move_to_trash(...)", null)));
        ScriptModel model = run("conv-x1", "把合同草稿.docx删了",
                AiMessage.from("<tool_code>move_to_trash(targetsJson='[\"合同草稿.docx\"]')</tool_code>"),
                AiMessage.from("不该被用到"));
        assertGateCard(model, "conv-x1");

        String card = askUserEvent();
        when(parser.containsToolCall(any())).thenReturn(false);
        run("conv-x1", answer(card, "执行"), AiMessage.from("完成"));
        verify(toolRegistry, times(1)).execute(eq("move_to_trash"), eq(ARGS), any());
    }

    @Test
    @DisplayName("非破坏性工具不受影响：直接执行，无确认卡")
    void nonDestructiveToolRunsWithoutCard() {
        run("conv-r1", "读一下", AiMessage.from(List.of(ToolExecutionRequest.builder()
                .id("t1").name("read_document").arguments("{\"fileId\":\"12\"}").build())), AiMessage.from("读完了"));
        verify(toolRegistry, times(1)).execute(eq("read_document"), any(), any());
        assertNull(askUserEvent());
    }

    @Test
    @DisplayName("参数摘要只给标识与数量，不回显大段正文")
    void argsSummaryDoesNotLeakBulkContent() {
        String huge = "机密".repeat(500);
        String s = DestructiveConfirmation.summarizeArgs(
                "{\"fileName\":\"a.docx\",\"content\":\"" + huge + "\",\"ids\":[1,2,3,4],\"note\":\"" + huge + "\"}");
        assertFalse(s.contains("机密机密"), s);
        assertTrue(s.contains("a.docx"), s);
        assertTrue(s.length() <= 125, s);
    }
}
