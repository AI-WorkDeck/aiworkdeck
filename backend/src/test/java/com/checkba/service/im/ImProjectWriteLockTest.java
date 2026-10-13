// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.im;

import com.checkba.model.entity.Project;
import com.checkba.repository.ProjectRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.TestPropertySource;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.concurrent.*;
import static org.junit.jupiter.api.Assertions.*;

/** Real JPA row locks, separate connections and independent transactions (no mocked repository). */
@DataJpaTest(showSql = false)
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@TestPropertySource(properties = {
        "spring.datasource.url=jdbc:h2:mem:im-project-lock-test;MODE=PostgreSQL;NON_KEYWORDS=VALUE;DB_CLOSE_DELAY=-1;LOCK_TIMEOUT=5000",
        "spring.datasource.driver-class-name=org.h2.Driver", "spring.datasource.username=sa", "spring.datasource.password=",
        "spring.jpa.database-platform=org.hibernate.dialect.H2Dialect", "spring.jpa.hibernate.ddl-auto=create-drop"
})
@Transactional(propagation = Propagation.NOT_SUPPORTED)
class ImProjectWriteLockTest {
    @Autowired ProjectRepository projects;
    @Autowired PlatformTransactionManager transactionManager;
    TransactionTemplate transaction;
    Long firstProject, secondProject;

    @BeforeEach void setup() {
        transaction = new TransactionTemplate(transactionManager);
        firstProject = project("first"); secondProject = project("second");
    }
    Long project(String name) {
        Project p = new Project(); p.setName(name); p.setProjectType("TEST");
        p.setListedCompanyName("synthetic"); p.setTargetCompanyName("synthetic"); p.setUserId(1L);
        return projects.saveAndFlush(p).getId();
    }

    @Test void sameProjectWaitsUntilFirstTransactionCommits() throws Exception { assertSerialized(false); }
    @Test void rollbackReleasesLockForNextWriter() throws Exception { assertSerialized(true); }

    private void assertSerialized(boolean rollback) throws Exception {
        CountDownLatch locked = new CountDownLatch(1), release = new CountDownLatch(1), attempted = new CountDownLatch(1);
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            Future<?> first = pool.submit(() -> transaction.executeWithoutResult(status -> {
                assertTrue(projects.lockForImWrite(firstProject).isPresent());
                locked.countDown(); await(release);
                if (rollback) status.setRollbackOnly();
            }));
            await(locked);
            Future<?> second = pool.submit(() -> transaction.executeWithoutResult(status -> {
                attempted.countDown();
                assertTrue(projects.lockForImWrite(firstProject).isPresent());
            }));
            await(attempted);
            assertThrows(TimeoutException.class, () -> second.get(200, TimeUnit.MILLISECONDS),
                    "same-project lock must remain held until transaction completion");
            release.countDown();
            first.get(5, TimeUnit.SECONDS); second.get(5, TimeUnit.SECONDS);
        } finally {
            release.countDown(); pool.shutdownNow(); assertTrue(pool.awaitTermination(6, TimeUnit.SECONDS));
        }
    }

    @Test void differentProjectsCanWriteWhileFirstProjectIsLocked() throws Exception {
        CountDownLatch locked = new CountDownLatch(1), release = new CountDownLatch(1);
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            Future<?> first = pool.submit(() -> transaction.executeWithoutResult(status -> {
                assertTrue(projects.lockForImWrite(firstProject).isPresent()); locked.countDown(); await(release);
            }));
            await(locked);
            Future<?> second = pool.submit(() -> transaction.executeWithoutResult(status ->
                    assertTrue(projects.lockForImWrite(secondProject).isPresent())));
            second.get(3, TimeUnit.SECONDS);
            assertFalse(first.isDone(), "other project must finish before releasing the first project");
            release.countDown(); first.get(5, TimeUnit.SECONDS);
        } finally {
            release.countDown(); pool.shutdownNow(); assertTrue(pool.awaitTermination(6, TimeUnit.SECONDS));
        }
    }

    private static void await(CountDownLatch latch) {
        try { assertTrue(latch.await(5, TimeUnit.SECONDS), "transaction synchronization timed out"); }
        catch (InterruptedException e) { Thread.currentThread().interrupt(); throw new AssertionError(e); }
    }
}
