// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.trial;

import com.checkba.model.entity.TrialBalance;
import com.checkba.repository.TrialBalanceRepository;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.context.annotation.Import;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.test.context.TestPropertySource;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Duration;
import java.time.Instant;
import java.util.concurrent.*;

import static org.junit.jupiter.api.Assertions.*;

/**
 * 真并发双发（desktop H2 同引擎）：A 已插入同一 userId 但未提交时 B 调 grant。
 * 记录 H2 实际抛什么（审计疑点：90131 是否翻成 DataIntegrityViolationException），
 * 并要求 grant 在 A 提交后给出 A 那行、不抛 UnexpectedRollbackException、不重复发放。
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@Import(TrialBalanceService.class)
@Transactional(propagation = Propagation.NOT_SUPPORTED)
@TestPropertySource(properties = {
        "spring.datasource.url=jdbc:h2:mem:trial-grant-race;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DEFAULT_NULL_ORDERING=HIGH;NON_KEYWORDS=VALUE;DB_CLOSE_DELAY=-1",
        "spring.datasource.driver-class-name=org.h2.Driver",
        "spring.datasource.username=sa",
        "spring.datasource.password=",
        "spring.jpa.database-platform=org.hibernate.dialect.H2Dialect",
        "spring.jpa.hibernate.ddl-auto=create-drop"
})
class TrialBalanceGrantRaceTest {
    @Autowired TrialBalanceRepository repository;
    @Autowired TrialBalanceService service;
    @Autowired PlatformTransactionManager tm;

    static TrialBalance row(long userId, String region) {
        Instant now = Instant.parse("2026-10-09T00:00:00Z");
        TrialBalance b = new TrialBalance();
        b.setUserId(userId); b.setTrialStartedAt(now); b.setTrialEndsAt(now.plus(Duration.ofDays(14)));
        b.setCallsQuota(80); b.setCallsUsed(0); b.setStatus("active"); b.setPolicy("min_of_days_or_calls");
        b.setRegion(region); b.setCreatedAt(now); b.setUpdatedAt(now);
        return b;
    }

    /**
     * A 持有未提交插入超过 H2 锁等待时：B 不是 90131、也不是唯一键冲突，而是 50200 锁超时
     * → PessimisticLockingFailureException。这是真实的锁超时，不该映射成「重复」；常态（A 很快提交）见下一个测试。
     */
    @Test
    void secondaryUniqueConflictHeldPastLockTimeoutIsLockTimeoutNotDuplicate() throws Exception {
        CountDownLatch inserted = new CountDownLatch(1), release = new CountDownLatch(1);
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            Future<?> a = pool.submit(() -> new TransactionTemplate(tm).executeWithoutResult(s -> {
                repository.saveAndFlush(row(501, "A"));
                inserted.countDown();
                try { release.await(10, TimeUnit.SECONDS); } catch (InterruptedException e) { throw new IllegalStateException(e); }
            }));
            assertTrue(inserted.await(10, TimeUnit.SECONDS));
            Future<Throwable> b = pool.submit(() -> {
                try { new TransactionTemplate(tm).executeWithoutResult(s -> repository.saveAndFlush(row(501, "B"))); return null; }
                catch (Throwable t) { return t; }
            });
            Throwable thrown;
            try { thrown = b.get(3, TimeUnit.SECONDS); }
            catch (TimeoutException waiting) { release.countDown(); thrown = b.get(15, TimeUnit.SECONDS); }
            release.countDown();
            a.get(15, TimeUnit.SECONDS);
            assertNotNull(thrown, "second insert must fail");
            assertInstanceOf(org.springframework.dao.PessimisticLockingFailureException.class, thrown, String.valueOf(thrown));
        } finally { pool.shutdownNow(); repository.deleteAll(); }
    }

    /** 双发：B 在 A 未提交期间调 grant；A 提交后 B 必须回读 A 那行，不抛、不重复。 */
    @Test
    void concurrentGrantReturnsTheWinnersRowWithoutRollbackError() throws Exception {
        CountDownLatch inserted = new CountDownLatch(1), release = new CountDownLatch(1);
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            Future<?> a = pool.submit(() -> new TransactionTemplate(tm).executeWithoutResult(s -> {
                repository.saveAndFlush(row(502, "A"));
                inserted.countDown();
                try { release.await(10, TimeUnit.SECONDS); } catch (InterruptedException e) { throw new IllegalStateException(e); }
            }));
            assertTrue(inserted.await(10, TimeUnit.SECONDS));
            Future<Object> b = pool.submit(() -> {
                try { return service.grant(502L, "B"); } catch (Throwable t) { return t; }
            });
            Thread.sleep(300); // B 已撞上未提交行（立刻报错或在等锁）
            release.countDown();
            a.get(15, TimeUnit.SECONDS);
            Object outcome = b.get(15, TimeUnit.SECONDS);
            if (outcome instanceof Throwable t) fail("grant threw " + t.getClass().getName() + ": " + t.getMessage());
            assertEquals("A", ((TrialBalance) outcome).getRegion(), "loser returns the winner's row");
            assertEquals(1, repository.findAll().stream().filter(x -> x.getUserId() == 502L).count());
        } finally { pool.shutdownNow(); repository.deleteAll(); }
    }

    /** 赢家在锁等待内提交（常态）：B 的插入等到 A 提交后按唯一键冲突失败，翻成 DataIntegrityViolationException。 */
    @Test
    void duplicateAgainstQuicklyCommittedRowIsDataIntegrityViolation() throws Exception {
        CountDownLatch inserted = new CountDownLatch(1), release = new CountDownLatch(1);
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            Future<?> a = pool.submit(() -> new TransactionTemplate(tm).executeWithoutResult(s -> {
                repository.saveAndFlush(row(503, "A"));
                inserted.countDown();
                try { release.await(10, TimeUnit.SECONDS); } catch (InterruptedException e) { throw new IllegalStateException(e); }
            }));
            assertTrue(inserted.await(10, TimeUnit.SECONDS));
            Future<Throwable> b = pool.submit(() -> {
                try { new TransactionTemplate(tm).executeWithoutResult(s -> repository.saveAndFlush(row(503, "B"))); return null; }
                catch (Throwable t) { return t; }
            });
            Thread.sleep(300);
            release.countDown();
            a.get(15, TimeUnit.SECONDS);
            Throwable thrown = b.get(15, TimeUnit.SECONDS);
            assertInstanceOf(DataIntegrityViolationException.class, thrown, String.valueOf(thrown));
        } finally { pool.shutdownNow(); repository.deleteAll(); }
    }
}

