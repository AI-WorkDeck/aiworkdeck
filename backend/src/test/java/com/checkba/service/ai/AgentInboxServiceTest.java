// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ai;

import com.checkba.controller.ai.AiAgentController;
import com.checkba.model.entity.AgentInboxItem;
import com.checkba.repository.AgentInboxItemRepository;
import com.fasterxml.jackson.databind.JsonMappingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.*;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.CopyOnWriteArrayList;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class AgentInboxServiceTest {
    private final Map<String, AgentInboxItem> table = new LinkedHashMap<>();
    private AgentInboxItemRepository repository;
    private SseEmitterService sse;
    private AgentInboxService service;

    @BeforeEach
    void setUp() {
        table.clear();
        repository = mock(AgentInboxItemRepository.class);
        when(repository.saveAndFlush(any())).thenAnswer(inv -> save(inv.getArgument(0)));
        when(repository.save(any())).thenAnswer(inv -> save(inv.getArgument(0)));
        when(repository.findById(anyString())).thenAnswer(inv -> Optional.ofNullable(table.get(inv.getArgument(0))));
        when(repository.findConversationIdById(anyString())).thenAnswer(inv ->
                Optional.ofNullable(table.get(inv.getArgument(0))).map(AgentInboxItem::getConversationId));
        when(repository.findByConversationIdOrderByPositionAscCreatedAtAsc(anyString()))
                .thenAnswer(inv -> rows(inv.getArgument(0), null));
        when(repository.findByConversationIdAndStateOrderByPositionAscCreatedAtAsc(anyString(), anyString()))
                .thenAnswer(inv -> rows(inv.getArgument(0), inv.getArgument(1)));
        when(repository.findByConversationIdAndUserIdAndClientRequestId(anyString(), anyLong(), anyString()))
                .thenAnswer(inv -> table.values().stream().filter(i ->
                        Objects.equals(i.getConversationId(), inv.getArgument(0))
                                && Objects.equals(i.getUserId(), inv.getArgument(1))
                                && Objects.equals(i.getClientRequestId(), inv.getArgument(2))).findFirst());
        when(repository.findByRunIdAndState(anyString(), anyString()))
                .thenAnswer(inv -> table.values().stream().filter(i ->
                        Objects.equals(i.getRunId(), inv.getArgument(0))
                                && Objects.equals(i.getState(), inv.getArgument(1))).toList());
        doAnswer(inv -> { table.remove(((AgentInboxItem) inv.getArgument(0)).getId()); return null; })
                .when(repository).delete(any());

        sse = mock(SseEmitterService.class);
        AgentRunStateService states = mock(AgentRunStateService.class);
        when(states.statusName(anyString())).thenReturn("RUNNING");
        service = new AgentInboxService(repository, sse, states);
    }

    @Test
    void inlineBodiesStayOutOfDurableJsonAndQueuedVersionsRemainIndependent() throws Exception {
        var first = request("review", "body-1", "queue");
        var body = new AiAgentController.ContextItem();
        body.setId("doc"); body.setInlineContent("synthetic first document");
        body.setInlineContentHash("untrusted-client-hash");
        first.setActiveContext(body);
        var attached = new AiAgentController.ContextItem();
        attached.setInlineContent("synthetic attachment");
        first.setContextItems(List.of(attached));
        var row = service.submit(first, 7L);
        var json = new ObjectMapper().readTree(row.getRequestJson());
        assertFalse(row.getRequestJson().contains("synthetic first document"));
        assertFalse(row.getRequestJson().contains("synthetic attachment"));
        assertFalse(json.path("activeContext").has("inlineContent"));
        assertEquals(InlineContentCache.sha256Hex(body.getInlineContent()), json.path("activeContext").path("inlineContentHash").asText());
        assertEquals("synthetic first document", first.getActiveContext().getInlineContent(), "serialization must not mutate caller");

        body.setInlineContent("synthetic next version");
        first.setClientRequestId("body-2");
        var next = service.submit(first, 7L);
        assertEquals("synthetic first document", service.requestOf(row).getActiveContext().getInlineContent());
        assertEquals("synthetic attachment", service.requestOf(row).getContextItems().get(0).getInlineContent());
        assertEquals("synthetic next version", service.requestOf(next).getActiveContext().getInlineContent());
        service.edit("conv-1", row.getId(), "edited review", null, null, row.getRevision());
        assertFalse(row.getRequestJson().contains("synthetic first document"));
        assertEquals("synthetic first document", service.requestOf(row).getActiveContext().getInlineContent());
    }

    @Test
    void restartFailsExplicitlyInsteadOfReplayingWithoutRequiredDocument() {
        var request = request("review", "body", "queue");
        var body = new AiAgentController.ContextItem(); body.setInlineContent("synthetic body");
        request.setActiveContext(body);
        var row = service.submit(request, 7L);
        var restarted = new AgentInboxService(repository, sse, mock(AgentRunStateService.class));
        assertThrows(AgentInboxService.InlineContentUnavailable.class, () -> restarted.requestOf(row));
        var same = restarted.submit(request, 7L);
        assertEquals(row.getId(), same.getId());
        assertEquals("synthetic body", restarted.requestOf(same).getActiveContext().getInlineContent());
    }

    @Test
    void deletedInputErasesPayloadButRetainsIdempotencyTombstone() {
        var request = request("private question", "private-key", "queue");
        request.setDisplayText("private display");
        var body = new AiAgentController.ContextItem(); body.setInlineContent("synthetic private body");
        request.setActiveContext(body);
        var row = service.submit(request, 7L);
        String previousJson = row.getRequestJson();
        service.delete("conv-1", row.getId(), row.getRevision());
        assertEquals("", row.getMessage());
        assertNull(row.getDisplayText());
        assertEquals("{}", row.getRequestJson());
        assertEquals(row.getId(), service.submit(request, 7L).getId());
        row.setRequestJson(previousJson); // Probe only the transient store, using synthetic metadata.
        assertThrows(AgentInboxService.InlineContentUnavailable.class, () -> service.requestOf(row));
    }

    @Test
    void startupScrubsHistoricalBodiesAndDerivedOfficeSummaryIdempotently() throws Exception {
        var row = service.submit(request("question", "legacy", "queue"), 7L);
        row.setRequestJson("{\"message\":\"question\",\"clientCapability\":\"office\",\"activeContext\":{\"inlineContent\":\"legacy synthetic body\"}}");
        var summaries = mock(com.checkba.repository.ConversationSummaryRepository.class);
        org.springframework.test.util.ReflectionTestUtils.setField(service, "conversationSummaries", summaries);
        when(repository.findIdsAfter(eq(""), any())).thenReturn(List.of(row.getId()));
        when(repository.findIdsAfter(eq(row.getId()), any())).thenReturn(List.of());
        service.run(null);
        String cleaned = row.getRequestJson();
        assertFalse(cleaned.contains("legacy synthetic body"));
        assertEquals(InlineContentCache.sha256Hex("legacy synthetic body"), new ObjectMapper().readTree(cleaned).path("activeContext").path("inlineContentHash").asText());
        assertThrows(AgentInboxService.InlineContentUnavailable.class, () -> service.requestOf(row));
        verify(summaries).deleteByConversationId("conv-1");
        verify(summaries).deleteOrphanedSummaries();
        service.run(null);
        assertEquals(cleaned, row.getRequestJson());
    }

    @Test
    void persistsBeforeReceiptAndDeduplicatesClientRequestId() {
        AiAgentController.AgentChatRequest request = request("first", "same-key", "queue");
        AiAgentController.ContextItem attachment = new AiAgentController.ContextItem();
        attachment.setId("88");
        attachment.setName("contract.docx");
        request.setContextItems(List.of(attachment));

        AgentInboxItem first = service.submit(request, 7L);
        AgentInboxItem duplicate = service.submit(request("retry body", "same-key", "steer"), 7L);

        assertEquals(first.getId(), duplicate.getId());
        assertEquals(1, table.size());
        assertEquals("first", duplicate.getMessage());
        assertEquals("contract.docx", service.requestOf(first).getContextItems().get(0).getName(),
                "attachment metadata must survive durable serialization");
        assertEquals(AgentInboxService.PENDING, service.receipt(first, "run-active").state());
    }

    @Test
    void claimIsIdempotentAndEmitsTypedAppliedEventOnce() {
        AgentInboxItem row = service.submit(request("steer now", "k", null), 7L);
        clearInvocations(sse);

        service.claim(row.getId(), "run-1");
        service.claim(row.getId(), "run-1");

        AgentInboxItem applied = table.get(row.getId());
        assertEquals(AgentInboxService.APPLIED, applied.getState());
        assertEquals(1L, applied.getAppliedSequence());
        verify(sse, times(1)).send(eq("conv-1"), eq("input_applied"), contains("\"messageId\""));
    }

    @Test
    void pendingEditsAndDeletesRequireExactRevision() {
        AgentInboxItem row = service.submit(request("old", null, "queue"), 7L);
        AgentInboxService.ItemView edited = service.edit("conv-1", row.getId(), "new", "steer", 10L, 1L);
        assertEquals("new", edited.message());
        assertNull(edited.displayText(), "edited canonical text must not retain stale displayText");
        assertEquals("steer", service.requestOf(table.get(row.getId())).getSubmissionMode());
        assertEquals(2L, edited.revision());
        assertThrows(AgentInboxService.RevisionConflict.class,
                () -> service.edit("conv-1", row.getId(), "stale", null, null, 1L));
        assertThrows(AgentInboxService.RevisionConflict.class,
                () -> service.delete("conv-1", row.getId(), 1L));

        service.delete("conv-1", row.getId(), 2L);
        assertTrue(service.snapshot("conv-1").items().isEmpty());
        assertEquals(AgentInboxService.DELETED, table.get(row.getId()).getState());
        AgentInboxItem retry = service.submit(request("old", null, "queue"), 7L);
        assertNotEquals(row.getId(), retry.getId(), "requests without an idempotency key are independent");
    }

    @Test
    void deletedIdempotentRequestCannotBeResurrected() {
        AgentInboxItem row = service.submit(request("later", "durable-key", "queue"), 7L);
        service.delete("conv-1", row.getId(), row.getRevision());

        AgentInboxItem delayedRetry = service.submit(request("later", "durable-key", "queue"), 7L);

        assertEquals(row.getId(), delayedRetry.getId());
        assertEquals(AgentInboxService.DELETED, delayedRetry.getState());
        assertTrue(service.snapshot("conv-1").items().isEmpty());
    }

    @Test
    void reorderUsesZeroBasedIndexAndShiftsOtherPendingItemsDeterministically() {
        AgentInboxItem a = service.submit(request("a", "a", "queue"), 7L);
        AgentInboxItem b = service.submit(request("b", "b", "queue"), 7L);
        AgentInboxItem c = service.submit(request("c", "c", "queue"), 7L);

        service.edit("conv-1", c.getId(), null, null, 0L, c.getRevision());
        assertEquals(List.of("c", "a", "b"), service.snapshot("conv-1").items().stream()
                .map(AgentInboxService.ItemView::message).toList());

        AgentInboxItem currentC = table.get(c.getId());
        service.edit("conv-1", c.getId(), null, null, 2L, currentC.getRevision());
        assertEquals(List.of("a", "b", "c"), service.snapshot("conv-1").items().stream()
                .map(AgentInboxService.ItemView::message).toList());
    }

    @Test
    void concurrentClientsReceiveDistinctOrderedRowsWithoutLoss() throws Exception {
        CountDownLatch start = new CountDownLatch(1);
        List<AgentInboxItem> out = new CopyOnWriteArrayList<>();
        Thread a = new Thread(() -> awaitThenSubmit(start, out, request("a", "a", "queue")));
        Thread b = new Thread(() -> awaitThenSubmit(start, out, request("b", "b", "queue")));
        a.start(); b.start(); start.countDown(); a.join(); b.join();

        assertEquals(2, out.size());
        assertEquals(2, table.size());
        List<Long> positions = table.values().stream().map(AgentInboxItem::getPosition).sorted().toList();
        assertEquals(List.of(0L, 1L), positions);
    }

    @Test
    void restartKeepsPendingAndMarksOnlyUncertainAppliedInputInterrupted() {
        AgentInboxItem pending = service.submit(request("later", "p", "queue"), 7L);
        AgentInboxItem applied = service.submit(request("running", "a", "steer"), 7L);
        service.claim(applied.getId(), "run-old");

        AgentInboxService restarted = new AgentInboxService(repository, sse, mock(AgentRunStateService.class));
        restarted.interruptConversationRuns("conv-1");

        assertEquals(AgentInboxService.PENDING, table.get(pending.getId()).getState());
        assertEquals(AgentInboxService.INTERRUPTED, table.get(applied.getId()).getState());
    }

    @Test
    void decisionOptInRequiresLiteralJsonBooleanWithoutChangingOtherDtoCoercion() throws Exception {
        ObjectMapper mapper = new ObjectMapper();
        assertTrue(mapper.readValue("{\"decisionAssistEnabled\":true}",
                AiAgentController.AgentChatRequest.class).isDecisionAssistEnabled());
        for (String body : List.of("{}", "{\"decisionAssistEnabled\":false}", "{\"decisionAssistEnabled\":null}")) {
            assertFalse(mapper.readValue(body, AiAgentController.AgentChatRequest.class).isDecisionAssistEnabled());
        }
        for (String value : List.of("\"true\"", "\"false\"", "1", "0", "\"\"", "{}", "[]")) {
            assertThrows(JsonMappingException.class, () -> mapper.readValue(
                    "{\"decisionAssistEnabled\":" + value + "}", AiAgentController.AgentChatRequest.class), value);
        }
        assertTrue(mapper.readValue("{\"isDir\":\"true\"}", AiAgentController.ContextItem.class).isDir(),
                "strict consent must not alter Jackson coercion for unrelated DTO properties");
    }

    @Test
    void decisionOptInSurvivesDurableSerializationPendingEditAndRestart() throws Exception {
        for (boolean enabled : List.of(false, true)) {
            var request = request("queued", "consent-" + enabled, "queue");
            request.setDecisionAssistEnabled(enabled);
            AgentInboxItem row = service.submit(request, 7L);
            assertEquals(enabled, new ObjectMapper().readTree(row.getRequestJson()).path("decisionAssistEnabled").booleanValue());

            service.edit("conv-1", row.getId(), "edited text", "steer", null, row.getRevision());
            AgentInboxService restarted = new AgentInboxService(repository, sse, mock(AgentRunStateService.class));
            var restored = restarted.requestOf(restarted.require(row.getId()));
            assertEquals("edited text", restored.getMessage());
            assertEquals("steer", restored.getSubmissionMode());
            assertEquals(enabled, restored.isDecisionAssistEnabled(),
                    "editing text/mode and restarting must not change the submission's consent");
        }
    }

    @Test
    void idempotentRetryCannotUpgradeOrDowngradeTheOriginalConsent() {
        for (boolean originallyEnabled : List.of(false, true)) {
            var original = request("original", "retry-consent-" + originallyEnabled, "queue");
            original.setDecisionAssistEnabled(originallyEnabled);
            var row = service.submit(original, 7L);
            var retry = request("changed retry", original.getClientRequestId(), "steer");
            retry.setDecisionAssistEnabled(!originallyEnabled);
            var same = service.submit(retry, 7L);
            assertEquals(row.getId(), same.getId());
            assertEquals(originallyEnabled, service.requestOf(same).isDecisionAssistEnabled());
            assertEquals("original", service.requestOf(same).getMessage());
        }
        assertEquals(2, table.size());
    }

    @Test
    void newDisabledSubmissionAndLegacyPayloadDoNotInheritEarlierConsent() {
        var enabled = request("enabled", "on", "queue");
        enabled.setDecisionAssistEnabled(true);
        service.submit(enabled, 7L);
        var disabled = service.submit(request("off", "off", "queue"), 7L);
        assertFalse(service.requestOf(disabled).isDecisionAssistEnabled());
        var legacy = new AgentInboxItem();
        legacy.setId("legacy");
        legacy.setRequestJson("{\"projectId\":42,\"conversationId\":\"conv-1\",\"message\":\"older client\"}");
        assertFalse(service.requestOf(legacy).isDecisionAssistEnabled());
    }

    private void awaitThenSubmit(CountDownLatch start, List<AgentInboxItem> out,
                                 AiAgentController.AgentChatRequest request) {
        try { start.await(); out.add(service.submit(request, 7L)); }
        catch (InterruptedException e) { Thread.currentThread().interrupt(); }
    }

    private AgentInboxItem save(AgentInboxItem row) { table.put(row.getId(), row); return row; }

    private List<AgentInboxItem> rows(String conversationId, String state) {
        return table.values().stream()
                .filter(i -> Objects.equals(conversationId, i.getConversationId()))
                .filter(i -> state == null || Objects.equals(state, i.getState()))
                .sorted(Comparator.comparing(AgentInboxItem::getPosition)
                        .thenComparing(AgentInboxItem::getCreatedAt))
                .toList();
    }

    private static AiAgentController.AgentChatRequest request(String message, String key, String mode) {
        AiAgentController.AgentChatRequest request = new AiAgentController.AgentChatRequest();
        request.setProjectId(42L);
        request.setConversationId("conv-1");
        request.setMessage(message);
        request.setDisplayText("display " + message);
        request.setModel("qwen/qwen3.7-flash");
        request.setClientRequestId(key);
        request.setSubmissionMode(mode);
        return request;
    }
    @Test
    void clarificationSnapshotSurvivesServiceRestartAndIsConsumedOnce() {
        AgentInboxItem original = service.submit(request("修订这份法律意见书", "review", null), 7L);
        service.claim(original.getId(), "review-run");
        AgentInboxService.Clarification context = new AgentInboxService.Clarification(
                List.of("修订这份法律意见书"), List.of("legal-opinion-review"), 5L, "意见书.docx");
        service.rememberClarification("review-run", "ask-review", context);
        AgentInboxService restarted = new AgentInboxService(repository, sse, mock(AgentRunStateService.class));
        String answer = "<ask_user_answer id=\"ask-review\">Selected:\n- 核对事实后修订</ask_user_answer>";
        assertNull(restarted.takeClarification("conv-1", 42L, 8L, answer, "5"), "其他用户不能取得原范围");
        assertNull(restarted.takeClarification("conv-1", 43L, 7L, answer, "5"), "其他项目不能取得原范围");
        assertNull(restarted.takeClarification("conv-1", 42L, 7L, answer.replace("ask-review", "ask-stale"), "5"));
        assertEquals(context, restarted.takeClarification("conv-1", 42L, 7L, answer, "99"),
                "切文件时返回原目标但不消费待回答范围");
        AgentInboxItem switchedAnswer = service.submit(request(answer, "switched-answer", null), 7L);
        service.claim(switchedAnswer.getId(), "switched-run");
        assertEquals(context, restarted.takeClarification("conv-1", 42L, 7L, answer, "5"),
                "切文件失败后同问题重答仍可恢复未消费范围");
        assertNull(restarted.takeClarification("conv-1", 42L, 7L, answer, "5"), "迟到的重复回答不能再次恢复旧范围");
        assertEquals("修订这份法律意见书", restarted.requestOf(original).getMessage());
    }

    @Test
    void unrelatedNewTurnInvalidatesOlderClarification() {
        AgentInboxItem original = service.submit(request("修订这份法律意见书", "review", null), 7L);
        service.claim(original.getId(), "review-run");
        service.rememberClarification("review-run", "ask-review", new AgentInboxService.Clarification(
                List.of("修订这份法律意见书"), List.of("legal-opinion-review"), 5L, "意见书.docx"));
        AgentInboxItem newer = service.submit(request("另一个任务", "new", null), 7L);
        service.claim(newer.getId(), "new-run");
        assertNull(service.takeClarification("conv-1", 42L, 7L,
                "<ask_user_answer id=\"ask-review\">Selected:\n- 继续</ask_user_answer>", "5"));
    }

}
