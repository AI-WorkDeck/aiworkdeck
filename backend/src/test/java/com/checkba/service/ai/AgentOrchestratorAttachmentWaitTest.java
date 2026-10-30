// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.ai;

import com.checkba.config.AiContextProperties;
import com.checkba.config.AiFailoverProperties;
import com.checkba.controller.ai.AiAgentController;
import com.checkba.service.AppLanguageScope;
import com.checkba.service.ProjectAiMessageService;
import com.checkba.service.ProjectFileService;
import com.checkba.service.ai.context.ContextCompressor;
import com.checkba.service.ai.context.ProjectContextHolder;
import com.checkba.service.ai.context.RunLoopCompactor;
import com.checkba.service.ai.memory.MemoryPipelineService;
import com.checkba.service.ai.skill.SkillRouter;
import com.checkba.service.ai.tools.ToolContext;
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

import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** Synthetic orchestration tests: no provider, personal database, file storage or real OCR. */
class AgentOrchestratorAttachmentWaitTest {
    private static final String MODEL = "qwen/qwen3.7-flash";
    private ChatModelFactory models;
    private ContextAssemblerService assembler;
    private ToolRegistry tools;
    private ProjectAiMessageService messages;
    private AgentOrchestrator orchestrator;
    private AgentRunStateService runState;
    private final List<Event> events = new CopyOnWriteArrayList<>();
    private final List<String> saved = new CopyOnWriteArrayList<>();
    private final Map<Long, List<ProjectAiMessageService.AttachmentRecord>> attachments = new ConcurrentHashMap<>();
    private final AtomicLong messageIds = new AtomicLong(100);
    private final AtomicInteger modelCalls = new AtomicInteger();
    private boolean asynchronousModelCallbacks;
    private final AtomicReference<List<AiMessage>> modelScript = new AtomicReference<>();
    private record Event(String kind, String data) {}

    @BeforeEach
    void setUp() {
        models = mock(ChatModelFactory.class);
        messages = mock(ProjectAiMessageService.class);
        when(messages.countByConversationId(any())).thenReturn(2L);
        when(messages.saveMessage(any(), any(), any(), any(), any(), any(), any()))
                .thenAnswer(inv -> messageIds.incrementAndGet());
        when(messages.upsertAssistantMessage(any(), any(), any(), any(), any())).thenAnswer(inv -> {
            saved.add(inv.getArgument(4));
            return 900L;
        });
        doAnswer(inv -> {
            attachments.put(inv.getArgument(0), List.copyOf(inv.getArgument(1)));
            return null;
        }).when(messages).recordAttachments(any(), any());
        SseEmitterService sse = mock(SseEmitterService.class);
        doAnswer(inv -> {
            events.add(new Event(inv.getArgument(1), String.valueOf((Object) inv.getArgument(2))));
            return null;
        }).when(sse).send(any(), any(), any());
        assembler = mock(ContextAssemblerService.class);
        // The main request path uses the sink overload; an 11-argument stub does not exercise it.
        when(assembler.assemble(any(), any(), any(), any(), any(), any(), any(), any(), any(), any(), any(), any()))
                .thenAnswer(inv -> context());
        tools = mock(ToolRegistry.class);
        when(tools.resolve(anyString())).thenReturn(Optional.empty());
        when(tools.getAllSpecifications(any(), any())).thenReturn(List.of(
                ToolSpecification.builder().name("extract_file_text").description("Read reference text").build()));
        when(tools.execute(any(), any(), any())).thenReturn(new ToolRegistry.ToolResult("read", null, true));
        SkillRouter router = mock(SkillRouter.class);
        when(router.visibleTools(any(), any())).thenAnswer(inv -> inv.getArgument(1));
        XmlToolCallParser parser = mock(XmlToolCallParser.class);
        AiContextProperties contextProperties = new AiContextProperties();
        runState = new AgentRunStateService(mock(com.checkba.repository.AgentRunRecordRepository.class),
                mock(com.checkba.service.telemetry.TelemetryTurnTracker.class));
        orchestrator = new AgentOrchestrator(models, messages, sse, mock(TokenUsageService.class), assembler,
                tools, router, parser, mock(MemoryPipelineService.class), mock(ProjectFileService.class),
                mock(EditorBridgeService.class), mock(ConversationFileChangeService.class), mock(TodoListService.class),
                mock(DocumentCheckpointService.class), runState, mock(com.checkba.version.WorkSessionService.class),
                new AiFailoverProperties(), new RunLoopCompactor(contextProperties,
                new ContextCompressor(null, null, contextProperties)),
                mock(com.checkba.service.telemetry.TelemetryService.class),
                mock(com.checkba.service.telemetry.TelemetryTurnTracker.class),
                mock(com.checkba.service.telemetry.MatterClassifierService.class), new OfficePassStateStore());
        modelScript.set(List.of(AiMessage.from("<final>Done</final>")));
        StreamingChatLanguageModel model = new StreamingChatLanguageModel() {
            @Override public void generate(List<ChatMessage> input, StreamingResponseHandler<AiMessage> handler) {
                generate(input, List.of(), handler);
            }
            @Override public void generate(List<ChatMessage> input, List<ToolSpecification> offered,
                                           StreamingResponseHandler<AiMessage> handler) {
                int index = modelCalls.getAndIncrement();
                List<AiMessage> script = modelScript.get();
                AiMessage answer = script.get(Math.min(index, script.size() - 1));
                Runnable callback = () -> {
                    if (answer.text() != null) handler.onNext(answer.text());
                    handler.onComplete(Response.from(answer));
                };
                if (!asynchronousModelCallbacks) callback.run();
                else {
                    Thread callbackThread = new Thread(callback, "OkHttp synthetic-model");
                    callbackThread.start();
                    try { join(callbackThread); }
                    catch (InterruptedException e) { Thread.currentThread().interrupt(); throw new IllegalStateException(e); }
                }
            }
        };
        when(models.getStreamingChatModel(MODEL)).thenReturn(model);
    }

