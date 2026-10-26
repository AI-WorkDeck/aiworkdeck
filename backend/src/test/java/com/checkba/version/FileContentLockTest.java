// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.version;

import org.junit.jupiter.api.Test;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import java.util.concurrent.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class FileContentLockTest {
    @Test void nestedLocalProjectsShareTheExistingLockWhileManagedProjectsRemainIndependent() throws Exception {
        var repo = mock(ProjectRepoService.class);
        when(repo.hasLocalRoot(7L)).thenReturn(true); when(repo.hasLocalRoot(8L)).thenReturn(true);
        var sessions = new WorkSessionService(repo, null, null, null, null, null);
        ExecutorService pool = Executors.newFixedThreadPool(2);
        CountDownLatch entered = new CountDownLatch(1);
        sessions.repoLock(7L).lock();
        try {
            Future<?> nested = pool.submit(() -> sessions.withFileContentWriteLock(8L, () -> { entered.countDown(); return null; }));
            assertFalse(entered.await(200, TimeUnit.MILLISECONDS));
            assertEquals("managed", pool.submit(() -> sessions.withFileContentWriteLock(9L, () -> "managed")).get(1, TimeUnit.SECONDS));
            sessions.repoLock(7L).unlock();
            nested.get(2, TimeUnit.SECONDS);
        } finally {
            if (sessions.repoLock(7L).isHeldByCurrentThread()) sessions.repoLock(7L).unlock();
            pool.shutdownNow();
        }
    }
    @Test void deletedProjectCannotReenterContentPublication() {
        var sessions = new WorkSessionService(mock(ProjectRepoService.class), null, null, null, null, null);
        sessions.runProjectDeletion(7L, () -> {});
        assertThrows(VersionException.class, () -> sessions.withFileContentWriteLock(7L, () -> fail("deleted project published content")));
    }
    @Test void existingTransactionIsRejectedBeforeLockClassification() {
        var repo = mock(ProjectRepoService.class);
        var sessions = new WorkSessionService(repo, null, null, null, null, null);
        TransactionSynchronizationManager.setActualTransactionActive(true);
        try {
            assertThrows(IllegalStateException.class, () -> sessions.withFileContentWriteLock(7L, () -> null));
            verifyNoInteractions(repo);
        } finally { TransactionSynchronizationManager.setActualTransactionActive(false); }
    }
}
