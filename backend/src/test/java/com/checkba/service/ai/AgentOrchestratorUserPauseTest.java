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
import com.checkba.service.ai.skill.SkillProperties;
import com.checkba.service.ai.skill.SkillRegistry;
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
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * 用户「暂停」与「停止时的修改计数」（用户控制 3/4/5）。
 *
 * <p>暂停只在安全边界生效：正在执行的那一批工具照常跑完、结果入栈，下一次调用模型之前
 * 收尾成 PAUSED（reason=user_pause）。原生工具调用与 XML 兜底两条工具循环各守一条。
 */
class AgentOrchestratorUserPauseTest {

    private static final String MODEL = "qwen/qwen3.7-flash";
    private static final String CONV = "conv-pause";

    @TempDir
    Path tempDir;

    private ChatModelFactory chatModelFactory;
    private SseEmitterService sse;
    private ProjectAiMessageService messageService;
    private ToolRegistry toolRegistry;
    private XmlToolCallParser parser;
    private AgentRunStateService runState;
    private AgentOrchestrator orchestrator;

    private final List<String[]> sseEvents = new CopyOnWriteArrayList<>();
    private final Map<Long, String> rows = new ConcurrentHashMap<>();
    private final AtomicLong idSeq = new AtomicLong();

    /** 门控脚本模型：过闸之后继续吐 token，用来验证「取消之后一个字都不该再转发」。 */
    private static final class GatedModel implements StreamingChatLanguageModel {
        private final List<AiMessage> script;
        private final CountDownLatch reachedGate;
        private final CountDownLatch mayPassGate;
        private final List<String> preGateChunks;
        private final List<String> postGateChunks;
        int calls;

        GatedModel(List<AiMessage> script, CountDownLatch reachedGate, CountDownLatch mayPassGate,
                   List<String> preGateChunks, List<String> postGateChunks) {
            this.script = script;
            this.reachedGate = reachedGate;
            this.mayPassGate = mayPassGate;
            this.preGateChunks = preGateChunks;
            this.postGateChunks = postGateChunks;
        }

        static GatedModel ungated(AiMessage... script) {
            return new GatedModel(List.of(script), null, null, List.of(), List.of());
        }

        @Override
        public void generate(List<ChatMessage> messages, StreamingResponseHandler<AiMessage> handler) {
            generate(messages, List.of(), handler);
        }

        @Override
        public void generate(List<ChatMessage> messages, List<ToolSpecification> tools,
                             StreamingResponseHandler<AiMessage> handler) {
            int idx = calls++;
            AiMessage msg = script.get(Math.min(idx, script.size() - 1));
            if (idx == 0 && reachedGate != null) {
                for (String chunk : preGateChunks) handler.onNext(chunk);
                reachedGate.countDown();
                awaitQuietly(mayPassGate);
                for (String chunk : postGateChunks) handler.onNext(chunk);
            } else if (msg.text() != null && !msg.text().isEmpty()) {
                handler.onNext(msg.text());
            }
            handler.onComplete(Response.from(msg));
        }
    }

