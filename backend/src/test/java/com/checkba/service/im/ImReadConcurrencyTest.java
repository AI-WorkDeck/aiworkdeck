// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.im;

import com.checkba.model.entity.ImConversation;
import com.checkba.model.entity.User;
import com.checkba.repository.ImConversationRepository;
import com.checkba.repository.ImMemberRepository;
import com.checkba.repository.UserRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.LocalDateTime;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

/**
 * The first load test found every panel poll queueing on the conversation row (SELECT … FOR UPDATE).
 * Real row locks on separate connections: reads must not wait for the row, writes still must.
 */
@DataJpaTest(showSql = false)
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@TestPropertySource(properties = {
        "spring.datasource.url=jdbc:h2:mem:im-read-concurrency-test;MODE=PostgreSQL;NON_KEYWORDS=VALUE;DB_CLOSE_DELAY=-1;LOCK_TIMEOUT=10000",
        "spring.datasource.driver-class-name=org.h2.Driver", "spring.datasource.username=sa", "spring.datasource.password=",
        "spring.jpa.database-platform=org.hibernate.dialect.H2Dialect", "spring.jpa.hibernate.ddl-auto=create-drop"
})
@Import({ImService.class, com.checkba.service.ProjectMemberService.class})
@Transactional(propagation = Propagation.NOT_SUPPORTED)
class ImReadConcurrencyTest {
    @Autowired ImService service;
    @Autowired UserRepository users;
    @Autowired ImConversationRepository conversations;
    @Autowired ImMemberRepository memberRows;
    @Autowired PlatformTransactionManager transactionManager;
    ImAgentService agents;
    TransactionTemplate transaction;
    Long owner, colleague, client;
    String id, attachmentId;
    long lastId;

    @BeforeEach void setup() {
        agents = mock(ImAgentService.class);
        ReflectionTestUtils.setField(service, "agents", agents);
        transaction = new TransactionTemplate(transactionManager);
        owner = user("负责人"); colleague = user("同事"); client = user("客户");
        id = (String) call(owner, "create", Map.of("title", "合成并发群", "type", "GROUP")).get("id");
        for (Long user : List.of(colleague, client))
            call(user, "join", Map.of("code", call(owner, "invite", Map.of("conversationId", id, "role", user.equals(client) ? "CLIENT" : "MEMBER", "shareHistory", true)).get("code")));
        attachmentId = (String) call(owner, "upload", Map.of("conversationId", id, "name", "合成清单.txt",
                "base64", Base64.getEncoder().encodeToString("合成清单".getBytes(java.nio.charset.StandardCharsets.UTF_8)))).get("id");
        call(owner, "fileAccess", Map.of("conversationId", id, "attachmentId", attachmentId, "clientVisible", true));
        call(owner, "send", Map.of("conversationId", id, "clientMessageId", "file", "attachmentId", attachmentId));
        lastId = ((Number) call(owner, "send", Map.of("conversationId", id, "clientMessageId", "text", "text", "合成消息")).get("id")).longValue();
    }

    @Test void everyReadActionOfEveryMemberCompletesWhileTheConversationRowIsLocked() throws Exception {
        CountDownLatch locked = new CountDownLatch(1), release = new CountDownLatch(1);
        ExecutorService pool = Executors.newFixedThreadPool(24);
        try {
            Future<?> writer = pool.submit(() -> transaction.executeWithoutResult(status -> {
                assertTrue(conversations.lockById(id).isPresent()); locked.countDown(); await(release);
            }));
            await(locked);
            List<Future<Map<String, Object>>> reads = new ArrayList<>();
            for (Long user : List.of(owner, colleague, client)) {
                // The panel's 3-second cycle (self, list, new messages, read cursor, recent page) plus the other views.
                reads.add(pool.submit(() -> call(user, "self", Map.of())));
                reads.add(pool.submit(() -> call(user, "list", Map.of())));
                reads.add(pool.submit(() -> call(user, "messages", Map.of("conversationId", id, "afterId", 0, "limit", 50))));
                reads.add(pool.submit(() -> call(user, "read", Map.of("conversationId", id, "lastReadId", lastId))));
                reads.add(pool.submit(() -> call(user, "messages", Map.of("conversationId", id, "limit", 50))));
                reads.add(pool.submit(() -> call(user, "members", Map.of("conversationId", id))));
                reads.add(pool.submit(() -> call(user, "agentInfo", Map.of("conversationId", id))));
                reads.add(pool.submit(() -> call(user, "download", Map.of("conversationId", id, "attachmentId", attachmentId))));
            }
            for (Future<Map<String, Object>> read : reads) assertNotNull(read.get(5, TimeUnit.SECONDS));
            assertFalse(writer.isDone(), "the row lock must still be held when the reads finish");
            for (Long user : List.of(owner, colleague, client))
                assertEquals(lastId, memberRows.findByConversationIdAndUserId(id, user).orElseThrow().getLastReadId());

            // Writes keep queueing on the row: that is what orders message ids and guards membership.
            Future<Map<String, Object>> send = pool.submit(() -> call(colleague, "send", Map.of("conversationId", id, "clientMessageId", "queued", "text", "排队的消息")));
            Future<Map<String, Object>> invite = pool.submit(() -> call(owner, "invite", Map.of("conversationId", id, "role", "MEMBER")));
            assertThrows(TimeoutException.class, () -> send.get(300, TimeUnit.MILLISECONDS));
            assertFalse(invite.isDone());
            release.countDown();
            writer.get(5, TimeUnit.SECONDS);
            assertNotNull(send.get(5, TimeUnit.SECONDS).get("id")); assertNotNull(invite.get(5, TimeUnit.SECONDS).get("code"));
        } finally {
            release.countDown(); pool.shutdownNow(); assertTrue(pool.awaitTermination(12, TimeUnit.SECONDS));
        }
    }

