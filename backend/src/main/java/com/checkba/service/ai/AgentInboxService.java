// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ai;

import com.checkba.controller.ai.AiAgentController;
import com.checkba.model.entity.AgentInboxItem;
import com.checkba.repository.AgentInboxItemRepository;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.LocalDateTime;
import java.util.*;
import java.util.function.Supplier;

/** Persistent, revisioned inbox for Agent input. */
@Service
public class AgentInboxService implements org.springframework.boot.ApplicationRunner {
    public static final String PENDING = "pending";
    public static final String APPLIED = "applied";
    public static final String INTERRUPTED = "interrupted";
    /** Hidden tombstone retained so a delayed retry cannot resurrect user-deleted input. */
    public static final String DELETED = "deleted";
    public static final String STEER = "steer";
    public static final String QUEUE = "queue";

    public record ItemView(String id, String message, String displayText, String submissionMode,
                           String state, long position, long revision, String clientRequestId,
                           String runId, Long sequence, LocalDateTime createdAt, LocalDateTime updatedAt) {}
    public record Snapshot(List<ItemView> items, String runId, String status) {}
    public record Receipt(String status, String messageId, String runId,
                          String submissionMode, String state) {}

    public static final class RevisionConflict extends RuntimeException {
        public RevisionConflict(String message) { super(message); }
    }

    public static final class InlineContentUnavailable extends IllegalStateException {
        public static final String CODE = "INLINE_CONTENT_CACHE_MISS";
        public InlineContentUnavailable() {
            super("文档正文缓存已过期或服务已重启，请重新发送文档正文。 / Document content is no longer cached; resend the document text.");
        }
    }

