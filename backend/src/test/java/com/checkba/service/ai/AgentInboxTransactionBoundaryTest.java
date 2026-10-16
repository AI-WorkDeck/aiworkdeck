// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ai;

import com.checkba.controller.ai.AiAgentController;
import com.checkba.model.entity.AgentInboxItem;
import com.checkba.repository.AgentInboxItemRepository;
import jakarta.persistence.EntityManager;
import jakarta.persistence.EntityManagerFactory;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.TestPropertySource;
import org.springframework.orm.jpa.EntityManagerHolder;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.TransactionStatus;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@TestPropertySource(properties = {
        "spring.datasource.url=jdbc:h2:mem:agent-inbox-tx-boundary;MODE=PostgreSQL;NON_KEYWORDS=VALUE;DB_CLOSE_DELAY=-1",
        "spring.datasource.driver-class-name=org.h2.Driver",
        "spring.datasource.username=sa",
        "spring.datasource.password=",
        "spring.jpa.database-platform=org.hibernate.dialect.H2Dialect",
        "spring.jpa.hibernate.ddl-auto=create-drop"
})
class AgentInboxTransactionBoundaryTest {
    @Autowired AgentInboxItemRepository repository;
    @Autowired PlatformTransactionManager transactionManager;
    @Autowired EntityManager entityManager;
    @Autowired EntityManagerFactory entityManagerFactory;
    @Autowired com.checkba.repository.ProjectRepository projects;
    @Autowired com.checkba.repository.ProjectMemberRepository members;
    @Autowired com.checkba.repository.UserRepository users;
    @Autowired com.checkba.repository.ProjectInvitationRepository invitations;
    @Autowired com.checkba.repository.ConversationSummaryRepository summaries;
    @Autowired com.checkba.repository.ProjectAiMessageRepository messages;