    private static void awaitQuietly(CountDownLatch latch) {
        if (latch == null) return;
        try {
            assertTrue(latch.await(10, TimeUnit.SECONDS), "等待交错点超时");
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    @BeforeEach
    void setUp() throws IOException {
        chatModelFactory = mock(ChatModelFactory.class);
        sse = mock(SseEmitterService.class);
        sseEvents.clear();
        rows.clear();
        doAnswer(inv -> {
            // 注意 String.valueOf(inv.getArgument(2)) 会被重载决议挑成 String.valueOf(char[])
            // 并在运行期 ClassCastException——必须先落成 Object
            Object payload = inv.getArgument(2);
            sseEvents.add(new String[]{inv.getArgument(1, String.class), String.valueOf(payload)});
            return null;
        }).when(sse).send(any(), any(), any());

        messageService = mock(ProjectAiMessageService.class);
        when(messageService.countByConversationId(any()))
                .thenAnswer(inv -> (long) messageService.listByConversationId(inv.getArgument(0)).size());
        when(messageService.listByConversationId(any()))
                .thenReturn(List.of(mock(ProjectAiMessage.class), mock(ProjectAiMessage.class)));
        when(messageService.upsertAssistantMessage(any(), any(), any(), any(), any())).thenAnswer(inv -> {
            Long existing = inv.getArgument(3, Long.class);
            Long id = existing != null ? existing : idSeq.incrementAndGet();
            rows.put(id, inv.getArgument(4, String.class));
            return id;
        });

        ContextAssemblerService assembler = mock(ContextAssemblerService.class);
        when(assembler.assemble(any(), any(), any(), any(), any(), any(), any(), any(), any(), any(), any()))
                .thenAnswer(inv -> new ArrayList<ChatMessage>(List.of(
                        SystemMessage.from("system"), UserMessage.from("user"))));

        toolRegistry = mock(ToolRegistry.class);
        when(toolRegistry.getAllSpecifications(any(), any()))
                .thenReturn(List.of(ToolSpecification.builder().name("read_document").description("d").build()));
        when(toolRegistry.resolve(anyString())).thenReturn(java.util.Optional.empty());
        when(toolRegistry.execute(any(), any(), any()))
                .thenReturn(new ToolRegistry.ToolResult("ok", null, true));

        SkillProperties skillProps = new SkillProperties();
        skillProps.setDir(tempDir.toString());
        skillProps.setBaseTools(List.of("read_document"));
        SkillRegistry skillRegistry = new SkillRegistry(skillProps, null, new PluginService(), null);
        skillRegistry.init();
        SkillRouter skillRouter = new SkillRouter(skillRegistry, skillProps,
                new com.checkba.service.telemetry.TelemetryService(
                        mock(com.checkba.repository.TelemetryEventRepository.class),
                        new com.checkba.service.telemetry.InstallIdentityService(tempDir.toString()),
                        "test"),
                null);

        parser = mock(XmlToolCallParser.class);
        when(parser.containsToolCall(any()))
                .thenAnswer(inv -> String.valueOf((Object) inv.getArgument(0)).contains("<tool_code>"));
        when(parser.extractProcessName(any())).thenReturn(java.util.Optional.of("修改文档"));
        when(parser.parse(any())).thenAnswer(inv ->
                String.valueOf((Object) inv.getArgument(0)).contains("<tool_code>")
                        ? List.of(new XmlToolCallParser.ParsedCall("doc_replace_selection",
                                "{\"text\":\"x\"}", "doc_replace_selection(text=\"x\")"))
                        : List.of());

        AiContextProperties contextProperties = new AiContextProperties();
        runState = new AgentRunStateService(mock(com.checkba.repository.AgentRunRecordRepository.class),
                mock(com.checkba.service.telemetry.TelemetryTurnTracker.class));
        orchestrator = new AgentOrchestrator(
                chatModelFactory, messageService, sse, mock(TokenUsageService.class), assembler,
                toolRegistry, skillRouter, parser, mock(MemoryPipelineService.class),
                mock(ProjectFileService.class), mock(EditorBridgeService.class),
                mock(ConversationFileChangeService.class), mock(TodoListService.class),
                mock(DocumentCheckpointService.class),
                runState,
                mock(com.checkba.version.WorkSessionService.class), new AiFailoverProperties(),
                new RunLoopCompactor(contextProperties, new ContextCompressor(null, null, contextProperties)),
                mock(com.checkba.service.telemetry.TelemetryService.class),
                mock(com.checkba.service.telemetry.TelemetryTurnTracker.class),
                mock(com.checkba.service.telemetry.MatterClassifierService.class),
                new OfficePassStateStore());
    }

    private static AiAgentController.AgentChatRequest request(String message) {
        AiAgentController.AgentChatRequest r = new AiAgentController.AgentChatRequest();
        r.setProjectId(1L);
        r.setConversationId(CONV);
        r.setMessage(message);
        r.setModel(MODEL);
        return r;
    }

    private Thread runAsync(String message, StreamingChatLanguageModel model) {
        when(chatModelFactory.getStreamingChatModel(MODEL)).thenReturn(model);
        Thread t = new Thread(() -> orchestrator.handleUserMessage(request(message), 7L), "pause-turn");
        t.start();
        return t;
    }

    private static void join(Thread t) throws InterruptedException {
        t.join(20_000);
        assertFalse(t.isAlive(), "轮次线程未在 20s 内收尾，多半是死锁");
    }

    private String textDeltas() {
        StringBuilder sb = new StringBuilder();
        for (String[] e : sseEvents) if ("text_delta".equals(e[0])) sb.append(e[1]);
        return sb.toString();
    }

    private long countOf(String eventName) {
        return sseEvents.stream().filter(e -> eventName.equals(e[0])).count();
    }

    private String payloadOf(String eventName) {
        return sseEvents.stream().filter(e -> eventName.equals(e[0])).map(e -> e[1])
                .reduce((a, b) -> b).orElse(null);
    }

    /** 第一个工具执行中途点暂停，然后放行；返回已执行的工具次数计数器。 */
    private java.util.concurrent.atomic.AtomicInteger pauseDuringFirstTool(CountDownLatch started, CountDownLatch release) {
        java.util.concurrent.atomic.AtomicInteger executed = new java.util.concurrent.atomic.AtomicInteger();
        when(toolRegistry.execute(any(), any(), any())).thenAnswer(inv -> {
            if (executed.incrementAndGet() == 1) {
                started.countDown();
                awaitQuietly(release);
            }
            return new ToolRegistry.ToolResult("ok", null, true);
        });
        return executed;
    }

    @Test
    @DisplayName("原生工具：暂停不打断当前这一批工具，跑完之后、下一次调用模型之前以 paused/user_pause 收尾")
    void nativePauseTakesEffectAfterTheToolBatch() throws Exception {
        CountDownLatch started = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        var executed = pauseDuringFirstTool(started, release);
        GatedModel model = GatedModel.ungated(
                AiMessage.from(List.of(
                        ToolExecutionRequest.builder().id("1").name("doc_replace_selection").arguments("{}").build(),
                        ToolExecutionRequest.builder().id("2").name("doc_replace_selection").arguments("{}").build())),
                AiMessage.from("<final>不该走到这里</final>"));

        Thread t = runAsync("改两处", model);
        assertTrue(started.await(10, TimeUnit.SECONDS));
        assertTrue(orchestrator.requestPause(CONV), "有活跃轮次时暂停必须打中");
        release.countDown();
        join(t);

        assertEquals(2, executed.get(), "暂停绝不停在一批工具中间：第二个工具也要执行");
        assertEquals(1, model.calls, "暂停之后不许再调用模型");
        String end = payloadOf("bubble_end");
        assertTrue(end != null && end.contains("\"status\":\"paused\"") && end.contains("\"reason\":\"user_pause\""),
                "终态是 paused/user_pause：" + end);
        assertTrue(end.contains("\"documentEdited\":true"), end);
        assertEquals(AgentRunStateService.RunStatus.PAUSED, runState.get(CONV).status());
        assertEquals(0, countOf("cancelled"));
        String saved = String.join("\n", rows.values());
        assertTrue(saved.contains("<tool_code>doc_replace_selection"), "暂停前已执行的工具要落库，继续时模型才看得到：" + saved);
        assertTrue(saved.contains("已按你的要求暂停"), "落库正文带暂停说明，「继续」时模型知道是接着做同一个任务：" + saved);
        assertFalse(orchestrator.requestPause(CONV), "轮次已收尾，再点暂停打不中");
    }

    @Test
    @DisplayName("XML 兜底工具：同一安全边界生效")
    void xmlPauseTakesEffectAfterTheToolBatch() throws Exception {
        CountDownLatch started = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        var executed = pauseDuringFirstTool(started, release);
        GatedModel model = GatedModel.ungated(
                AiMessage.from("<process name=\"修改文档\"><tool_code>doc_replace_selection(text=\"x\")</tool_code></process>"),
                AiMessage.from("<final>不该走到这里</final>"));

        Thread t = runAsync("改一处", model);
        assertTrue(started.await(10, TimeUnit.SECONDS));
        assertTrue(orchestrator.requestPause(CONV));
        release.countDown();
        join(t);

        assertEquals(1, executed.get());
        assertEquals(1, model.calls, "暂停之后不许再调用模型");
        String end = payloadOf("bubble_end");
        assertTrue(end != null && end.contains("\"reason\":\"user_pause\""), "XML 路径同样以 user_pause 收尾：" + end);
        assertEquals(AgentRunStateService.RunStatus.PAUSED, runState.get(CONV).status());
    }

    @Test
    @DisplayName("没有活跃轮次时暂停打不中；没请求暂停的轮次照常跑完")
    void pauseWithoutActiveRunReportsMiss() throws Exception {
        assertFalse(orchestrator.requestPause(CONV));
        Thread t = runAsync("你好", GatedModel.ungated(AiMessage.from("<final>好的</final>")));
        join(t);
        String end = payloadOf("bubble_end");
        assertTrue(end != null && end.contains("\"status\":\"finished\""), end);
    }

    @Test
    @DisplayName("停止事件带上本轮已完成的文档修改次数（停止时显示「已完成 N 次修改」并给撤销入口）")
    void cancelledEventCarriesDocumentEditCount() throws Exception {
        CountDownLatch started = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        java.util.concurrent.atomic.AtomicInteger executed = new java.util.concurrent.atomic.AtomicInteger();
        when(toolRegistry.execute(any(), any(), any())).thenAnswer(inv -> {
            if (executed.incrementAndGet() == 2) {
                started.countDown();
                awaitQuietly(release);
            }
            return new ToolRegistry.ToolResult("ok", null, true);
        });
        GatedModel model = GatedModel.ungated(
                AiMessage.from(List.of(
                        ToolExecutionRequest.builder().id("1").name("doc_replace_selection").arguments("{}").build(),
                        ToolExecutionRequest.builder().id("2").name("doc_replace_selection").arguments("{}").build(),
                        ToolExecutionRequest.builder().id("3").name("doc_replace_selection").arguments("{}").build())),
                AiMessage.from("<final>不该走到这里</final>"));

        Thread t = runAsync("改三处", model);
        assertTrue(started.await(10, TimeUnit.SECONDS));
        assertTrue(orchestrator.setCancelled(CONV));
        release.countDown();
        join(t);

        String cancelled = payloadOf("cancelled");
        assertTrue(cancelled != null && cancelled.contains("\"documentEdited\":true")
                && cancelled.contains("\"documentEdits\":2"), "两次修改已经落地，第三次没执行：" + cancelled);
    }
}