    private final AgentInboxItemRepository repository;
    private final SseEmitterService sseEmitterService;
    private final AgentRunStateService runStateService;
    private final InboxInlineContentStore inlineBodies = new InboxInlineContentStore();
    @Autowired(required = false)
    private com.checkba.repository.ConversationSummaryRepository conversationSummaries;
    @Autowired(required = false)
    private com.checkba.repository.ProjectAiMessageRepository conversationMessages;
    private final ObjectMapper mapper = new ObjectMapper().findAndRegisterModules()
            .disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS)
            .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);
    // 固定条带锁：按 conversationId 哈希取槽位，避免为每个历史会话永久保留一个锁对象
    private static final int LOCK_STRIPES = 256;
    private final Object[] locks = createStripes();

    private static Object[] createStripes() {
        Object[] stripes = new Object[LOCK_STRIPES];
        for (int i = 0; i < LOCK_STRIPES; i++) stripes[i] = new Object();
        return stripes;
    }
    private volatile TransactionTemplate transactions;
    private volatile EntityManager entityManager;

    public AgentInboxService(AgentInboxItemRepository repository,
                             SseEmitterService sseEmitterService,
                             AgentRunStateService runStateService) {
        this.repository = repository;
        this.sseEmitterService = sseEmitterService;
        this.runStateService = runStateService;
    }

    @Autowired
    void setTransactionManager(PlatformTransactionManager transactionManager) {
        TransactionTemplate template = new TransactionTemplate(transactionManager);
        template.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        this.transactions = template;
    }

    @PersistenceContext
    void setEntityManager(EntityManager entityManager) {
        this.entityManager = entityManager;
    }

    public Object conversationLock(String conversationId) {
        if (conversationId == null) return locks[0];
        return locks[Math.floorMod(Objects.hashCode(conversationId), LOCK_STRIPES)];
    }

    /** Persist before returning. A duplicate clientRequestId resolves to the original row. */
    public AgentInboxItem submit(AiAgentController.AgentChatRequest request, Long userId) {
        String conv = request.getConversationId();
        synchronized (conversationLock(conv)) {
            String key = normalizeIdempotencyKey(request.getClientRequestId());
            if (key != null) {
                Optional<AgentInboxItem> existing = repository
                        .findByConversationIdAndUserIdAndClientRequestId(conv, userId, key);
                if (existing.isPresent()) {
                    restoreRetryBodies(existing.get(), request);
                    return existing.get();
                }
            }

            AgentInboxItem row = new AgentInboxItem();
            row.setId(UUID.randomUUID().toString());
            row.setConversationId(conv);
            row.setProjectId(request.getProjectId());
            row.setUserId(userId);
            row.setClientRequestId(key);
            row.setSubmissionMode(normalizeMode(request.getSubmissionMode()));
            row.setState(PENDING);
            row.setPosition(nextPosition(conv));
            row.setRevision(1L);
            row.setMessage(request.getMessage());
            row.setDisplayText(blankToNull(request.getDisplayText()));
            row.setRequestJson(writeRequest(request));
            inlineBodies.put(row.getId(), conv, collectInlineBodies(request));
            LocalDateTime now = LocalDateTime.now();
            row.setCreatedAt(now);
            row.setUpdatedAt(now);
            try {
                row = repository.saveAndFlush(row);
            } catch (DataIntegrityViolationException race) {
                inlineBodies.remove(row.getId());
                if (key == null) throw race;
                row = repository.findByConversationIdAndUserIdAndClientRequestId(conv, userId, key)
                        .orElseThrow(() -> race);
            }
            emitSnapshot(conv);
            return row;
        }
    }

    public AgentInboxItem require(String id) {
        return repository.findById(id)
                .orElseThrow(() -> new NoSuchElementException("Inbox message not found"));
    }

    public ItemView view(String id) {
        return view(require(id));
    }

    public AiAgentController.AgentChatRequest requestOf(AgentInboxItem row) {
        AiAgentController.AgentChatRequest request;
        try {
            request = mapper.readValue(row.getRequestJson(), AiAgentController.AgentChatRequest.class);
        } catch (Exception e) {
            // Jackson exception messages may contain snippets of the original request.
            throw new IllegalStateException("Stored inbox request is unreadable: " + row.getId());
        }
        for (AiAgentController.ContextItem item : contextItems(request)) {
            if (item.getInlineContent() != null && !item.getInlineContent().isEmpty()) continue;
            String hash = item.getInlineContentHash();
            if (hash == null || hash.isBlank() || item.isStaleBody()) continue;
            String body = inlineBodies.get(row.getId(), hash);
            if (body == null) throw new InlineContentUnavailable();
            item.setInlineContent(body);
        }
        return request;
    }

    /** Graceful desktop restart only; never reconstruct a checkpoint from conversation text. */
    public void saveRestartCheckpoint(String itemId, com.fasterxml.jackson.databind.JsonNode checkpoint) {
        synchronized (conversationLock(conversationId(itemId))) {
            inTransaction(() -> {
                AgentInboxItem row = fresh(itemId);
                if (!APPLIED.equals(row.getState())) throw new IllegalStateException("Run is no longer applied");
                var json = readStoredObject(row);
                if ("office".equalsIgnoreCase(json.path("clientCapability").asText())) {
                    throw new IllegalStateException("Office document bodies cannot be persisted for restart");
                }
                json.set("_restartCheckpoint", checkpoint);
                row.setRequestJson(json.toString());
                repository.saveAndFlush(row);
                return null;
            });
        }
    }

    public List<AgentInboxItem> restartCheckpoints(Long userId) {
        return repository.findRestartCheckpoints(userId).stream()
                .filter(row -> (APPLIED.equals(row.getState()) || INTERRUPTED.equals(row.getState()))
                        && readStoredObject(row).has("_restartCheckpoint")).toList();
    }

    public com.fasterxml.jackson.databind.JsonNode restartCheckpoint(AgentInboxItem row) {
        return readStoredObject(row).get("_restartCheckpoint");
    }

    public AiAgentController.AgentChatRequest requestMetadataOf(AgentInboxItem row) {
        try { return mapper.treeToValue(readStoredObject(row), AiAgentController.AgentChatRequest.class); }
        catch (Exception e) { throw new IllegalStateException("Stored request metadata is unreadable"); }
    }

    public void consumeRestartCheckpoint(String itemId) {
        synchronized (conversationLock(conversationId(itemId))) {
            inTransaction(() -> {
                AgentInboxItem row = fresh(itemId);
                var json = readStoredObject(row);
                json.remove("_restartCheckpoint");
                row.setRequestJson(json.toString());
                // Same run / input / sequence. Resuming is not a second inbox submission.
                if (INTERRUPTED.equals(row.getState())) row.setState(APPLIED);
                repository.saveAndFlush(row);
                return null;
            });
        }
    }

    private com.fasterxml.jackson.databind.node.ObjectNode readStoredObject(AgentInboxItem row) {
        try { return (com.fasterxml.jackson.databind.node.ObjectNode) mapper.readTree(row.getRequestJson()); }
        catch (Exception e) { throw new IllegalStateException("Stored request metadata is unreadable"); }
    }

    /** Server-owned continuation metadata in the existing durable request snapshot. */
    public record Clarification(List<String> instructions, List<String> skillIds,
                                Long targetFileId, String targetFileName) {}

    public void rememberClarification(String runId, String questionId, Clarification context) {
        var applied = repository.findByRunIdAndState(runId, APPLIED);
        var latest = applied.stream().max(Comparator.comparingLong(row ->
                row.getAppliedSequence() == null ? 0L : row.getAppliedSequence()));
        for (AgentInboxItem row : latest.stream().toList()) {
            try {
                var json = (com.fasterxml.jackson.databind.node.ObjectNode) mapper.readTree(row.getRequestJson());
                json.put("_clarificationQuestionId", questionId);
                json.set("_clarification", mapper.valueToTree(context));
                row.setRequestJson(mapper.writeValueAsString(json));
                repository.save(row);
            } catch (Exception e) {
                throw new IllegalStateException("Could not retain clarification context", e);
            }
        }
    }

    public Clarification takeClarification(String conversationId, Long projectId, Long userId, String answer, String activeFileId) {
        if (!AskUserQuestion.isAnswerMessage(answer)) return null;
        var match = java.util.regex.Pattern.compile("^\\s*<ask_user_answer\\s+id=\"([^\"]+)\"\\s*>").matcher(answer);
        if (!match.find()) return null;
        synchronized (conversationLock(conversationId)) {
            var rows = repository.findByConversationIdOrderByPositionAscCreatedAtAsc(conversationId).stream()
                    .sorted(Comparator.comparing(AgentInboxItem::getUpdatedAt)).toList();
            for (int i = rows.size() - 1; i >= 0; i--) {
                AgentInboxItem row = rows.get(i);
                if (!APPLIED.equals(row.getState()) || !Objects.equals(projectId, row.getProjectId())
                        || !Objects.equals(userId, row.getUserId())) continue;
                var priorAnswer = java.util.regex.Pattern.compile("^\\s*<ask_user_answer\\s+id=\"([^\"]+)\"\\s*>")
                        .matcher(row.getMessage());
                if (priorAnswer.find() && match.group(1).equals(priorAnswer.group(1))) continue;
                try {
                    var json = (com.fasterxml.jackson.databind.node.ObjectNode) mapper.readTree(row.getRequestJson());
                    if (!match.group(1).equals(json.path("_clarificationQuestionId").asText())) return null;
                    Clarification context = mapper.treeToValue(json.get("_clarification"), Clarification.class);
                    // A switched/closed editor must not consume the user's pending answer context.
                    if (context.targetFileId() == null || String.valueOf(context.targetFileId()).equals(activeFileId)) {
                        json.remove(List.of("_clarificationQuestionId", "_clarification"));
                        row.setRequestJson(mapper.writeValueAsString(json));
                        repository.save(row);
                    }
                    return context;
                } catch (Exception e) {
                    throw new IllegalStateException("Could not restore clarification context", e);
                }
            }
        }
        return null;
    }

    public AgentInboxItem claim(String id, String runId) {
        return claim(id, runId, true);
    }

    public AgentInboxItem claim(String id, String runId, boolean emitApplied) {
        String conversationId = conversationId(id);
        synchronized (conversationLock(conversationId)) {
            boolean[] claimedNow = {false};
            AgentInboxItem row = inTransaction(() -> {
                AgentInboxItem current = require(id);
                if (!PENDING.equals(current.getState())) return current;
                claimedNow[0] = true;
                current.setState(APPLIED);
                current.setRunId(runId);
                current.setAppliedSequence(nextSequence(conversationId, runId));
                current.setRevision(current.getRevision() + 1);
                current.setUpdatedAt(LocalDateTime.now());
                AgentInboxItem saved = repository.saveAndFlush(current);
                compactPendingPositions(conversationId);
                return saved;
            });
            if (!claimedNow[0]) return row;
            // The snapshot establishes the new run id before input_applied is interpreted.
            emitSnapshot(conversationId);
            if (emitApplied) emitInputApplied(row);
            return row;
        }
    }

    public String conversationId(String id) {
        return repository.findConversationIdById(id)
                .orElseThrow(() -> new NoSuchElementException("Inbox message not found"));
    }

    /** Re-read after clearing an OSIV persistence context; caller holds the conversation monitor. */
    AgentInboxItem fresh(String id) {
        return inTransaction(() -> require(id));
    }

    public boolean hasPendingSteering(String conversationId) {
        return repository.findByConversationIdAndStateOrderByPositionAscCreatedAtAsc(conversationId, PENDING)
                .stream().anyMatch(i -> STEER.equals(i.getSubmissionMode()));
    }

    public List<AgentInboxItem> claimPendingSteering(String conversationId, String runId) {
        synchronized (conversationLock(conversationId)) {
            List<AgentInboxItem> claimed = inTransaction(() -> {
                List<AgentInboxItem> result = new ArrayList<>();
                for (AgentInboxItem row : repository
                        .findByConversationIdAndStateOrderByPositionAscCreatedAtAsc(conversationId, PENDING)) {
                    if (!STEER.equals(row.getSubmissionMode())) continue;
                    row.setState(APPLIED);
                    row.setRunId(runId);
                    row.setAppliedSequence(nextSequence(conversationId, runId));
                    row.setRevision(row.getRevision() + 1);
                    row.setUpdatedAt(LocalDateTime.now());
                    result.add(repository.saveAndFlush(row));
                }
                if (!result.isEmpty()) compactPendingPositions(conversationId);
                return result;
            });
            if (!claimed.isEmpty()) {
                emitSnapshot(conversationId);
                claimed.forEach(this::emitInputApplied);
            }
            return claimed;
        }
    }

    /** Return only claimed steering inputs whose preparation has not started; never replay the active input. */
    public void releaseUnstartedSteering(String conversationId, String runId, List<String> remainingIds) {
        if (remainingIds == null || remainingIds.isEmpty() || runId == null) return;
        synchronized (conversationLock(conversationId)) {
            boolean changed = inTransaction(() -> {
                List<AgentInboxItem> released = new ArrayList<>();
                for (String id : new LinkedHashSet<>(remainingIds)) {
                    AgentInboxItem row = repository.findById(id).orElse(null);
                    if (row != null && Objects.equals(conversationId, row.getConversationId())
                            && Objects.equals(runId, row.getRunId()) && APPLIED.equals(row.getState())
                            && STEER.equals(row.getSubmissionMode())) released.add(row);
                }
                if (released.isEmpty()) return false;
                released.sort(Comparator.comparing(AgentInboxItem::getAppliedSequence,
                        Comparator.nullsLast(Long::compareTo)));
                List<AgentInboxItem> pending = repository
                        .findByConversationIdAndStateOrderByPositionAscCreatedAtAsc(conversationId, PENDING);
                LocalDateTime now = LocalDateTime.now();
                for (int i = 0; i < released.size(); i++) {
                    AgentInboxItem row = released.get(i);
                    row.setState(PENDING);
                    row.setRunId(null);
                    row.setAppliedSequence(null);
                    row.setPosition((long) i);
                    row.setRevision(row.getRevision() + 1);
                    row.setUpdatedAt(now);
                    repository.save(row);
                }
                // These were already ahead of newly submitted follow-ups before being claimed.
                for (int i = 0; i < pending.size(); i++) {
                    AgentInboxItem row = pending.get(i);
                    long position = released.size() + (long) i;
                    if (Objects.equals(row.getPosition(), position)) continue;
                    row.setPosition(position);
                    row.setRevision(row.getRevision() + 1);
                    row.setUpdatedAt(now);
                    repository.save(row);
                }
                return true;
            });
            if (changed) emitSnapshot(conversationId);
        }
    }

    public Optional<AgentInboxItem> nextQueued(String conversationId) {
        return repository.findByConversationIdAndStateOrderByPositionAscCreatedAtAsc(conversationId, PENDING)
                .stream().filter(i -> QUEUE.equals(i.getSubmissionMode())).findFirst();
    }

    /** After success, every pending input is a normal follow-up; preserve durable position order. */
    public Optional<AgentInboxItem> nextPending(String conversationId) {
        return repository.findByConversationIdAndStateOrderByPositionAscCreatedAtAsc(conversationId, PENDING)
                .stream().findFirst();
    }

    public ItemView edit(String conversationId, String id, String message, String submissionMode,
                         Long position, long expectedRevision) {
        synchronized (conversationLock(conversationId)) {
            ItemView result = inTransaction(() -> {
                AgentInboxItem row = requireOwned(conversationId, id);
                assertMutable(row, expectedRevision);
                AiAgentController.AgentChatRequest storedRequest = null;
                if (message != null) {
                    if (message.isBlank()) throw new IllegalArgumentException("Message cannot be empty");
                    row.setMessage(message);
                    storedRequest = requestOf(row);
                    storedRequest.setMessage(message);
                    // displayText described the old canonical message. PATCH has no separate displayText
                    // field, so clearing it makes every renderer fall back to the edited canonical text.
                    storedRequest.setDisplayText(null);
                    row.setDisplayText(null);
                }
                if (submissionMode != null) {
                    row.setSubmissionMode(normalizeMode(submissionMode));
                    if (storedRequest == null) storedRequest = requestOf(row);
                    storedRequest.setSubmissionMode(row.getSubmissionMode());
                }
                if (storedRequest != null) row.setRequestJson(writeRequest(storedRequest));
                if (position != null) reorderPending(conversationId, row, position);
                row.setRevision(row.getRevision() + 1);
                row.setUpdatedAt(LocalDateTime.now());
                return view(repository.saveAndFlush(row));
            });
            emitSnapshot(conversationId);
            return result;
        }
    }

    public Snapshot delete(String conversationId, String id, long expectedRevision) {
        synchronized (conversationLock(conversationId)) {
            Snapshot snapshot = inTransaction(() -> {
                AgentInboxItem row = requireOwned(conversationId, id);
                assertMutable(row, expectedRevision);
                row.setState(DELETED);
                clearDeletedContent(row);
                row.setRevision(row.getRevision() + 1);
                row.setUpdatedAt(LocalDateTime.now());
                repository.saveAndFlush(row);
                compactPendingPositions(conversationId);
                return snapshot(conversationId);
            });
            inlineBodies.remove(id);
            emitSnapshot(snapshot, conversationId);
            return snapshot;
        }
    }

    @Transactional
    public void interruptRun(String runId) {
        if (runId == null) return;
        for (AgentInboxItem row : repository.findByRunIdAndState(runId, APPLIED)) {
            row.setState(INTERRUPTED);
            row.setRevision(row.getRevision() + 1);
            row.setUpdatedAt(LocalDateTime.now());
            repository.save(row);
        }
    }

    public void interruptConversationRuns(String conversationId) {
        synchronized (conversationLock(conversationId)) {
            inTransaction(() -> {
                for (AgentInboxItem row : repository
                        .findByConversationIdOrderByPositionAscCreatedAtAsc(conversationId)) {
                    if (!APPLIED.equals(row.getState())) continue;
                    row.setState(INTERRUPTED);
                    row.setRevision(row.getRevision() + 1);
                    row.setUpdatedAt(LocalDateTime.now());
                    repository.save(row);
                }
                return null;
            });
            emitSnapshot(conversationId);
        }
    }

    public Receipt receipt(AgentInboxItem row, String activeRunId) {
        AgentInboxItem current = require(row.getId());
        return new Receipt("accepted", current.getId(),
                current.getRunId() != null ? current.getRunId() : activeRunId,
                current.getSubmissionMode(), current.getState());
    }

    public Snapshot snapshot(String conversationId) {
        List<AgentInboxItem> rows = repository.findByConversationIdOrderByPositionAscCreatedAtAsc(conversationId)
                .stream().filter(i -> !DELETED.equals(i.getState())).toList();
        String runId = rows.stream().filter(i -> i.getRunId() != null)
                .max(Comparator.comparing(AgentInboxItem::getUpdatedAt)).map(AgentInboxItem::getRunId).orElse(null);
        return new Snapshot(rows.stream().map(AgentInboxService::view).toList(), runId,
                runStateService.statusName(conversationId));
    }

    private AgentInboxItem requireOwned(String conversationId, String id) {
        AgentInboxItem row = require(id);
        if (!Objects.equals(conversationId, row.getConversationId())) {
            throw new NoSuchElementException("Inbox message not found");
        }
        return row;
    }

    private static void assertMutable(AgentInboxItem row, long expectedRevision) {
        if (!PENDING.equals(row.getState())) throw new RevisionConflict("Only pending input can be changed");
        if (row.getRevision() != expectedRevision) throw new RevisionConflict("Inbox revision is stale");
    }

    private long nextPosition(String conversationId) {
        return repository.findByConversationIdAndStateOrderByPositionAscCreatedAtAsc(conversationId, PENDING).stream()
                .map(AgentInboxItem::getPosition).filter(Objects::nonNull).max(Long::compareTo).orElse(-1L) + 1L;
    }

    private void compactPendingPositions(String conversationId) {
        List<AgentInboxItem> pending = repository
                .findByConversationIdAndStateOrderByPositionAscCreatedAtAsc(conversationId, PENDING);
        for (int i = 0; i < pending.size(); i++) {
            AgentInboxItem item = pending.get(i);
            if (Objects.equals(item.getPosition(), (long) i)) continue;
            item.setPosition((long) i);
            item.setRevision(item.getRevision() + 1);
            item.setUpdatedAt(LocalDateTime.now());
            repository.save(item);
        }
    }

    /** position is a zero-based destination index among pending items. */
    private void reorderPending(String conversationId, AgentInboxItem target, long requestedIndex) {
        List<AgentInboxItem> pending = new ArrayList<>(repository
                .findByConversationIdAndStateOrderByPositionAscCreatedAtAsc(conversationId, PENDING));
        pending.removeIf(i -> Objects.equals(i.getId(), target.getId()));
        int index = (int) Math.max(0, Math.min(requestedIndex, pending.size()));
        pending.add(index, target);
        for (int i = 0; i < pending.size(); i++) {
            AgentInboxItem item = pending.get(i);
            item.setPosition((long) i);
            if (!Objects.equals(item.getId(), target.getId())) {
                item.setRevision(item.getRevision() + 1);
                item.setUpdatedAt(LocalDateTime.now());
                repository.save(item);
            }
        }
    }

    private long nextSequence(String conversationId, String runId) {
        return repository.findByConversationIdOrderByPositionAscCreatedAtAsc(conversationId).stream()
                .filter(i -> Objects.equals(runId, i.getRunId()))
                .map(AgentInboxItem::getAppliedSequence).filter(Objects::nonNull)
                .max(Long::compareTo).orElse(0L) + 1L;
    }

    /** The transaction must commit before the caller releases the per-conversation monitor. */
    private <T> T inTransaction(Supplier<T> work) {
        TransactionTemplate template = transactions;
        if (template == null) return work.get();
        return template.execute(status -> {
            EntityManager em = entityManager;
            if (em != null) em.clear();
            return work.get();
        });
    }

    private String writeRequest(AiAgentController.AgentChatRequest request) {
        try {
            var json = mapper.valueToTree(request);
            stripInlineContent(json);
            return mapper.writeValueAsString(json);
        } catch (Exception e) {
            throw new IllegalArgumentException("Request metadata cannot be stored");
        }
    }

    private static List<AiAgentController.ContextItem> contextItems(AiAgentController.AgentChatRequest request) {
        List<AiAgentController.ContextItem> items = new ArrayList<>();
        if (request.getActiveContext() != null) items.add(request.getActiveContext());
        if (request.getContextItems() != null) request.getContextItems().stream().filter(Objects::nonNull).forEach(items::add);
        return items;
    }

    private static Map<String, String> collectInlineBodies(AiAgentController.AgentChatRequest request) {
        Map<String, String> bodies = new HashMap<>();
        for (AiAgentController.ContextItem item : contextItems(request)) {
            String body = item.getInlineContent();
            if (body != null && !body.isEmpty()) bodies.put(InlineContentCache.sha256Hex(body), body);
        }
        return bodies;
    }

    private void restoreRetryBodies(AgentInboxItem row, AiAgentController.AgentChatRequest retry) {
        if (!PENDING.equals(row.getState())) return;
        Map<String, String> incoming = collectInlineBodies(retry);
        if (incoming.isEmpty()) return;
        AiAgentController.AgentChatRequest original;
        try {
            original = mapper.readValue(row.getRequestJson(), AiAgentController.AgentChatRequest.class);
        } catch (Exception unreadable) {
            throw new IllegalStateException("Stored inbox request is unreadable: " + row.getId());
        }
        Map<String, String> restored = new HashMap<>();
        for (AiAgentController.ContextItem item : contextItems(original)) {
            String hash = item.getInlineContentHash();
            if (hash == null || hash.isBlank()) continue;
            String body = inlineBodies.get(row.getId(), hash);
            if (body == null) body = incoming.get(hash);
            if (body != null) restored.put(hash, body);
        }
        // The idempotency key cannot replace a queued document with a different version.
        if (!restored.isEmpty()) inlineBodies.put(row.getId(), row.getConversationId(), restored);
    }

    private static void stripInlineContent(com.fasterxml.jackson.databind.JsonNode node) {
        if (node instanceof com.fasterxml.jackson.databind.node.ObjectNode object) {
            var body = object.remove("inlineContent");
            if (body != null && body.isTextual() && !body.asText().isEmpty()) {
                object.put("inlineContentHash", InlineContentCache.sha256Hex(body.asText()));
            }
        }
        node.elements().forEachRemaining(AgentInboxService::stripInlineContent);
    }

    private static void clearDeletedContent(AgentInboxItem row) {
        row.setMessage("");
        row.setDisplayText(null);
        row.setRequestJson("{}");
    }

    /** Called within the conversation deletion transaction, preserving its atomicity. */
    @Transactional
    public void deleteConversation(String conversationId) {
        synchronized (conversationLock(conversationId)) {
            repository.deleteByConversationId(conversationId);
            inlineBodies.removeConversation(conversationId);
        }
    }

    @org.springframework.scheduling.annotation.Scheduled(fixedDelay = 60_000)
    public void purgeExpiredInlineBodies() { inlineBodies.purgeExpired(); }

    /** Runs before readiness; bounded batches scrub legacy bodies without logging their contents. */
    @Override
    public void run(org.springframework.boot.ApplicationArguments args) {
        if (conversationSummaries != null) inTransaction(() -> conversationSummaries.deleteOrphanedSummaries());
        Set<String> cleanedOfficeConversations = new HashSet<>();
        String cursor = "";
        while (true) {
            List<String> ids = repository.findIdsAfter(cursor, org.springframework.data.domain.PageRequest.of(0, 100));
            if (ids.isEmpty()) return;
            inTransaction(() -> {
                for (String id : ids) {
                    AgentInboxItem row = require(id);
                    String before = row.getRequestJson();
                    com.fasterxml.jackson.databind.JsonNode json;
                    String sanitized;
                    try {
                        json = mapper.readTree(before);
                        stripInlineContent(json);
                        sanitized = mapper.writeValueAsString(json);
                    } catch (Exception unreadable) {
                        // Unreadable legacy payloads cannot safely be replayed or retained.
                        row.setRequestJson("{}");
                        if (DELETED.equals(row.getState())) clearDeletedContent(row);
                        else row.setState(INTERRUPTED);
                        repository.save(row);
                        continue;
                    }
                    if ("office".equalsIgnoreCase(json.path("clientCapability").asText())
                            && cleanedOfficeConversations.add(row.getConversationId())) {
                        scrubOfficeHistory(row.getConversationId());
                    }
                    if (DELETED.equals(row.getState())) {
                        clearDeletedContent(row);
                        repository.save(row);
                    } else if (!Objects.equals(before, sanitized)) {
                        row.setRequestJson(sanitized);
                        repository.save(row);
                    }
                }
                return null;
            });
            cursor = ids.get(ids.size() - 1);
        }
    }

    private void scrubOfficeHistory(String conversationId) {
        if (conversationSummaries != null) conversationSummaries.deleteByConversationId(conversationId);
        if (conversationMessages == null) return;
        for (var message : conversationMessages.findByConversationIdOrderByCreatedAtAsc(conversationId)) {
            if (!"ASSISTANT".equalsIgnoreCase(message.getRole())) continue;
            String content = OfficeConversationPrivacy.forStorage(message.getContent());
            String display = OfficeConversationPrivacy.forStorage(message.getDisplayContent());
            if (!Objects.equals(content, message.getContent()) || !Objects.equals(display, message.getDisplayContent())) {
                message.setContent(content);
                message.setDisplayContent(display);
                conversationMessages.save(message);
            }
        }
    }

    private void emitInputApplied(AgentInboxItem row) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("messageId", row.getId());
        payload.put("runId", row.getRunId());
        payload.put("sequence", row.getAppliedSequence());
        payload.put("message", row.getMessage());
        payload.put("displayText", row.getDisplayText());
        payload.put("clientRequestId", row.getClientRequestId());
        payload.put("submissionMode", row.getSubmissionMode());
        sendJson(row.getConversationId(), "input_applied", payload);
    }

    public void emitSnapshot(String conversationId) {
        emitSnapshot(snapshot(conversationId), conversationId);
    }

    private void emitSnapshot(Snapshot snapshot, String conversationId) {
        sendJson(conversationId, "inbox_updated", snapshot);
    }

    private void sendJson(String conversationId, String event, Object payload) {
        try {
            sseEmitterService.send(conversationId, event, mapper.writeValueAsString(payload));
        } catch (Exception e) {
            // The durable row is authoritative; reconnect GET restores it.
        }
    }

    private static ItemView view(AgentInboxItem i) {
        return new ItemView(i.getId(), i.getMessage(), i.getDisplayText(), i.getSubmissionMode(),
                i.getState(), i.getPosition(), i.getRevision(), i.getClientRequestId(), i.getRunId(),
                i.getAppliedSequence(), i.getCreatedAt(), i.getUpdatedAt());
    }

    public static String normalizeMode(String mode) {
        if (mode == null || mode.isBlank() || STEER.equalsIgnoreCase(mode)) return STEER;
        if (QUEUE.equalsIgnoreCase(mode)) return QUEUE;
        throw new IllegalArgumentException("submissionMode must be steer or queue");
    }

    private static String normalizeIdempotencyKey(String key) {
        if (key == null || key.isBlank()) return null;
        String trimmed = key.trim();
        if (trimmed.length() > 128) throw new IllegalArgumentException("clientRequestId is too long");
        return trimmed;
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value;
    }
}
