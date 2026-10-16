// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.version;

import com.checkba.repository.ProjectFileRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.scheduling.TaskScheduler;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class ChangeSignalNonBlockingTest {
    private ProjectRepoService repos;
    private WorkSessionRepository sessions;
    private WorkSessionService service;
    private List<Runnable> scheduled;

    @BeforeEach
    void setup() {
        repos = mock(ProjectRepoService.class);
        sessions = mock(WorkSessionRepository.class);
        TaskScheduler scheduler = mock(TaskScheduler.class);
        scheduled = new ArrayList<>();
        when(scheduler.schedule(any(Runnable.class), any(Instant.class))).thenAnswer(call -> {
            scheduled.add(call.getArgument(0));
            return mock(ScheduledFuture.class);
        });
        when(repos.isInitialized(7L)).thenReturn(true);
        when(repos.currentBranch(7L)).thenReturn("master");
        when(sessions.findFirstByProjectIdAndStatusAndSessionType(any(), any(), any()))
                .thenReturn(Optional.empty());
        when(sessions.save(any())).thenAnswer(call -> {
            WorkSession session = call.getArgument(0);
            session.setId(1L);
            return session;
        });
        service = new WorkSessionService(repos, mock(ProjectTreeManifestService.class),
                sessions, scheduler, mock(ProjectFileRepository.class), event -> {});
    }

    @Test
    void busyRepositoryDoesNotBlockSaveAndCoalescesLatestActor() throws Exception {
        var lock = service.repoLock(7L);
        // Lock initialization resolves local-folder ownership once; only the busy
        // request below must avoid repository/database work.
        verify(repos).hasLocalRoot(7L);
        clearInvocations(repos);
        lock.lock();
        var executor = Executors.newSingleThreadExecutor();
        try {
            try {
                executor.submit(() -> {
                    service.onChangeSignal(7L, 1L, "first");
                    service.onChangeSignal(7L, 2L, "latest");
                }).get(500, TimeUnit.MILLISECONDS);
                verifyNoInteractions(repos, sessions);
                assertEquals(1, scheduled.size(), "同项目不堆积等待锁的后台任务");
            } finally {
                lock.unlock();
            }
        } finally {
            executor.shutdownNow();
        }
        scheduled.get(0).run();
        verify(sessions).save(argThat(s -> Long.valueOf(2L).equals(s.getUserId())));
        verify(repos).createBranch(eq(7L), startsWith("work/"), eq("HEAD"));
    }

    @Test
    void lockClassificationFailuresKeepTheLatestActorAndAllowBackgroundRetry() {
        when(repos.hasLocalRoot(7L))
                .thenThrow(new IllegalStateException("first lookup failed"))
                .thenThrow(new IllegalStateException("second lookup failed"))
                .thenThrow(new IllegalStateException("background lookup failed"))
                .thenReturn(true);

        assertDoesNotThrow(() -> service.onChangeSignal(7L, 1L, "first"));
        assertDoesNotThrow(() -> service.onChangeSignal(7L, 2L, "latest"));
        assertEquals(1, scheduled.size(), "Failed classification still coalesces queued signals");
        verifyNoInteractions(sessions);
        assertDoesNotThrow(() -> scheduled.get(0).run());
        assertEquals(2, scheduled.size(), "Failed background classification releases the queue slot and retries");
        verifyNoInteractions(sessions);
        scheduled.get(1).run();
        verify(sessions).save(argThat(s -> Long.valueOf(2L).equals(s.getUserId())));
        verify(repos).createBranch(eq(7L), startsWith("work/"), eq("HEAD"));
        verify(repos, times(4)).hasLocalRoot(7L);
    }

    @Test
    void transactionOnlyQueuesAfterCommitWithoutUsingItsConnection() {
        TransactionSynchronizationManager.initSynchronization();
        TransactionSynchronizationManager.setActualTransactionActive(true);
        try {
            service.onChangeSignal(7L, 3L, "author");
            verifyNoInteractions(repos, sessions);
            assertTrue(scheduled.isEmpty());
            for (var callback : TransactionSynchronizationManager.getSynchronizations()) callback.afterCommit();
            verifyNoInteractions(repos, sessions);
            assertEquals(1, scheduled.size(), "提交回调只入队，不沿用事务连接开工作段");
        } finally {
            TransactionSynchronizationManager.clearSynchronization();
            TransactionSynchronizationManager.setActualTransactionActive(false);
        }
        scheduled.get(0).run();
        verify(sessions).save(argThat(s -> Long.valueOf(3L).equals(s.getUserId())));
    }

    @Test
    void rolledBackSaveDoesNotScheduleVersionWork() {
        TransactionSynchronizationManager.initSynchronization();
        TransactionSynchronizationManager.setActualTransactionActive(true);
        try {
            service.onChangeSignal(7L, 1L, "author");
            for (var callback : TransactionSynchronizationManager.getSynchronizations()) {
                callback.afterCompletion(TransactionSynchronization.STATUS_ROLLED_BACK);
            }
            assertTrue(scheduled.isEmpty());
            verifyNoInteractions(repos, sessions);
        } finally {
            TransactionSynchronizationManager.clearSynchronization();
            TransactionSynchronizationManager.setActualTransactionActive(false);
        }
    }

    @Test
    void deferredSignalRetriesWithoutLosingTheActor() {
        TransactionSynchronizationManager.initSynchronization();
        TransactionSynchronizationManager.setActualTransactionActive(true);
        try {
            service.onChangeSignal(7L, 4L, "author");
            TransactionSynchronizationManager.getSynchronizations().forEach(TransactionSynchronization::afterCommit);
        } finally {
            TransactionSynchronizationManager.clearSynchronization();
            TransactionSynchronizationManager.setActualTransactionActive(false);
        }
        when(repos.isInitialized(7L)).thenThrow(new IllegalStateException("temporary failure")).thenReturn(true);
        scheduled.get(0).run();
        verifyNoInteractions(sessions);
        assertEquals(2, scheduled.size());
        scheduled.get(1).run();
        verify(sessions).save(argThat(s -> Long.valueOf(4L).equals(s.getUserId())));
    }

    @Test
    void disablingVersionHistoryCancelsAlreadyQueuedSignals() {
        TransactionSynchronizationManager.initSynchronization();
        TransactionSynchronizationManager.setActualTransactionActive(true);
        try {
            service.onChangeSignal(7L, 1L, "author");
            TransactionSynchronizationManager.getSynchronizations().forEach(TransactionSynchronization::afterCommit);
        } finally {
            TransactionSynchronizationManager.clearSynchronization();
            TransactionSynchronizationManager.setActualTransactionActive(false);
        }
        when(repos.workTree(7L)).thenReturn(java.nio.file.Path.of("target/nonexistent-signal-test-project"));
        service.disableVersionRecording(7L);
        scheduled.get(0).run();
        verify(sessions, never()).save(any());
        verify(repos, never()).createBranch(anyLong(), anyString(), anyString());
    }

    @Test
    void statusSchedulesPendingIngestWithoutMaterializingFilesOnRequestThread() throws Exception {
        var field = WorkSessionService.class.getDeclaredField("pendingIngestBase");
        field.setAccessible(true);
        @SuppressWarnings("unchecked")
        var pending = (java.util.Map<Long, String>) field.get(service);
        pending.put(7L, "old-sha");
        when(repos.mainBranch()).thenReturn("master");
        when(repos.resolveRef(7L, "master")).thenReturn("new-sha");
        when(repos.diffNameStatus(7L, "new-sha", "old-sha")).thenReturn(List.of());

        service.pendingChangesLocked(7L);
        service.pendingChangesLocked(7L);
        assertEquals(1, scheduled.size(), "同项目恢复任务应去重");
        verify(repos, never()).diffNameStatus(anyLong(), anyString(), anyString());
        assertEquals("old-sha", pending.get(7L));

        scheduled.get(0).run();
        verify(repos).diffNameStatus(7L, "new-sha", "old-sha");
    }

    @Test
    void statusFailsPromptlyWhenRepositoryIsBusy() throws Exception {
        var lock = service.repoLock(7L);
        verify(repos).hasLocalRoot(7L);
        clearInvocations(repos);
        lock.lock();
        var executor = Executors.newSingleThreadExecutor();
        try {
            try {
                var failure = executor.submit(() -> assertThrows(VersionException.class,
                        () -> service.pendingChangesLocked(7L))).get(500, TimeUnit.MILLISECONDS);
                assertTrue(failure.isUserFacing());
                assertEquals("VERSION_BUSY", failure.getKind());
                verifyNoInteractions(repos, sessions);
            } finally {
                lock.unlock();
            }
        } finally {
            executor.shutdownNow();
        }
    }
}