    private static List<ChatMessage> context() {
        return new ArrayList<>(List.of(SystemMessage.from("Read only synthetic materials"), UserMessage.from("Read files")));
    }

    private static AiAgentController.AgentChatRequest request(String conversation, long project, String language) {
        var request = new AiAgentController.AgentChatRequest();
        request.setProjectId(project); request.setConversationId(conversation); request.setModel(MODEL);
        request.setMessage("Read these certificates one by one"); request.setAppLanguage(language);
        request.setMode("AGENT");
        List<AiAgentController.ContextItem> items = new ArrayList<>();
        for (int i = 1; i <= 25; i++) {
            var item = new AiAgentController.ContextItem(); item.setId(String.valueOf(i));
            item.setName("certificate-" + i + ".pdf"); item.setFileType("pdf"); items.add(item);
        }
        request.setContextItems(items);
        return request;
    }

    private Thread start(AiAgentController.AgentChatRequest request, long user) {
        Thread thread = new Thread(() -> orchestrator.handleUserMessage(request, user), "attachment-test-turn");
        thread.start(); return thread;
    }

    private static void join(Thread thread) throws InterruptedException {
        thread.join(3_000);
        assertFalse(thread.isAlive(), "bounded wait did not release the main turn within 3 seconds");
    }

    /** Intentionally emulate a parser/provider which ignores cancellation of its waiting future. */
    private static void awaitIgnoringInterrupt(CountDownLatch release) {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(8);
        while (release.getCount() > 0 && System.nanoTime() < deadline) {
            try { release.await(20, TimeUnit.MILLISECONDS); } catch (InterruptedException ignored) { }
        }
        Thread.interrupted();
    }

    private void assertOriginalAttachments() {
        assertEquals(1, attachments.size());
        List<ProjectAiMessageService.AttachmentRecord> records = attachments.values().iterator().next();
        assertEquals(25, records.size());
        assertEquals(java.util.stream.IntStream.rangeClosed(1, 25).mapToObj(String::valueOf).toList(),
                records.stream().map(ProjectAiMessageService.AttachmentRecord::fileId).toList());
        assertEquals("certificate-25.pdf", records.get(24).name());
    }

    @Test
    void askModelWithoutToolsRejectsDeferredAttachmentsAfterPersistingTheWholeSet() {
        when(models.usesProviderCatalog()).thenReturn(true);
        when(models.adaptPlatformRoute(any(), anyBoolean())).thenAnswer(inv -> inv.getArgument(0));
        when(models.effectiveModelSupportsTools(MODEL)).thenReturn(false);
        when(assembler.assemble(any(), any(), any(), any(), any(), any(), any(), any(), any(), any(), any(), any()))
                .thenAnswer(inv -> {
                    ContextTurnSink ledger = inv.getArgument(11);
                    ledger.notice(ContextTurnSink.DEFERRED, null, null, "25");
                    return context();
                });
        var request = request("ask-deferred-without-tools", 7, "en-US");
        request.setMode("ASK");

        orchestrator.handleUserMessage(request, 71L);

        assertEquals(0, modelCalls.get(), "unsupported lazy reading must not trigger a billable model request");
        assertOriginalAttachments();
        verify(messages, times(1)).recordAttachments(any(), any());
        assertEquals(AgentRunStateService.RunStatus.ERROR, runState.get(request.getConversationId()).status());
        Event error = events.stream().filter(e -> "error".equals(e.kind())).findFirst().orElseThrow();
        assertTrue(error.data().contains("ATTACHMENTS_REQUIRE_TOOLS"), error.data());
        assertTrue(error.data().contains("chat.attachmentsRequireTools"), error.data());
        assertFalse(orchestrator.setCancelled(request.getConversationId()), "terminal run must be cleared");
    }