    @Test void readNestedInACallersTransactionStillSerializesOnTheRow() throws Exception {
        CountDownLatch locked = new CountDownLatch(1), release = new CountDownLatch(1);
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            Future<?> writer = pool.submit(() -> transaction.executeWithoutResult(status -> {
                assertTrue(conversations.lockById(id).isPresent()); locked.countDown(); await(release);
            }));
            await(locked);
            Future<Map<String, Object>> nested = pool.submit(() -> transaction.execute(status -> call(colleague, "messages", Map.of("conversationId", id))));
            assertThrows(TimeoutException.class, () -> nested.get(300, TimeUnit.MILLISECONDS));
            release.countDown();
            writer.get(5, TimeUnit.SECONDS); assertNotNull(nested.get(5, TimeUnit.SECONDS).get("messages"));
        } finally {
            release.countDown(); pool.shutdownNow(); assertTrue(pool.awaitTermination(12, TimeUnit.SECONDS));
        }
    }

    /** Without the lock a removal and a later send can land between the membership check and the page query. */
    @Test void pollAlreadyPastItsMembershipCheckNeverReturnsAMessageSentAfterTheMemberWasRemoved() throws Exception {
        ImConversation c = conversations.findById(id).orElseThrow();
        c.setAgentScope("team"); c.setAgentScopeKey("team:synthetic"); c.setAgentName("合成助手"); c.setAgentPrivate(false);
        conversations.saveAndFlush(c);
        ExecutorService other = Executors.newSingleThreadExecutor();
        AtomicBoolean midPoll = new AtomicBoolean(true);
        try {
            // authorize() runs right after the poll's membership check and before it reads any message.
            doAnswer(call -> {
                if (!client.equals(call.getArgument(1)) || !midPoll.compareAndSet(true, false)) return null;
                other.submit(() -> {
                    call(owner, "removeMember", Map.of("conversationId", id, "userId", client));
                    return call(owner, "send", Map.of("conversationId", id, "clientMessageId", "after-removal", "text", "移除客户之后的内部消息"));
                }).get(5, TimeUnit.SECONDS);
                return null;
            }).when(agents).authorize(any(), any());
            assertThrows(IllegalArgumentException.class, () -> call(client, "messages", Map.of("conversationId", id, "afterId", lastId)),
                    "a poll in flight during the removal must not return the later message");
            assertFalse(midPoll.get(), "the removal must have happened inside the poll");
            assertEquals(1, ((List<?>) call(owner, "messages", Map.of("conversationId", id, "afterId", lastId)).get("messages")).size());
        } finally {
            other.shutdownNow();
        }
    }

    Long user(String name) {
        User u = new User(); u.setUsername("im-read-test-" + UUID.randomUUID()); u.setPassword("not-a-credential");
        u.setDisplayName(name); u.setRole("USER"); u.setSubscriptionType("FREE");
        u.setCreatedAt(LocalDateTime.now()); u.setUpdatedAt(LocalDateTime.now()); return users.saveAndFlush(u).getId();
    }
    @SuppressWarnings("unchecked") Map<String, Object> call(Long user, String action, Map<String, Object> p) { return (Map<String, Object>) service.execute(user, action, p); }
    private static void await(CountDownLatch latch) {
        try { assertTrue(latch.await(10, TimeUnit.SECONDS), "transaction synchronization timed out"); }
        catch (InterruptedException e) { Thread.currentThread().interrupt(); throw new AssertionError(e); }
    }
}