    @Test
    @Transactional(propagation = Propagation.NOT_SUPPORTED)
    void startupPrivacyScrubRemovesLegacyBodiesAndOfficeDerivedContentFromDatabase() {
        var inbox = durableInbox(mock(SseEmitterService.class), mock(AgentRunStateService.class));
        org.springframework.test.util.ReflectionTestUtils.setField(inbox, "conversationSummaries", summaries);
        org.springframework.test.util.ReflectionTestUtils.setField(inbox, "conversationMessages", messages);
        var request = request(); request.setConversationId("privacy-migration");
        var row = inbox.submit(request, 7L);
        row.setRequestJson("{\"clientCapability\":\"office\",\"activeContext\":{\"inlineContent\":\"synthetic original document\"}}");
        repository.saveAndFlush(row);
        var summary = new com.checkba.model.entity.ConversationSummary();
        summary.setConversationId("privacy-migration"); summary.setSummaryText("synthetic derived summary");
        summaries.saveAndFlush(summary);
        var orphan = new com.checkba.model.entity.ConversationSummary();
        orphan.setConversationId("privacy-orphan"); orphan.setSummaryText("synthetic orphan summary");
        summaries.saveAndFlush(orphan);
        var assistant = new com.checkba.model.entity.ProjectAiMessage();
        assistant.setProjectId(42L); assistant.setUserId(7L); assistant.setConversationId("privacy-migration");
        assistant.setRole("ASSISTANT"); assistant.setCreatedAt(java.time.LocalDateTime.now());
        assistant.setContent("<tool_output>synthetic raw reading</tool_output><final>keep this answer</final>");
        assistant.setDisplayContent("<tool_code>synthetic raw arguments</tool_code>");
        assistant = messages.saveAndFlush(assistant);

        inbox.run(null);
        var durable = repository.findById(row.getId()).orElseThrow();
        assertFalse(durable.getRequestJson().contains("synthetic original document"));
        assertTrue(durable.getRequestJson().contains("inlineContentHash"));
        assertThrows(AgentInboxService.InlineContentUnavailable.class, () -> inbox.requestOf(durable));
        var savedMessage = messages.findById(assistant.getId()).orElseThrow();
        assertFalse(savedMessage.getContent().contains("synthetic raw reading"));
        assertTrue(savedMessage.getContent().contains("keep this answer"));
        assertFalse(savedMessage.getDisplayContent().contains("synthetic raw arguments"));
        assertFalse(summaries.existsByConversationId("privacy-migration"));
        assertFalse(summaries.existsByConversationId("privacy-orphan"));
        inbox.run(null);
        assertEquals(durable.getRequestJson(), repository.findById(row.getId()).orElseThrow().getRequestJson());
    }

    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.ValueSource(strings = {"client", "global-client", "removed"})
    @Transactional(propagation = Propagation.NOT_SUPPORTED)
    void restoredDurableInputUsesCurrentMembershipAndRechecksTheExecutor(String change) {
        var owner = saveUser();
        var user = saveUser();
        var project = new com.checkba.model.entity.Project();
        project.setName("synthetic inbox permission fixture");
        project.setProjectType("TEST");
        project.setListedCompanyName("");
        project.setTargetCompanyName("");
        project.setUserId(owner.getId());
        project = projects.saveAndFlush(project);
        var member = new com.checkba.model.entity.ProjectMember();
        member.setProjectId(project.getId());
        member.setUserId(user.getId());
        member.setRole("ADMIN");
        member = members.saveAndFlush(member);
        var access = new com.checkba.service.ProjectMemberService(members, users, projects, invitations);
        SseEmitterService sse = mock(SseEmitterService.class);
        AgentRunStateService state = mock(AgentRunStateService.class);
        AgentInboxService original = durableInbox(sse, state);
        var request = request();
        request.setProjectId(project.getId());
        request.setConversationId("restored-" + java.util.UUID.randomUUID());
        AgentInboxItem saved = original.submit(request, user.getId());

        // Restore from committed H2 rows through a new service, with real project-role repositories.
        AgentInboxService restored = durableInbox(sse, state);
        var tasks = new java.util.ArrayList<Runnable>();
        var orchestrator = mock(AgentOrchestrator.class, CALLS_REAL_METHODS);
        var modelFactory = mock(ChatModelFactory.class);
        var assembler = mock(ContextAssemblerService.class);
        org.springframework.test.util.ReflectionTestUtils.setField(orchestrator, "activeRuns", new java.util.concurrent.ConcurrentHashMap<>());
        org.springframework.test.util.ReflectionTestUtils.setField(orchestrator, "projectMemberService", access);
        org.springframework.test.util.ReflectionTestUtils.setField(orchestrator, "sseEmitterService", sse);
        org.springframework.test.util.ReflectionTestUtils.setField(orchestrator, "agentRunStateService", state);
        org.springframework.test.util.ReflectionTestUtils.setField(orchestrator, "skillRouter", mock(com.checkba.service.ai.skill.SkillRouter.class));
        org.springframework.test.util.ReflectionTestUtils.setField(orchestrator, "chatModelFactory", modelFactory);
        org.springframework.test.util.ReflectionTestUtils.setField(orchestrator, "contextAssemblerService", assembler);
        orchestrator.setInboxService(restored);
        orchestrator.setTurnExecutor(tasks::add);
        if ("removed".equals(change)) members.delete(member);
        else if ("global-client".equals(change)) {
            user.setRole("CLIENT"); users.saveAndFlush(user);
        } else {
            member.setRole("CLIENT"); members.saveAndFlush(member);
        }
        assertThrows(SecurityException.class, () -> orchestrator.acceptInboxSubmission(saved.getId()));
        assertTrue(tasks.isEmpty());
        assertEquals(AgentInboxService.PENDING, repository.findById(saved.getId()).orElseThrow().getState());
        verifyNoInteractions(modelFactory, assembler);

        // Positive control: restoring staff membership admits this exact persisted item once.
        user.setRole("USER"); users.saveAndFlush(user);
        if ("removed".equals(change)) member.setId(null);
        member.setRole("ADMIN"); member = members.saveAndFlush(member);
        assertNotNull(orchestrator.acceptInboxSubmission(saved.getId()));
        assertEquals(1, tasks.size());
        assertEquals(AgentInboxService.APPLIED, repository.findById(saved.getId()).orElseThrow().getState());
        // Revocation after admission, before the executor runs, must also be authoritative.
        member.setRole("CLIENT"); members.saveAndFlush(member);
        tasks.get(0).run();
        assertEquals(AgentInboxService.INTERRUPTED, repository.findById(saved.getId()).orElseThrow().getState());
        assertNull(orchestrator.activeRunId(request.getConversationId()));
        verifyNoInteractions(modelFactory, assembler);
    }

    private com.checkba.model.entity.User saveUser() {
        var user = new com.checkba.model.entity.User();
        user.setUsername("inbox-" + java.util.UUID.randomUUID());
        user.setDisplayName("Synthetic inbox user");
        user.setPassword("not-a-login-hash");
        return users.saveAndFlush(user);
    }