    @Test
    void askModelWithoutToolsStillAnswersWhenAttachmentBodiesWereAlreadyPrepared() {
        when(models.usesProviderCatalog()).thenReturn(true);
        when(models.adaptPlatformRoute(any(), anyBoolean())).thenAnswer(inv -> inv.getArgument(0));
        when(models.effectiveModelSupportsTools(MODEL)).thenReturn(false);
        var request = request("ask-preloaded-without-tools", 7, "en-US");
        request.setMode("ASK");
        request.setContextItems(new ArrayList<>(request.getContextItems().subList(0, 2)));
        when(assembler.assemble(any(), any(), any(), any(), any(), any(), any(), any(), any(), any(), any(), any()))
                .thenAnswer(inv -> {
                    ContextTurnSink ledger = inv.getArgument(11);
                    for (var item : request.getContextItems()) {
                        ledger.attachment(item.getId(), item.getName(), item.getFileType(), "file", false);
                    }
                    return context();
                });

        orchestrator.handleUserMessage(request, 71L);

        assertEquals(1, modelCalls.get(), "text-only model can answer with already prepared context");
        assertEquals(AgentRunStateService.RunStatus.FINISHED, runState.get(request.getConversationId()).status());
        assertTrue(events.stream().noneMatch(e -> "error".equals(e.kind())), events.toString());
        assertEquals(2, attachments.values().iterator().next().size());
        verify(tools, never()).execute(any(), any(), any());
    }

    @Test
    void preparationTimeoutRetainsAllAttachmentsAndSealsLateCallbacks() throws Exception {
        orchestrator.attachmentPreparationTimeout = Duration.ofMillis(50);
        CountDownLatch entered = new CountDownLatch(1), release = new CountDownLatch(1), lateDone = new CountDownLatch(1);
        when(assembler.assemble(any(), any(), any(), any(), any(), any(), any(), any(), any(), any(), any(), any()))
                .thenAnswer(inv -> {
                    ContextTurnSink ledger = inv.getArgument(11);
                    assertNotNull(ledger.attachmentMessageId());
                    entered.countDown(); awaitIgnoringInterrupt(release);
                    try {
                        ledger.attachment("late", "late.pdf", "pdf", "file", false);
                        ledger.notice(ContextTurnSink.UNREADABLE, "late", "late.pdf", null);
                        return context();
                    } finally { lateDone.countDown(); }
                });
        Thread turn = start(request("preparation-timeout", 7, "en-US"), 71);
        try {
            assertTrue(entered.await(3, TimeUnit.SECONDS)); join(turn);
            assertOriginalAttachments();
            assertEquals(0, modelCalls.get());
            assertEquals(AgentRunStateService.RunStatus.ERROR, runState.get("preparation-timeout").status());
            assertFalse(orchestrator.setCancelled("preparation-timeout"), "active run must have been cleared");
            Event error = events.stream().filter(e -> e.kind().equals("error")).findFirst().orElseThrow();
            assertTrue(error.data().contains("CONTEXT_PREPARATION_TIMEOUT"), error.data());
            assertTrue(error.data().contains("chat.contextPreparationTimeout"), error.data());
            int count = events.size(); release.countDown(); assertTrue(lateDone.await(3, TimeUnit.SECONDS));
            assertEquals(count, events.size(), "late parser must not send notices after the terminal event");
            assertOriginalAttachments();
            verify(messages, times(1)).recordAttachments(any(), any());
        } finally { release.countDown(); turn.join(3_000); }
    }

    @Test
    void stoppingPreparationReturnsBeforeParserAndPreservesAttachments() throws Exception {
        orchestrator.attachmentPreparationTimeout = Duration.ofSeconds(10);
        CountDownLatch entered = new CountDownLatch(1), release = new CountDownLatch(1), readDone = new CountDownLatch(1);
        when(assembler.assemble(any(), any(), any(), any(), any(), any(), any(), any(), any(), any(), any(), any()))
                .thenAnswer(inv -> {
                    entered.countDown(); awaitIgnoringInterrupt(release);
                    try { return context(); } finally { readDone.countDown(); }
                });
        Thread turn = start(request("preparation-stop", 7, "en-US"), 71);
        try {
            assertTrue(entered.await(3, TimeUnit.SECONDS));
            long stoppedAt = System.nanoTime();
            assertTrue(orchestrator.setCancelled("preparation-stop")); join(turn);
            assertTrue(System.nanoTime() - stoppedAt < TimeUnit.SECONDS.toNanos(2));
            assertEquals(1, events.stream().filter(e -> e.kind().equals("cancelled")).count());
            assertTrue(events.stream().noneMatch(e -> e.kind().equals("error")));
            assertEquals(0, modelCalls.get()); assertOriginalAttachments();
            assertFalse(orchestrator.setCancelled("preparation-stop"));
        } finally { release.countDown(); assertTrue(readDone.await(3, TimeUnit.SECONDS)); turn.join(3_000); }
    }

