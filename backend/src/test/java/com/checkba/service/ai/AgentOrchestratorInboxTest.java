// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ai;

import com.checkba.config.AiContextProperties;
import com.checkba.config.AiFailoverProperties;
import com.checkba.controller.ai.AiAgentController;
import com.checkba.model.entity.AgentInboxItem;
import com.checkba.model.entity.ProjectAiMessage;
import com.checkba.repository.AgentInboxItemRepository;
import com.checkba.service.ProjectAiMessageService;
import com.checkba.service.ProjectFileService;
import com.checkba.service.ai.context.ContextCompressor;
import com.checkba.service.ai.context.RunLoopCompactor;
import com.checkba.service.ai.memory.MemoryPipelineService;
import com.checkba.service.ai.skill.SkillRouter;
import dev.langchain4j.agent.tool.ToolExecutionRequest;
import dev.langchain4j.agent.tool.ToolSpecification;
import dev.langchain4j.data.message.*;
import dev.langchain4j.model.StreamingResponseHandler;
import dev.langchain4j.model.chat.StreamingChatLanguageModel;
import dev.langchain4j.model.output.Response;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class AgentOrchestratorInboxTest {
    private static final String CONV = "conv-inbox";
    private static final String MODEL = "qwen/qwen3.7-flash";

    private final Map<String, AgentInboxItem> rows = new ConcurrentHashMap<>();
    private final List<List<ChatMessage>> modelRequests = new CopyOnWriteArrayList<>();
    private final List<List<String>> modelToolNames = new CopyOnWriteArrayList<>();
    private final List<String> sseEvents = new CopyOnWriteArrayList<>();
    private AgentInboxService inbox;
    private AgentOrchestrator orchestrator;
    private ChatModelFactory modelFactory;
    private ToolRegistry tools;
    private ContextAssemblerService assembler;
    private ProjectAiMessageService messageService;
    private XmlToolCallParser xml;
    private com.checkba.service.ProjectMemberService members;
    private SseEmitterService sse;
    private AgentRunStateService runState;
    private AgentInboxItemRepository repository;
    private SkillRouter skills;

    @BeforeEach
    void setUp() {
        rows.clear();
        modelRequests.clear();
        sseEvents.clear();
        AgentInboxItemRepository repo = inMemoryRepository();
        repository = repo;
        sse = mock(SseEmitterService.class);
        doAnswer(inv -> {
            Object payload = inv.getArgument(2);
            sseEvents.add(inv.getArgument(1, String.class) + ":" + String.valueOf(payload));
            return null;
        })
                .when(sse).send(any(), any(), any());
        // 关流也记进同一条时间线：自动接续的那一轮必须在一条还开着的流上发事件
        doAnswer(inv -> {
            sseEvents.add("close:" + inv.getArgument(0, String.class));
            return null;
        }).when(sse).close(any(), anyLong());
        runState = mock(AgentRunStateService.class);
        inbox = new AgentInboxService(repo, sse, runState);

        modelFactory = mock(ChatModelFactory.class);
        messageService = mock(ProjectAiMessageService.class);
        // dev-board#729 ⑤：编排器改用 countByConversationId 判首轮；mock 默认回 0 会误判首轮、起异步标题线程
        // 与下一次 when(...) 打架（CI 上 Mockito WrongTypeOfReturnValue）。计数跟随 list 桩，保持各用例原语义。
        when(messageService.countByConversationId(any())).thenAnswer(inv -> (long) messageService.listByConversationId(inv.getArgument(0)).size());
        when(messageService.listByConversationId(any()))
                .thenReturn(List.of(mock(ProjectAiMessage.class), mock(ProjectAiMessage.class)));
        AtomicInteger assistantIds = new AtomicInteger();
        when(messageService.upsertAssistantMessage(any(), any(), any(), any(), any()))
                .thenAnswer(inv -> inv.getArgument(3) != null ? inv.getArgument(3) : (long) assistantIds.incrementAndGet());

        assembler = mock(ContextAssemblerService.class);
        doAnswer(inv -> {
            String prompt = inv.getArgument(2);
            return new ArrayList<ChatMessage>(List.of(SystemMessage.from("system"),
                    UserMessage.from(prompt == null ? "original" : prompt)));
        }).when(assembler).assemble(any(), any(), any(), any(), any(), any(), any(), any(), any(), any(), any(), any());

        tools = mock(ToolRegistry.class);
        when(tools.getAllSpecifications(any(), any())).thenReturn(List.of());
        when(tools.resolve(anyString())).thenReturn(Optional.empty());
        skills = mock(SkillRouter.class);
        when(skills.visibleTools(any(), any())).thenAnswer(inv -> inv.getArgument(1));
        when(skills.activeSkill(any())).thenReturn(Optional.empty());
        xml = mock(XmlToolCallParser.class);
        when(xml.containsToolCall(any())).thenReturn(false);
        members = mock(com.checkba.service.ProjectMemberService.class);
        when(members.hasReadPermission(42L, 7L)).thenReturn(true);
        orchestrator = newProcess();
    }

    private AgentOrchestrator newProcess() {
        AiContextProperties props = new AiContextProperties();
        AgentOrchestrator created = new AgentOrchestrator(
                modelFactory, messageService, sse, mock(TokenUsageService.class), assembler,
                tools, skills, xml, mock(MemoryPipelineService.class), mock(ProjectFileService.class),
                mock(EditorBridgeService.class), mock(ConversationFileChangeService.class),
                mock(TodoListService.class), mock(DocumentCheckpointService.class), runState,
                mock(com.checkba.version.WorkSessionService.class), new AiFailoverProperties(),
                new RunLoopCompactor(props, new ContextCompressor(null, null, props)),
                mock(com.checkba.service.telemetry.TelemetryService.class),
                mock(com.checkba.service.telemetry.TelemetryTurnTracker.class),
                mock(com.checkba.service.telemetry.MatterClassifierService.class), new OfficePassStateStore());
        created.setInboxService(inbox);
        org.springframework.test.util.ReflectionTestUtils.setField(created, "projectMemberService", members);
        return created;
    }

    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.CsvSource({"client,queue", "client,steer", "removed,queue", "removed,steer"})
    void permissionPatchSteerRejectsOldOwnerBeforeEditing(String change, String mode) {
        var item = inbox.submit(request("old instruction", "old", mode), 7L);
        revokeExecution(change);
        when(modelFactory.getStreamingChatModel(MODEL)).thenReturn(scripted(AiMessage.from("must not run")));
        when(messageService.canUseConversation(CONV, 7L)).thenReturn(true);
        var controller = new com.checkba.controller.ai.AgentInboxController(inbox, messageService, orchestrator);
        try (var auth = mockStatic(com.checkba.controller.AuthController.class)) {
            auth.when(() -> com.checkba.controller.AuthController.getUserIdFromSession("owner")).thenReturn(7L);
            var edit = new com.checkba.controller.ai.AgentInboxController.EditRequest();
            edit.submissionMode = "steer";
            edit.expectedRevision = item.getRevision();
            assertEquals(403, controller.edit(CONV, item.getId(), edit, "owner").getStatusCode().value());
            assertEquals(1L, item.getRevision());
            assertEquals(mode, item.getSubmissionMode());
            assertEquals(AgentInboxService.PENDING, item.getState());
            assertTrue(modelRequests.isEmpty());
            verifyNoInteractions(assembler);
        }
    }

    @Test
    void restoredOfficeInboxReRegistersCapabilityBeforeLaunching() {
        var caps = new ClientCapabilityService();
        org.springframework.test.util.ReflectionTestUtils.setField(orchestrator, "clientCapabilities", caps);
        var input = request("resume office", "restored-office", "steer");
        input.setClientCapability("office");
        input.setOfficeHost("excel");
        var item = inbox.submit(input, 7L);
        inbox = new AgentInboxService(repository, sse, runState);
        orchestrator.setInboxService(inbox);
        var tasks = new ArrayList<Runnable>();
        orchestrator.setTurnExecutor(tasks::add);
        orchestrator.acceptInboxSubmission(item.getId());
        assertEquals(ClientCapabilityService.Capability.OFFICE, caps.capabilityOf(CONV));
        assertEquals(ClientCapabilityService.OfficeHost.EXCEL, caps.officeHostOf(CONV));
        assertEquals(1, tasks.size());
    }

    @Test
    void missingTransientBodyCannotLeaveAnActiveRunOrCallModel() {
        var input = request("review", "body-missing", "steer");
        var context = new AiAgentController.ContextItem();
        context.setInlineContent("PRIVATE BODY");
        input.setActiveContext(context);
        var item = inbox.submit(input, 7L);
        inbox = new AgentInboxService(repository, sse, runState);
        orchestrator.setInboxService(inbox);
        assertThrows(AgentInboxService.InlineContentUnavailable.class,
                () -> orchestrator.acceptInboxSubmission(item.getId()));
        assertNull(orchestrator.activeRunId(CONV));
        assertEquals(AgentInboxService.PENDING, item.getState());
        verifyNoInteractions(assembler);
        assertTrue(modelRequests.isEmpty());
        var queued = new ArrayList<Runnable>();
        orchestrator.setTurnExecutor(queued::add);
        var retried = inbox.submit(input, 7L);
        assertEquals(item.getId(), retried.getId());
        assertNotNull(orchestrator.acceptInboxSubmission(retried.getId()));
        assertEquals(1, queued.size(), "full-body retry of the same unexecuted input must launch once");
        assertEquals(AgentInboxService.APPLIED, retried.getState());
    }

    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.ValueSource(strings = {"client", "removed"})
    void permissionRestoredPendingInboxRechecksBeforeClaim(String change) {
        var item = inbox.submit(request("restored old instruction", "restored", "steer"), 7L);
        // New service instance, same durable repository: no old in-memory admission survives.
        inbox = new AgentInboxService(repository, sse, runState);
        orchestrator.setInboxService(inbox);
        revokeExecution(change);
        when(modelFactory.getStreamingChatModel(MODEL)).thenReturn(scripted(AiMessage.from("must not run")));
        assertThrows(SecurityException.class, () -> orchestrator.acceptInboxSubmission(item.getId()));
        assertEquals(AgentInboxService.PENDING, item.getState());
        assertNull(orchestrator.activeRunId(CONV));
        assertTrue(modelRequests.isEmpty());
        verifyNoInteractions(assembler);
    }

    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.ValueSource(strings = {"client", "removed"})
    void permissionExecutorRechecksAfterAdmissionBeforeAnyContextOrModel(String change) {
        var tasks = new ArrayList<Runnable>();
        orchestrator.setTurnExecutor(tasks::add);
        when(modelFactory.getStreamingChatModel(MODEL)).thenReturn(scripted(AiMessage.from("must not run")));
        var item = inbox.submit(request("waiting for executor", "executor", "steer"), 7L);
        orchestrator.acceptInboxSubmission(item.getId());
        assertEquals(1, tasks.size());
        revokeExecution(change);
        tasks.get(0).run();
        assertTrue(modelRequests.isEmpty());
        verifyNoInteractions(assembler);
        assertEquals(AgentInboxService.INTERRUPTED, item.getState());
        assertNull(orchestrator.activeRunId(CONV));
        assertTrue(sseEvents.stream().anyMatch(e -> e.startsWith("error:")));
    }

    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.CsvSource({"client,queue", "removed,queue", "client,steer", "removed,steer"})
    void permissionQueueDrainAndSteeringRecheckAtExecutionBoundary(String change, String mode) throws Exception {
        CountDownLatch entered = new CountDownLatch(1), release = new CountDownLatch(1);
        when(tools.execute(eq("read"), any(), any())).thenAnswer(inv -> {
            entered.countDown();
            assertTrue(release.await(5, TimeUnit.SECONDS));
            return new ToolRegistry.ToolResult("done", null, true);
        });
        when(modelFactory.getStreamingChatModel(MODEL)).thenReturn(scripted(
                "steer".equals(mode) ? AiMessage.from(List.of(tool("read", "r1"))) : AiMessage.from("done"),
                AiMessage.from("unauthorized follow-up")));
        if ("queue".equals(mode)) {
            doAnswer(inv -> { entered.countDown(); await(release); return null; })
                    .when(runState).mark(eq(CONV), eq(AgentRunStateService.RunStatus.FINISHED));
        }
        var first = inbox.submit(request("initial authorized turn", "first-permission", "steer"), 7L);
        Thread run = new Thread(() -> orchestrator.acceptInboxSubmission(first.getId()));
        run.start();
        assertTrue(entered.await(5, TimeUnit.SECONDS));
        var pending = inbox.submit(request("old follow-up", "pending-permission", mode), 7L);
        revokeExecution(change);
        release.countDown();
        run.join(5000);
        assertFalse(run.isAlive());
        assertEquals(1, modelRequests.size(), "revoked pending input must not reach another model call");
        assertEquals(AgentInboxService.PENDING, pending.getState());
        verify(messageService, never()).saveMessage(any(), any(), eq(CONV), eq("USER"), eq("old follow-up"), any(), any());
        assertNull(orchestrator.activeRunId(CONV));
    }

    @Test
    void permissionRestoredAuthorizedMemberStillRunsAndProjectlessInputStaysDenied() {
        var item = inbox.submit(request("allowed after restore", "allowed", "steer"), 7L);
        inbox = new AgentInboxService(repository, sse, runState);
        orchestrator.setInboxService(inbox);
        when(modelFactory.getStreamingChatModel(MODEL)).thenReturn(scripted(AiMessage.from("done")));
        orchestrator.acceptInboxSubmission(item.getId());
        assertEquals(1, modelRequests.size());
        var personal = request("no project", "personal", "steer");
        personal.setProjectId(null);
        var noProject = inbox.submit(personal, 7L);
        assertThrows(SecurityException.class, () -> orchestrator.acceptInboxSubmission(noProject.getId()));
        assertEquals(1, modelRequests.size());
        assertEquals(AgentInboxService.PENDING, noProject.getState());
    }

    private void revokeExecution(String change) {
        if ("client".equals(change)) when(members.isClient(42L, 7L)).thenReturn(true);
        else when(members.hasReadPermission(42L, 7L)).thenReturn(false);
    }

    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.ValueSource(strings = {"other-user", "other-project"})
    void permissionMixedSteeringBatchIsInterruptedBeforeItsTextIsApplied(String kind) throws Exception {
        CountDownLatch entered = new CountDownLatch(1), release = new CountDownLatch(1);
        when(tools.execute(eq("read"), any(), any())).thenAnswer(inv -> {
            entered.countDown();
            assertTrue(release.await(5, TimeUnit.SECONDS));
            return new ToolRegistry.ToolResult("done", null, true);
        });
        when(modelFactory.getStreamingChatModel(MODEL)).thenReturn(scripted(
                AiMessage.from(List.of(tool("read", "mixed-read"))), AiMessage.from("must not run")));
        var first = inbox.submit(request("initial authorized turn", "mixed-first", "steer"), 7L);
        Thread run = new Thread(() -> orchestrator.acceptInboxSubmission(first.getId()));
        run.start();
        assertTrue(entered.await(5, TimeUnit.SECONDS));
        var next = request("mismatched durable instruction", "mixed-pending", "steer");
        if ("other-project".equals(kind)) next.setProjectId(99L);
        // Both identities/projects are individually staff-authorized: they still cannot be
        // silently executed in the original run's project/user scope.
        when(members.hasReadPermission(99L, 7L)).thenReturn(true);
        when(members.hasReadPermission(42L, 8L)).thenReturn(true);
        var mixed = inbox.submit(next, "other-user".equals(kind) ? 8L : 7L);
        release.countDown(); run.join(5000);
        assertFalse(run.isAlive());
        assertEquals(1, modelRequests.size());
        assertEquals(AgentInboxService.INTERRUPTED, mixed.getState());
        assertEquals(AgentInboxService.INTERRUPTED, first.getState());
        verify(messageService, never()).saveMessage(any(), any(), eq(CONV), eq("USER"), eq(next.getMessage()), any(), any());
        assertNull(orchestrator.activeRunId(CONV));
    }

    @Test
    void steerDuringFirstToolIsAppliedOnceAndSkipsPendingWriteWithNativePairing() throws Exception {
        CountDownLatch toolEntered = new CountDownLatch(1);
        CountDownLatch releaseTool = new CountDownLatch(1);
        when(tools.execute(eq("read"), any(), any())).thenAnswer(inv -> {
            toolEntered.countDown();
            assertTrue(releaseTool.await(5, TimeUnit.SECONDS));
            return new ToolRegistry.ToolResult("read-result", null, true);
        });
        when(tools.execute(eq("write"), any(), any()))
                .thenReturn(new ToolRegistry.ToolResult("written", null, true));

        StreamingChatLanguageModel model = scripted(
                AiMessage.from(List.of(tool("read", "r1"), tool("write", "w1"))),
                AiMessage.from("done after steer"));
        when(modelFactory.getStreamingChatModel(MODEL)).thenReturn(model);

        AgentInboxItem initial = inbox.submit(request("original", "initial", "steer"), 7L);
        Thread run = new Thread(() -> orchestrator.acceptInboxSubmission(initial.getId(), false));
        run.start();
        assertTrue(toolEntered.await(5, TimeUnit.SECONDS));

        AgentInboxItem steer = inbox.submit(request("change direction", "steer-key", "steer"), 7L);
        AgentInboxItem duplicate = inbox.submit(request("duplicate text", "steer-key", "steer"), 7L);
        assertEquals(steer.getId(), duplicate.getId());
        assertEquals(orchestrator.activeRunId(CONV), orchestrator.acceptInboxSubmission(duplicate.getId()));

        releaseTool.countDown();
        run.join(5000);
        assertFalse(run.isAlive());

        verify(tools, never()).execute(eq("write"), any(), any());
        assertEquals(2, rows.size());
        assertEquals(AgentInboxService.APPLIED, rows.get(steer.getId()).getState());
        assertEquals(rows.get(initial.getId()).getRunId(), rows.get(steer.getId()).getRunId());
        assertEquals(2, modelRequests.size());
        List<ChatMessage> next = modelRequests.get(1);
        assertEquals(1, next.stream().filter(m -> text(m).contains("change direction")).count());
        assertTrue(next.stream().filter(m -> m instanceof ToolExecutionResultMessage)
                .anyMatch(m -> text(m).contains("superseded")), "skipped native write must have a paired result");
        // 两条 USER 行都要带着 clientRequestId 落库：它是「回退到这条消息」唯一在
        // 消息落库前就存在的定位键（dev-board#779 K1）。插话进来的那条同样要有——
        // 运行中发出的消息最可能被用户回过头来改。
        verify(messageService).saveMessage(any(), any(), eq(CONV), eq("USER"), eq("original"), any(), eq("initial"));
        verify(messageService).saveMessage(any(), any(), eq(CONV), eq("USER"), eq("change direction"), any(), eq("steer-key"));
    }

    @Test
    void steeringAttachmentIsAugmentedIntoTheNextModelRequest() throws Exception {
        CountDownLatch toolEntered = new CountDownLatch(1);
        CountDownLatch releaseTool = new CountDownLatch(1);
        when(tools.execute(eq("read"), any(), any())).thenAnswer(inv -> {
            toolEntered.countDown();
            releaseTool.await(5, TimeUnit.SECONDS);
            return new ToolRegistry.ToolResult("ok", null, true);
        });
        doAnswer(inv -> {
                    List<?> contexts = inv.getArgument(3);
                    String text = contexts != null && !contexts.isEmpty()
                            ? "AUGMENTED_ATTACHMENT:88" : inv.getArgument(2, String.class);
                    return new ArrayList<ChatMessage>(List.of(SystemMessage.from("system"),
                            UserMessage.from(text == null ? "original" : text)));
                }).when(assembler).assemble(any(), any(), any(), any(), any(), any(), any(), any(), any(), any(), any(), any());
        when(modelFactory.getStreamingChatModel(MODEL)).thenReturn(scripted(
                AiMessage.from(List.of(tool("read", "r1"))), AiMessage.from("done")));

        AgentInboxItem first = inbox.submit(request("original", "i", "steer"), 7L);
        Thread run = new Thread(() -> orchestrator.acceptInboxSubmission(first.getId(), false));
        run.start();
        assertTrue(toolEntered.await(5, TimeUnit.SECONDS));
        AiAgentController.AgentChatRequest steerRequest = request("use attached contract", "attachment", "steer");
        AiAgentController.ContextItem context = new AiAgentController.ContextItem();
        context.setId("88");
        context.setName("contract.docx");
        steerRequest.setContextItems(List.of(context));
        inbox.submit(steerRequest, 7L);
        releaseTool.countDown();
        run.join(5000);

        assertTrue(modelRequests.get(1).stream().anyMatch(m -> text(m).contains("AUGMENTED_ATTACHMENT:88")));
    }

    @Test
    void steerBetweenXmlToolsCancelsTheRemainingCallAndPreservesFeedback() throws Exception {
        CountDownLatch toolEntered = new CountDownLatch(1);
        CountDownLatch releaseTool = new CountDownLatch(1);
        when(tools.execute(eq("read"), any(), any())).thenAnswer(inv -> {
            toolEntered.countDown();
            assertTrue(releaseTool.await(5, TimeUnit.SECONDS));
            return new ToolRegistry.ToolResult("read-result", null, true);
        });
        when(tools.execute(eq("write"), any(), any()))
                .thenReturn(new ToolRegistry.ToolResult("written", null, true));
        when(xml.containsToolCall(anyString()))
                .thenAnswer(inv -> inv.getArgument(0, String.class).contains("<tool_code>"));
        when(xml.extractProcessName(anyString())).thenReturn(Optional.empty());
        when(xml.parse(anyString())).thenReturn(List.of(
                new XmlToolCallParser.ParsedCall("read", "{}", "read()"),
                new XmlToolCallParser.ParsedCall("write", "{}", "write()")));
        when(modelFactory.getStreamingChatModel(MODEL)).thenReturn(scripted(
                AiMessage.from("<tool_code>read()</tool_code><tool_code>write()</tool_code>"),
                AiMessage.from("done after XML steer")));

        AgentInboxItem first = inbox.submit(request("original", "xml-first", "steer"), 7L);
        Thread run = new Thread(() -> orchestrator.acceptInboxSubmission(first.getId(), false));
        run.start();
        assertTrue(toolEntered.await(5, TimeUnit.SECONDS));
        AgentInboxItem steer = inbox.submit(request("change XML direction", "xml-steer", "steer"), 7L);
        releaseTool.countDown();
        run.join(5000);

        assertFalse(run.isAlive());
        verify(tools, never()).execute(eq("write"), any(), any());
        assertEquals(AgentInboxService.APPLIED, rows.get(steer.getId()).getState());
        List<ChatMessage> next = modelRequests.get(1);
        assertTrue(next.stream().anyMatch(m -> text(m).contains("change XML direction")));
        assertTrue(next.stream().anyMatch(m -> text(m).contains("Status: CANCELLED")),
                "skipped XML tool must leave cancellation feedback in the model stack");
    }

    @Test
    void queuedInputRacingWithFinalizationStartsExactlyOnce() throws Exception {
        CountDownLatch finalReady = new CountDownLatch(1);
        CountDownLatch releaseFinal = new CountDownLatch(1);
        AtomicInteger calls = new AtomicInteger();
        StreamingChatLanguageModel model = new StreamingChatLanguageModel() {
            @Override public void generate(List<ChatMessage> messages, StreamingResponseHandler<AiMessage> handler) {
                complete(messages, handler);
            }
            @Override public void generate(List<ChatMessage> messages, List<ToolSpecification> specifications,
                                           StreamingResponseHandler<AiMessage> handler) {
                complete(messages, handler);
            }
            private void complete(List<ChatMessage> messages, StreamingResponseHandler<AiMessage> handler) {
                modelRequests.add(new ArrayList<>(messages));
                if (calls.incrementAndGet() == 1) {
                    finalReady.countDown();
                    await(releaseFinal);
                    handler.onNext("first done");
                    handler.onComplete(Response.from(AiMessage.from("first done")));
                } else {
                    handler.onNext("queued done");
                    handler.onComplete(Response.from(AiMessage.from("queued done")));
                }
            }
        };
        when(modelFactory.getStreamingChatModel(MODEL)).thenReturn(model);

        AgentInboxItem first = inbox.submit(request("first", "first", "steer"), 7L);
        Thread run = new Thread(() -> orchestrator.acceptInboxSubmission(first.getId(), false));
        run.start();
        assertTrue(finalReady.await(5, TimeUnit.SECONDS));
        AgentInboxItem queued = inbox.submit(request("follow-up", "q", "queue"), 7L);
        assertEquals(AgentInboxService.PENDING, rows.get(queued.getId()).getState());
        releaseFinal.countDown();
        run.join(5000);

        assertEquals(2, calls.get());
        assertEquals(AgentInboxService.APPLIED, rows.get(queued.getId()).getState());
        assertNotEquals(rows.get(first.getId()).getRunId(), rows.get(queued.getId()).getRunId());
        assertEquals(1, modelRequests.stream()
                .filter(stack -> stack.stream().anyMatch(m -> text(m).contains("follow-up"))).count());
        assertNull(orchestrator.activeRunId(CONV));
        assertTrue(sseEvents.stream().noneMatch(e -> e.startsWith("input_applied:") && e.contains(first.getId())),
                "originating POST must not emit input_applied");
        int snapshotIndex = indexOfEvent("inbox_updated", rows.get(queued.getId()).getRunId());
        int appliedIndex = indexOfEvent("input_applied", queued.getId());
        assertTrue(snapshotIndex >= 0 && appliedIndex > snapshotIndex,
                "new-run snapshot must precede applied event: " + sseEvents);
    }

    /**
     * v0.38.3 走查 D3：一轮正常结束、队列里还有待处理条目时，收尾曾经先关流再接续下一条——
     * 接续那一轮的 inbox_updated / input_applied / 正文全部发进一个已经没有 emitter 的会话，
     * 前端既没有新气泡也没有停止键，已执行的条目一直挂在「待处理」里。
     * 还有下一条要跑时不许关流；关流只发生在队列真正跑空之后。
     */
    @Test
    void finishingWithQueuedFollowUpKeepsTheStreamOpenForTheContinuedRun() throws Exception {
        AtomicInteger calls = new AtomicInteger();
        CountDownLatch firstReady = new CountDownLatch(1);
        CountDownLatch releaseFirst = new CountDownLatch(1);
        StreamingChatLanguageModel model = new StreamingChatLanguageModel() {
            @Override public void generate(List<ChatMessage> messages, StreamingResponseHandler<AiMessage> handler) {
                complete(handler);
            }
            @Override public void generate(List<ChatMessage> messages, List<ToolSpecification> specifications,
                                           StreamingResponseHandler<AiMessage> handler) {
                complete(handler);
            }
            private void complete(StreamingResponseHandler<AiMessage> handler) {
                if (calls.incrementAndGet() == 1) {
                    firstReady.countDown();
                    await(releaseFirst);
                }
                handler.onNext("done " + calls.get());
                handler.onComplete(Response.from(AiMessage.from("done " + calls.get())));
            }
        };
        when(modelFactory.getStreamingChatModel(MODEL)).thenReturn(model);

        AgentInboxItem first = inbox.submit(request("first", "keep-open-first", "steer"), 7L);
        Thread run = new Thread(() -> orchestrator.acceptInboxSubmission(first.getId(), false));
        run.start();
        assertTrue(firstReady.await(5, TimeUnit.SECONDS));
        AgentInboxItem queued = inbox.submit(request("follow-up", "keep-open-queued", "queue"), 7L);
        releaseFirst.countDown();
        run.join(5000);

        assertEquals(2, calls.get());
        int appliedIndex = indexOfEvent("input_applied", queued.getId());
        int firstClose = -1;
        for (int i = 0; i < sseEvents.size(); i++) {
            if (sseEvents.get(i).startsWith("close:")) { firstClose = i; break; }
        }
        assertTrue(appliedIndex >= 0, "queued run must emit input_applied: " + sseEvents);
        assertTrue(firstClose > appliedIndex,
                "stream was closed before the continued run started emitting: " + sseEvents);
        assertEquals(1, sseEvents.stream().filter(e -> e.startsWith("close:")).count(),
                "the stream closes once, after the queue drains: " + sseEvents);
    }

    @Test
    void cancellationPausesQueuedFollowUpInsteadOfAutoDrainingIt() throws Exception {
        CountDownLatch toolEntered = new CountDownLatch(1);
        CountDownLatch releaseTool = new CountDownLatch(1);
        when(tools.execute(eq("read"), any(), any())).thenAnswer(inv -> {
            toolEntered.countDown();
            assertTrue(releaseTool.await(5, TimeUnit.SECONDS));
            return new ToolRegistry.ToolResult("read-result", null, true);
        });
        AtomicInteger calls = new AtomicInteger();
        StreamingChatLanguageModel delegate = scripted(
                AiMessage.from(List.of(tool("read", "r1"))), AiMessage.from("should not be reached"));
        StreamingChatLanguageModel model = new StreamingChatLanguageModel() {
            @Override public void generate(List<ChatMessage> messages, StreamingResponseHandler<AiMessage> handler) {
                calls.incrementAndGet();
                delegate.generate(messages, handler);
            }
            @Override public void generate(List<ChatMessage> messages, List<ToolSpecification> specifications,
                                           StreamingResponseHandler<AiMessage> handler) {
                calls.incrementAndGet();
                delegate.generate(messages, specifications, handler);
            }
        };
        when(modelFactory.getStreamingChatModel(MODEL)).thenReturn(model);

        AgentInboxItem first = inbox.submit(request("first", "cancel-first", "steer"), 7L);
        Thread run = new Thread(() -> orchestrator.acceptInboxSubmission(first.getId(), false));
        run.start();
        assertTrue(toolEntered.await(5, TimeUnit.SECONDS));
        AgentInboxItem queued = inbox.submit(request("later", "cancel-queued", "queue"), 7L);
        orchestrator.setCancelled(CONV);
        releaseTool.countDown();
        run.join(5000);

        assertFalse(run.isAlive());
        assertEquals(1, calls.get());
        assertEquals(AgentInboxService.PENDING, rows.get(queued.getId()).getState());
        assertNull(orchestrator.activeRunId(CONV));

        String cancelledRunId = rows.get(first.getId()).getRunId();
        inbox.edit(CONV, queued.getId(), null, AgentInboxService.STEER, null, queued.getRevision());
        orchestrator.acceptInboxSubmission(queued.getId());
        assertEquals(2, calls.get());
        assertEquals(AgentInboxService.APPLIED, rows.get(queued.getId()).getState());
        assertNotEquals(cancelledRunId, rows.get(queued.getId()).getRunId());
        assertNull(orchestrator.activeRunId(CONV));
    }

    private ToolDecisionPolicy installDecision() {
        var policy = mock(ToolDecisionPolicy.class);
        org.springframework.test.util.ReflectionTestUtils.setField(orchestrator, "toolDecisionPolicy", policy);
        orchestrator.setToolDisclosurePolicy(new ToolDisclosurePolicy(false));
        when(modelFactory.resolveTarget(any(), eq(false))).thenReturn(new ChatModelFactory.ResolvedTarget(
                com.checkba.config.AiModelProperties.Provider.OPENROUTER, MODEL));
        var specs = List.of("extract_file_text", "read_file", "doc_set_font", "doc_accept_revision", "memory_search")
                .stream().map(n -> ToolSpecification.builder().name(n).description(n).build()).toList();
        when(tools.getAllSpecifications(any(), any())).thenReturn(specs);
        var catalog = ToolSpecification.builder().name("list_tools").description("catalog").build();
        when(tools.resolve(eq("list_tools"), eq(CONV))).thenReturn(Optional.of(
                new ToolRegistry.RegisteredTool(null, null, catalog, null, false)));
        when(tools.execute(any(), any(), any())).thenReturn(new ToolRegistry.ToolResult("ok", null, true));
        return policy;
    }

    @Test void decisionOffAndAskKeepOriginalPathWithoutCalls() {
        var decision = installDecision();
        when(modelFactory.getStreamingChatModel(MODEL)).thenReturn(scripted(AiMessage.from("done")));
        orchestrator.handleUserMessage(request("off", "off", "steer"), 7L);
        var ask = request("ask", "ask", "steer");
        ask.setDecisionAssistEnabled(true);
        ask.setMode("ASK");
        orchestrator.handleUserMessage(ask, 7L);
        verifyNoInteractions(decision);
        assertTrue(modelToolNames.get(0).contains("doc_set_font"));
        assertFalse(modelToolNames.get(0).contains("list_tools"));
    }

    @Test void decisionFallbackKeepsAllToolsAndDoesNotRetryNextRound() {
        var decision = installDecision();
        when(decision.select(any(), any(), any())).thenReturn(Optional.empty());
        when(modelFactory.getStreamingChatModel(MODEL)).thenReturn(scripted(
                AiMessage.from(List.of(tool("extract_file_text", "read"))), AiMessage.from("done")));
        var request = request("synthetic original input", "fallback", "steer");
        request.setDecisionAssistEnabled(true);
        orchestrator.handleUserMessage(request, 7L);
        assertEquals(2, modelToolNames.size());
        assertEquals(modelToolNames.get(0), modelToolNames.get(1));
        assertTrue(modelToolNames.get(0).contains("doc_set_font"));
        verify(decision, times(1)).select(any(), eq("synthetic original input"), any());
    }

    @Test void optedInDecisionKeepsCatalogMemoryAndMonotonicallyExpandsCategories() {
        var decision = installDecision();
        when(decision.select(any(), any(), any())).thenReturn(Optional.of("files"));
        var expand = ToolExecutionRequest.builder().name("list_tools").id("expand")
                .arguments("{\"category\":\"format\"}").build();
        when(modelFactory.getStreamingChatModel(MODEL)).thenReturn(scripted(
                AiMessage.from(List.of(expand)), AiMessage.from("done")));
        var request = request("synthetic original input", "enabled", "steer");
        request.setDecisionAssistEnabled(true);
        orchestrator.handleUserMessage(request, 7L);
        assertEquals(2, modelToolNames.size());
        assertTrue(modelToolNames.get(0).containsAll(List.of("extract_file_text", "read_file", "memory_search", "list_tools")));
        assertFalse(modelToolNames.get(0).contains("doc_set_font"));
        assertTrue(modelToolNames.get(1).containsAll(modelToolNames.get(0)));
        assertTrue(modelToolNames.get(1).contains("doc_set_font"));
        verify(decision, times(1)).select(any(), eq("synthetic original input"), any());
        verify(modelFactory, times(3)).getStreamingChatModel(MODEL); // initial selection + two paid rounds
    }

    @Test void cancelledDecisionCannotStartMainGenerationOrAffectNextRun() throws Exception {
        var decision = installDecision();
        CountDownLatch entered = new CountDownLatch(1), release = new CountDownLatch(1);
        var context = new java.util.concurrent.atomic.AtomicReference<DecisionAssistContext>();
        when(decision.select(any(), any(), any())).thenAnswer(inv -> {
            context.set(inv.getArgument(0)); entered.countDown(); await(release); return Optional.of("files");
        });
        when(modelFactory.getStreamingChatModel(MODEL)).thenReturn(scripted(AiMessage.from("done")));
        var request = request("old", "old", "steer"); request.setDecisionAssistEnabled(true);
        var thread = new Thread(() -> orchestrator.handleUserMessage(request, 7L)); thread.start();
        assertTrue(entered.await(5, TimeUnit.SECONDS));
        orchestrator.setCancelled(CONV);
        assertTrue(context.get().isCancelled());
        release.countDown(); thread.join(5000);
        assertFalse(thread.isAlive());
        assertTrue(modelRequests.isEmpty());
        orchestrator.handleUserMessage(request("new off", "new", "steer"), 7L);
        assertEquals(1, modelRequests.size());
        assertTrue(modelToolNames.get(0).contains("doc_set_font"));
    }

    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.ValueSource(booleans = {false, true})
    void offSteeringCancelsDecisionAndIsNeverSentToJev(boolean globalDisclosure) throws Exception {
        var decision = installDecision();
        orchestrator.setToolDisclosurePolicy(new ToolDisclosurePolicy(globalDisclosure));
        CountDownLatch entered = new CountDownLatch(1), release = new CountDownLatch(1);
        var context = new java.util.concurrent.atomic.AtomicReference<DecisionAssistContext>();
        when(decision.select(any(), any(), any())).thenAnswer(inv -> {
            context.set(inv.getArgument(0)); entered.countDown(); await(release); return Optional.of("files");
        });
        when(modelFactory.getStreamingChatModel(MODEL)).thenReturn(scripted(
                AiMessage.from(List.of(tool("extract_file_text", "read"))), AiMessage.from("done")));
        var initial = request("initial consent", "initial", "steer"); initial.setDecisionAssistEnabled(true);
        var row = inbox.submit(initial, 7L);
        var thread = new Thread(() -> orchestrator.acceptInboxSubmission(row.getId())); thread.start();
        assertTrue(entered.await(5, TimeUnit.SECONDS));
        var next = inbox.submit(request("private steering off", "off", "steer"), 7L);
        orchestrator.acceptInboxSubmission(next.getId());
        assertTrue(context.get().isCancelled());
        release.countDown(); thread.join(5000);
        assertFalse(thread.isAlive());
        verify(decision, times(1)).select(any(), eq("initial consent"), any());
        assertTrue(modelToolNames.stream().allMatch(names -> names.contains("doc_set_font")));
        assertTrue(modelRequests.stream().flatMap(List::stream).anyMatch(m -> text(m).contains("private steering off")));
    }

    @Test void globalDisclosureRemainsUnchangedForOffAndFailedDecisions() {
        var decision = installDecision();
        orchestrator.setToolDisclosurePolicy(new ToolDisclosurePolicy(true));
        when(decision.select(any(), any(), any())).thenReturn(Optional.empty());
        when(modelFactory.getStreamingChatModel(MODEL)).thenReturn(scripted(AiMessage.from("done")));
        orchestrator.handleUserMessage(request("off", "off", "steer"), 7L);
        var enabled = request("on fallback", "on", "steer"); enabled.setDecisionAssistEnabled(true);
        orchestrator.handleUserMessage(enabled, 7L);
        assertEquals(2, modelToolNames.size());
        assertEquals(modelToolNames.get(0), modelToolNames.get(1));
        assertFalse(modelToolNames.get(0).contains("doc_set_font"));
        verify(decision, times(1)).select(any(), eq("on fallback"), any());
    }

    @Test void queuedRunsUseTheirOwnConsentAndOnlyTheirOwnInput() throws Exception {
        var decision = installDecision();
        when(decision.select(any(), any(), any())).thenReturn(Optional.of("files"));
        CountDownLatch entered = new CountDownLatch(1), release = new CountDownLatch(1);
        when(tools.execute(eq("extract_file_text"), any(), any())).thenAnswer(inv -> {
            entered.countDown(); await(release); return new ToolRegistry.ToolResult("synthetic file", null, true);
        });
        when(modelFactory.getStreamingChatModel(MODEL)).thenReturn(scripted(
                AiMessage.from(List.of(tool("extract_file_text", "read"))), AiMessage.from("first done"),
                AiMessage.from("off done"), AiMessage.from("on done")));
        var first = request("first on", "first", "steer"); first.setDecisionAssistEnabled(true);
        var row = inbox.submit(first, 7L);
        var thread = new Thread(() -> orchestrator.acceptInboxSubmission(row.getId())); thread.start();
        assertTrue(entered.await(5, TimeUnit.SECONDS));
        var off = inbox.submit(request("queued off", "off", "queue"), 7L);
        var onRequest = request("queued on", "on", "queue"); onRequest.setDecisionAssistEnabled(true);
        var on = inbox.submit(onRequest, 7L);
        orchestrator.acceptInboxSubmission(off.getId());
        orchestrator.acceptInboxSubmission(on.getId());
        release.countDown(); thread.join(5000);
        assertFalse(thread.isAlive());
        verify(decision, times(1)).select(any(), eq("first on"), any());
        verify(decision, times(1)).select(any(), eq("queued on"), any());
        verify(decision, never()).select(any(), eq("queued off"), any());
        assertEquals(4, modelToolNames.size());
        assertTrue(modelToolNames.get(2).contains("doc_set_font"));
        assertFalse(modelToolNames.get(3).contains("doc_set_font"));
    }

    private void durableRunStates() {
        Map<String, AgentRunStateService.RunState> states = new HashMap<>();
        doAnswer(inv -> { states.put(inv.getArgument(0), new AgentRunStateService.RunState(inv.getArgument(1), 0)); return null; })
                .when(runState).mark(anyString(), any());
        doAnswer(inv -> { states.put(inv.getArgument(0), new AgentRunStateService.RunState(inv.getArgument(1), 0)); return null; })
                .when(runState).mark(anyString(), any(), any(), any());
        doAnswer(inv -> { states.put(inv.getArgument(0), new AgentRunStateService.RunState(AgentRunStateService.RunStatus.INTERRUPTED, 0)); return null; })
                .when(runState).suspendForRestart(anyString(), anyLong(), anyLong());
        when(runState.get(anyString())).thenAnswer(inv -> states.get(inv.getArgument(0)));
    }

    @Test
    void gracefulRestartContinuesNewProcessFromToolResultWithoutRepeatingUserOrTool() {
        durableRunStates();
        var input = request("Revise only clause 2; preserve the exceptions", "restart", "steer");
        var active = new AiAgentController.ContextItem(); active.setId("99"); active.setName("original.docx");
        input.setActiveContext(active);
        var item = inbox.submit(input, 7L);
        when(tools.execute(eq("write_clause"), anyString(), any())).thenAnswer(inv -> {
            orchestrator.prepareRestart(7L, "quit-1");
            return new ToolRegistry.ToolResult("Applied once: clause 2; verification token 12345", null, true);
        });
        when(modelFactory.getStreamingChatModel(MODEL)).thenReturn(scripted(AiMessage.from(tool("write_clause", "tool-1"))));
        String runId = orchestrator.acceptInboxSubmission(item.getId());
        assertNull(orchestrator.activeRunId(CONV));
        assertEquals(1, orchestrator.pendingRestarts(7L).size());
        assertTrue((boolean) orchestrator.prepareRestart(7L, "quit-1").get("ready"));
        var checkpoint = inbox.restartCheckpoint(item);
        assertTrue(checkpoint.path("messages").asText().contains("verification token 12345"));
        assertTrue(checkpoint.path("messages").asText().contains("preserve the exceptions"));

        // A new service and orchestrator have no previous process's guards, transcript or caches.
        inbox = new AgentInboxService(repository, sse, runState);
        orchestrator = newProcess();
        when(modelFactory.getStreamingChatModel(MODEL)).thenReturn(scripted(AiMessage.from("Verification complete")));
        assertFalse(orchestrator.resumeRestart(CONV, 42L, 100L, 7L), "wrong editor cannot consume checkpoint");
        assertFalse(orchestrator.resumeRestart(CONV, 43L, 99L, 7L));
        assertFalse(orchestrator.resumeRestart(CONV, 42L, 99L, 8L));
        assertNotNull(inbox.restartCheckpoint(item));
        assertTrue(orchestrator.resumeRestart(CONV, 42L, 99L, 7L));
        assertFalse(orchestrator.resumeRestart(CONV, 42L, 99L, 7L));
        assertNull(inbox.restartCheckpoint(item));
        assertEquals(runId, item.getRunId());
        assertEquals(2, modelRequests.size());
        assertTrue(modelRequests.get(1).stream().anyMatch(m -> m instanceof ToolExecutionResultMessage
                && text(m).contains("verification token 12345")));
        verify(tools, times(1)).execute(eq("write_clause"), anyString(), any());
        verify(messageService, times(1)).saveMessage(eq("42"), eq(7L), eq(CONV), eq("USER"), any(), any(), any());
        verify(assembler, times(1)).assemble(any(), any(), any(), any(), any(), any(), any(), any(), any(), any(), any(), any());
    }

    @Test
    void preparedExitKeepsNewInputPendingUntilAbort() {
        durableRunStates();
        assertEquals(true, orchestrator.prepareRestart(7L, "empty-exit").get("ready"));
        var pending = inbox.submit(request("new task", "late-input", "steer"), 7L);
        assertNull(orchestrator.acceptInboxSubmission(pending.getId()));
        assertEquals(AgentInboxService.PENDING, pending.getState());
        assertTrue(modelRequests.isEmpty());
        orchestrator.abortRestart(7L, "empty-exit");
        when(modelFactory.getStreamingChatModel(MODEL)).thenReturn(scripted(AiMessage.from("done")));
        assertNotNull(orchestrator.acceptInboxSubmission(pending.getId()));
        assertEquals(1, modelRequests.size());
    }

    @Test
    void abortAfterCheckpointResumesSameTaskOnceAndLatePrepareCannotSuspendIt() {
        durableRunStates();
        var item = inbox.submit(request("edit", "abort-saved", "steer"), 7L);
        when(tools.execute(eq("write_clause"), anyString(), any())).thenAnswer(inv -> {
            orchestrator.prepareRestart(7L, "quit-abort");
            return new ToolRegistry.ToolResult("Applied once", null, true);
        });
        when(modelFactory.getStreamingChatModel(MODEL)).thenReturn(scripted(
                AiMessage.from(tool("write_clause", "tool-1")), AiMessage.from("Done")));
        orchestrator.acceptInboxSubmission(item.getId());
        assertEquals(1, orchestrator.pendingRestarts(7L).size());
        var result = orchestrator.abortRestart(7L, "quit-abort");
        assertEquals(1, result.get("resumed"));
        assertEquals(0, result.get("paused"));
        assertTrue(orchestrator.pendingRestarts(7L).isEmpty());
        assertEquals(true, orchestrator.prepareRestart(7L, "quit-abort").get("aborted"));
        assertEquals(0, orchestrator.abortRestart(7L, "quit-abort").get("resumed"));
        verify(tools, times(1)).execute(eq("write_clause"), anyString(), any());
    }

    @Test
    void failedToolCannotBecomeAutomaticallyResumableAndAbortedAttemptCannotFreezeAgain() {
        durableRunStates();
        var item = inbox.submit(request("edit", "uncertain", "steer"), 7L);
        when(tools.execute(eq("write_clause"), anyString(), any())).thenAnswer(inv -> {
            orchestrator.prepareRestart(7L, "quit-failed");
            return new ToolRegistry.ToolResult("Timed out waiting for editor ACK; outcome unknown", null, false);
        });
        when(modelFactory.getStreamingChatModel(MODEL)).thenReturn(scripted(
                AiMessage.from(tool("write_clause", "tool-1")), AiMessage.from("Please inspect the document")));
        orchestrator.acceptInboxSubmission(item.getId());
        assertNull(inbox.restartCheckpoint(item));
        assertTrue(orchestrator.pendingRestarts(7L).isEmpty());
        orchestrator.abortRestart(7L, "quit-aborted");
        assertEquals(true, orchestrator.prepareRestart(7L, "quit-aborted").get("aborted"));
    }

    @Test
    void cancelledAndChangedAccountCheckpointsAreNotResumed() {
        durableRunStates();
        var meter = mock(com.checkba.service.trial.TrialTurnMeter.class);
        when(meter.accountFingerprint()).thenReturn("original-account");
        orchestrator.setTrialTurnMeter(meter);
        var queued = new ArrayList<Runnable>();
        orchestrator.setTurnExecutor(queued::add);
        when(modelFactory.getStreamingChatModel(MODEL)).thenReturn(scripted(AiMessage.from("must not generate")));
        var item = inbox.submit(request("continue task", "cancel-checkpoint", "steer"), 7L);
        orchestrator.acceptInboxSubmission(item.getId());
        orchestrator.prepareRestart(7L, "quit");
        queued.remove(0).run();
        assertNotNull(inbox.restartCheckpoint(item));
        when(meter.accountFingerprint()).thenReturn("other-account");
        assertTrue(orchestrator.pendingRestarts(7L).isEmpty());
        assertFalse(orchestrator.resumeRestart(CONV, 42L, null, 7L));
        when(meter.accountFingerprint()).thenReturn("original-account");
        orchestrator.setCancelled(CONV);
        assertFalse(orchestrator.resumeRestart(CONV, 42L, null, 7L));
        assertTrue(modelRequests.isEmpty());
    }

    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.ValueSource(strings = {"timeout", "cancel"})
    void interruptedFirstSteeringPreparationReturnsUnstartedAttachmentsToPending(String stop) throws Exception {
        orchestrator.attachmentPreparationTimeout = java.time.Duration.ofMillis(300);
        CountDownLatch originalTool = new CountDownLatch(1), releaseTool = new CountDownLatch(1);
        CountDownLatch reading = new CountDownLatch(1), releaseRead = new CountDownLatch(1), readDone = new CountDownLatch(1);
        when(tools.execute(eq("read"), any(), any())).thenAnswer(inv -> {
            originalTool.countDown();
            assertTrue(releaseTool.await(5, TimeUnit.SECONDS));
            return new ToolRegistry.ToolResult("original result retained", null, true);
        });
        doAnswer(inv -> {
            String prompt = inv.getArgument(2);
            if ("blocking steering".equals(prompt)) {
                reading.countDown();
                long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5);
                try {
                    while (releaseRead.getCount() > 0 && System.nanoTime() < deadline) {
                        try { releaseRead.await(20, TimeUnit.MILLISECONDS); } catch (InterruptedException ignored) { }
                    }
                    Thread.interrupted();
                } finally { readDone.countDown(); }
            }
            return new ArrayList<ChatMessage>(List.of(SystemMessage.from("system"), UserMessage.from(prompt)));
        }).when(assembler).assemble(any(), any(), any(), any(), any(), any(), any(), any(), any(), any(), any(), any());
        when(modelFactory.getStreamingChatModel(MODEL)).thenReturn(scripted(
                AiMessage.from(List.of(tool("read", "first-read"))), AiMessage.from("must not continue")));
        var initial = inbox.submit(request("original", "release-initial", "steer"), 7L);
        Thread run = new Thread(() -> orchestrator.acceptInboxSubmission(initial.getId(), false));
        run.start();
        try {
            assertTrue(originalTool.await(3, TimeUnit.SECONDS));
            var first = inbox.submit(request("blocking steering", "release-blocking", "steer"), 7L);
            var secondRequest = request("unstarted attachment steering", "release-unstarted", "steer");
            var attached = new AiAgentController.ContextItem(); attached.setId("88"); attached.setName("certificate.pdf");
            secondRequest.setContextItems(List.of(attached));
            var second = inbox.submit(secondRequest, 7L);
            releaseTool.countDown();
            assertTrue(reading.await(3, TimeUnit.SECONDS));
            var later = inbox.submit(request("later queued", "release-later", "queue"), 7L);
            if ("cancel".equals(stop)) assertTrue(orchestrator.setCancelled(CONV));
            run.join(3_000);
            assertFalse(run.isAlive());
            assertNull(orchestrator.activeRunId(CONV));
            assertEquals(AgentInboxService.INTERRUPTED, rows.get(first.getId()).getState(),
                    "the started input must not be replayed automatically");
            assertEquals(AgentInboxService.PENDING, rows.get(second.getId()).getState());
            assertNull(rows.get(second.getId()).getRunId());
            assertNull(rows.get(second.getId()).getAppliedSequence());
            assertEquals(List.of(second.getId(), later.getId()), list(CONV, AgentInboxService.PENDING)
                    .stream().map(AgentInboxItem::getId).toList());
            assertEquals("88", inbox.requestOf(rows.get(second.getId())).getContextItems().get(0).getId());
            verify(messageService, never()).saveMessage(any(), any(), eq(CONV), eq("USER"),
                    eq("unstarted attachment steering"), any(), any());
            assertEquals(1, modelRequests.size());
            assertTrue(sseEvents.stream().anyMatch(event -> "cancel".equals(stop)
                    ? event.startsWith("cancelled:") : event.startsWith("error:") && event.contains("CONTEXT_PREPARATION_TIMEOUT")));
        } finally {
            releaseTool.countDown(); releaseRead.countDown();
            assertTrue(readDone.await(3, TimeUnit.SECONDS));
            run.join(3_000);
        }
    }

    private StreamingChatLanguageModel scripted(AiMessage... script) {
        AtomicInteger call = new AtomicInteger();
        return new StreamingChatLanguageModel() {
            @Override public void generate(List<ChatMessage> messages, StreamingResponseHandler<AiMessage> handler) {
                complete(messages, handler);
            }
            @Override public void generate(List<ChatMessage> messages, List<ToolSpecification> specifications,
                                           StreamingResponseHandler<AiMessage> handler) {
                modelToolNames.add(specifications.stream().map(ToolSpecification::name).toList());
                complete(messages, handler);
            }
            private void complete(List<ChatMessage> messages, StreamingResponseHandler<AiMessage> handler) {
                modelRequests.add(new ArrayList<>(messages));
                AiMessage reply = script[Math.min(call.getAndIncrement(), script.length - 1)];
                if (reply.text() != null && !reply.text().isEmpty()) handler.onNext(reply.text());
                handler.onComplete(Response.from(reply));
            }
        };
    }

    private AgentInboxItemRepository inMemoryRepository() {
        AgentInboxItemRepository repo = mock(AgentInboxItemRepository.class);
        when(repo.saveAndFlush(any())).thenAnswer(inv -> save(inv.getArgument(0)));
        when(repo.save(any())).thenAnswer(inv -> save(inv.getArgument(0)));
        when(repo.findById(anyString())).thenAnswer(inv -> Optional.ofNullable(rows.get(inv.getArgument(0))));
        when(repo.findConversationIdById(anyString())).thenAnswer(inv ->
                Optional.ofNullable(rows.get(inv.getArgument(0))).map(AgentInboxItem::getConversationId));
        when(repo.findByConversationIdOrderByPositionAscCreatedAtAsc(anyString()))
                .thenAnswer(inv -> list(inv.getArgument(0), null));
        when(repo.findByConversationIdAndStateOrderByPositionAscCreatedAtAsc(anyString(), anyString()))
                .thenAnswer(inv -> list(inv.getArgument(0), inv.getArgument(1)));
        when(repo.findByConversationIdAndUserIdAndClientRequestId(anyString(), anyLong(), anyString()))
                .thenAnswer(inv -> rows.values().stream().filter(i ->
                        Objects.equals(i.getConversationId(), inv.getArgument(0))
                                && Objects.equals(i.getUserId(), inv.getArgument(1))
                                && Objects.equals(i.getClientRequestId(), inv.getArgument(2))).findFirst());
        when(repo.findRestartCheckpoints(anyLong())).thenAnswer(inv -> rows.values().stream()
                .filter(row -> Objects.equals(row.getUserId(), inv.getArgument(0))
                        && row.getRequestJson().contains("_restartCheckpoint")).toList());
        when(repo.findByRunIdAndState(anyString(), anyString())).thenAnswer(inv -> rows.values().stream()
                .filter(row -> Objects.equals(row.getRunId(), inv.getArgument(0))
                        && Objects.equals(row.getState(), inv.getArgument(1))).toList());
        return repo;
    }

    private AgentInboxItem save(AgentInboxItem item) { rows.put(item.getId(), item); return item; }
    private List<AgentInboxItem> list(String conv, String state) {
        return rows.values().stream().filter(i -> Objects.equals(conv, i.getConversationId()))
                .filter(i -> state == null || Objects.equals(state, i.getState()))
                .sorted(Comparator.comparing(AgentInboxItem::getPosition)).toList();
    }
    private static ToolExecutionRequest tool(String name, String id) {
        return ToolExecutionRequest.builder().id(id).name(name).arguments("{}").build();
    }
    private static AiAgentController.AgentChatRequest request(String message, String key, String mode) {
        AiAgentController.AgentChatRequest r = new AiAgentController.AgentChatRequest();
        r.setProjectId(42L); r.setConversationId(CONV); r.setMessage(message); r.setModel(MODEL);
        r.setClientRequestId(key); r.setSubmissionMode(mode); return r;
    }
    private static String text(ChatMessage message) {
        try { return message.text() == null ? "" : message.text(); }
        catch (Exception e) { return ""; }
    }
    private static void await(CountDownLatch latch) {
        try { assertTrue(latch.await(5, TimeUnit.SECONDS)); }
        catch (InterruptedException e) { Thread.currentThread().interrupt(); }
    }
    private int indexOfEvent(String name, String contains) {
        for (int i = 0; i < sseEvents.size(); i++) {
            if (sseEvents.get(i).startsWith(name + ":") && sseEvents.get(i).contains(contains)) return i;
        }
        return -1;
    }
}