    private AgentInboxService durableInbox(SseEmitterService sse, AgentRunStateService state) {
        var service = new AgentInboxService(repository, sse, state);
        service.setTransactionManager(transactionManager);
        service.setEntityManager(entityManager);
        return service;
    }

    @Test
    @Transactional(propagation = Propagation.NOT_SUPPORTED)
    void deleteKeepsConversationGateUntilCommitSoClaimCannotResurrectTheRow() throws Exception {
        SseEmitterService sse = mock(SseEmitterService.class);
        AgentInboxService service = new AgentInboxService(repository, sse, mock(AgentRunStateService.class));
        BlockingCommitTransactionManager blocking = new BlockingCommitTransactionManager(transactionManager);
        service.setTransactionManager(blocking);
        service.setEntityManager(entityManager);

        AgentInboxItem row = service.submit(request(), 7L);
        clearInvocations(sse);
        CountDownLatch staleEntityCached = new CountDownLatch(1);
        CountDownLatch invokeClaim = new CountDownLatch(1);
        AtomicReference<AgentInboxItem> claimed = new AtomicReference<>();
        AtomicReference<Throwable> claimFailure = new AtomicReference<>();
        Thread claiming = new Thread(() -> {
            EntityManager requestEntityManager = entityManagerFactory.createEntityManager();
            TransactionSynchronizationManager.bindResource(
                    entityManagerFactory, new EntityManagerHolder(requestEntityManager));
            try {
                assertEquals(AgentInboxService.PENDING,
                        repository.findById(row.getId()).orElseThrow().getState());
                staleEntityCached.countDown();
                assertTrue(invokeClaim.await(5, TimeUnit.SECONDS));
                claimed.set(service.claim(row.getId(), "late-run"));
            } catch (Throwable failure) {
                claimFailure.set(failure);
            } finally {
                TransactionSynchronizationManager.unbindResource(entityManagerFactory);
                requestEntityManager.close();
            }
        });
        claiming.start();
        assertTrue(staleEntityCached.await(5, TimeUnit.SECONDS), "claim request did not cache the pending row");

        AtomicReference<Throwable> deleteFailure = new AtomicReference<>();
        Thread deleting = new Thread(() -> {
            try { service.delete("conv-tx", row.getId(), row.getRevision()); }
            catch (Throwable failure) { deleteFailure.set(failure); }
        });
        deleting.start();
        assertTrue(blocking.commitEntered.await(5, TimeUnit.SECONDS), "delete did not reach commit");
        verifyNoInteractions(sse);

        invokeClaim.countDown();
        Thread.sleep(100);
        assertTrue(claiming.isAlive(), "claim crossed the conversation gate before delete committed");

        blocking.allowCommit.countDown();
        deleting.join(5_000);
        claiming.join(5_000);
        assertNull(deleteFailure.get());
        assertNull(claimFailure.get());
        assertNotNull(claimed.get());
        assertEquals(AgentInboxService.DELETED, claimed.get().getState());
        assertEquals(AgentInboxService.DELETED, repository.findById(row.getId()).orElseThrow().getState());
        verify(sse, atLeastOnce()).send(eq("conv-tx"), eq("inbox_updated"), anyString());
    }

    private static AiAgentController.AgentChatRequest request() {
        AiAgentController.AgentChatRequest request = new AiAgentController.AgentChatRequest();
        request.setProjectId(42L);
        request.setConversationId("conv-tx");
        request.setMessage("must not run");
        request.setSubmissionMode("queue");
        return request;
    }

    private static final class BlockingCommitTransactionManager implements PlatformTransactionManager {
        private final PlatformTransactionManager delegate;
        private final CountDownLatch commitEntered = new CountDownLatch(1);
        private final CountDownLatch allowCommit = new CountDownLatch(1);

        private BlockingCommitTransactionManager(PlatformTransactionManager delegate) {
            this.delegate = delegate;
        }

        @Override public TransactionStatus getTransaction(TransactionDefinition definition) {
            return delegate.getTransaction(definition);
        }

        @Override public void commit(TransactionStatus status) {
            commitEntered.countDown();
            try {
                if (!allowCommit.await(5, TimeUnit.SECONDS)) throw new AssertionError("commit was not released");
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw new AssertionError(e);
            }
            delegate.commit(status);
        }

        @Override public void rollback(TransactionStatus status) { delegate.rollback(status); }
    }
}