    @Test
    void preparationWorkerReceivesUserLanguageAndProjectWithoutLeakingPreviousTurn() {
        String callerProject = ProjectContextHolder.getProjectId();
        List<String> observed = new CopyOnWriteArrayList<>();
        when(assembler.assemble(any(), any(), any(), any(), any(), any(), any(), any(), any(), any(), any(), any()))
                .thenAnswer(inv -> {
                    assertNull(ProjectContextHolder.getProjectId(), "worker retained another project's permission context");
                    String project = inv.getArgument(7); Long user = inv.getArgument(9);
                    assertEquals(user, PlatformAiUserScope.current());
                    // Real assemble establishes the project/user scope before reading a file.
                    ProjectContextHolder.setProjectId(project); ProjectContextHolder.setUserId(user);
                    var file = new com.checkba.model.entity.ProjectFile(); file.setId(99L); file.setProjectId(Long.valueOf(project));
                    assertNull(com.checkba.service.ai.tools.ToolFileGuard.rejectIfCannotRead(file, null));
                    observed.add(project + ":" + user + ":" + AppLanguageScope.current());
                    return context();
                });
        orchestrator.handleUserMessage(request("scope-a", 7, "en-US"), 71L);
        orchestrator.handleUserMessage(request("scope-b", 8, "zh-CN"), 81L);
        assertEquals(List.of("7:71:en-US", "8:81:zh-CN"), observed);
        assertEquals(2, modelCalls.get());
        assertNull(PlatformAiUserScope.current()); assertNull(AppLanguageScope.current());
        assertEquals(callerProject, ProjectContextHolder.getProjectId(), "worker must not alter the caller's scope");
        assertEquals(AgentRunStateService.RunStatus.FINISHED, runState.get("scope-b").status());
    }

    @Test
    void stalledFileReadPreservesEarlierToolResultAndDoesNotRequestAnotherModelTurn() throws Exception {
        orchestrator.attachmentReadTimeout = Duration.ofMillis(50);
        asynchronousModelCallbacks = true;
        modelScript.set(List.of(AiMessage.from(List.of(
                ToolExecutionRequest.builder().id("one").name("extract_file_text").arguments("{\"fileId\":1}").build(),
                ToolExecutionRequest.builder().id("two").name("extract_file_text").arguments("{\"fileId\":2}").build())),
                AiMessage.from("<final>must not run</final>")));
        CountDownLatch entered = new CountDownLatch(1), release = new CountDownLatch(1), lateDone = new CountDownLatch(1);
        AtomicInteger reads = new AtomicInteger();
        when(tools.execute(eq("extract_file_text"), anyString(), any())).thenAnswer(inv -> {
            ToolContext context = inv.getArgument(2);
            assertEquals(7L, context.projectId()); assertEquals(71L, context.userId());
            assertEquals(71L, PlatformAiUserScope.current());
            assertEquals("en-US", AppLanguageScope.current());
            if (reads.incrementAndGet() == 1) return new ToolRegistry.ToolResult("CERTIFICATE_ONE_COMPLETE", null, true);
            entered.countDown(); awaitIgnoringInterrupt(release);
            try { return new ToolRegistry.ToolResult("LATE_SECOND_CERTIFICATE", null, true); }
            finally { lateDone.countDown(); }
        });
        Thread turn = start(request("file-timeout", 7, "en-US"), 71);
        try {
            assertTrue(entered.await(3, TimeUnit.SECONDS)); join(turn);
            assertEquals(1, modelCalls.get()); assertEquals(2, reads.get());
            assertEquals(AgentRunStateService.RunStatus.ERROR, runState.get("file-timeout").status());
            assertTrue(String.join("\n", saved).contains("CERTIFICATE_ONE_COMPLETE"), saved.toString());
            assertTrue(events.stream().anyMatch(e -> e.kind().equals("error") && e.data().contains("CONTEXT_PREPARATION_TIMEOUT")));
            assertFalse(orchestrator.setCancelled("file-timeout"));
            int eventCount = events.size(); release.countDown(); assertTrue(lateDone.await(3, TimeUnit.SECONDS));
            assertEquals(eventCount, events.size());
            assertFalse(String.join("\n", saved).contains("LATE_SECOND_CERTIFICATE"));
        } finally { release.countDown(); turn.join(3_000); }
    }
}
