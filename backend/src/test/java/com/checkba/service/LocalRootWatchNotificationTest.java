// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service;

import com.checkba.repository.ProjectRepository;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class LocalRootWatchNotificationTest {
    enum StopAction { STOP, DELETE, SHUTDOWN }

    private void awaitReleaseIgnoringInterruption(CountDownLatch release) {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
        while (release.getCount() != 0 && System.nanoTime() < deadline) {
            try { release.await(100, TimeUnit.MILLISECONDS); } catch (InterruptedException ignored) { }
        }
        assertEquals(0, release.getCount());
    }

    @ParameterizedTest
    @EnumSource(StopAction.class)
    void slowNotificationDoesNotBlockLifecycle(StopAction action) throws Exception {
        var projects = mock(LocalProjectService.class);
        var changes = mock(LocalProjectFileChangeService.class);
        var service = new LocalRootWatchService(mock(ProjectRepository.class), projects, changes);
        var notifying = new CountDownLatch(1);
        var release = new CountDownLatch(1);
        when(projects.reconcileProject(7L)).thenReturn(new LocalProjectService.ReconcileResult(1, false, false, 0, false));
        doAnswer(call -> {
            notifying.countDown();
            awaitReleaseIgnoringInterruption(release);
            return null;
        }).when(changes).filesChanged(7L);
        var caller = Executors.newSingleThreadExecutor();
        try {
            ReflectionTestUtils.invokeMethod(service, "scheduleReconcile", 7L);
            assertTrue(notifying.await(3, TimeUnit.SECONDS));
            var stopped = caller.submit(() -> {
                switch (action) {
                    case STOP -> service.stopWatch(7L);
                    case DELETE -> service.onProjectDeleted(new ProjectService.ProjectDeletedEvent(7L));
                    case SHUTDOWN -> service.shutdown();
                }
            });
            assertDoesNotThrow(() -> stopped.get(500, TimeUnit.MILLISECONDS),
                    "Lifecycle must not wait for permission checks or SSE delivery");
            assertEquals(1, release.getCount());
            assertFalse(service.isWatching(7L));
        } finally {
            release.countDown();
            service.shutdown();
            caller.shutdownNow();
        }
    }

    @Test
    void oldMissingRootResultDoesNotStopReopenedWatcher(@TempDir Path root) throws Exception {
        var projects = mock(LocalProjectService.class);
        var changes = mock(LocalProjectFileChangeService.class);
        var service = new LocalRootWatchService(mock(ProjectRepository.class), projects, changes);
        var notifying = new CountDownLatch(1);
        var release = new CountDownLatch(1);
        when(projects.reconcileProject(7L)).thenReturn(new LocalProjectService.ReconcileResult(1, true, false, 0, false));
        doAnswer(call -> {
            notifying.countDown();
            awaitReleaseIgnoringInterruption(release);
            return null;
        }).when(changes).filesChanged(7L);
        var caller = Executors.newSingleThreadExecutor();
        try {
            assertTrue(service.ensureWatch(7L, root.toString()));
            ReflectionTestUtils.invokeMethod(service, "scheduleReconcile", 7L);
            assertTrue(notifying.await(3, TimeUnit.SECONDS));
            var reopened = caller.submit(() -> {
                service.stopWatch(7L);
                return service.ensureWatch(7L, root.toString());
            });
            assertTrue(reopened.get(500, TimeUnit.MILLISECONDS));
            release.countDown();
            var executor = (java.util.concurrent.ScheduledExecutorService)
                    ReflectionTestUtils.getField(service, "executor");
            executor.submit(() -> {}).get(5, TimeUnit.SECONDS);
            assertTrue(service.isWatching(7L), "An old reconcile result must not close a new watcher");
        } finally {
            release.countDown();
            service.shutdown();
            caller.shutdownNow();
        }
    }

    @Test
    void notifiesOnlyAfterChangedReconcileReturns() throws Exception {
        var projects = mock(LocalProjectService.class);
        var changes = mock(LocalProjectFileChangeService.class);
        var service = new LocalRootWatchService(mock(ProjectRepository.class), projects, changes);
        var started = new CountDownLatch(1);
        var finish = new CountDownLatch(1);
        when(projects.reconcileProject(7L)).thenAnswer(call -> {
            started.countDown();
            assertTrue(finish.await(5, TimeUnit.SECONDS));
            return new LocalProjectService.ReconcileResult(2, false, false, 0, false);
        });
        try {
            ReflectionTestUtils.invokeMethod(service, "scheduleReconcile", 7L);
            assertTrue(started.await(3, TimeUnit.SECONDS));
            verifyNoInteractions(changes);
            finish.countDown();
            verify(changes, timeout(2000)).filesChanged(7L);
            verifyNoMoreInteractions(changes);
        } finally {
            finish.countDown();
            service.shutdown();
        }
    }

    @Test
    void noOpMissingRootAndFailureNeverNotify() throws Exception {
        var projects = mock(LocalProjectService.class);
        var changes = mock(LocalProjectFileChangeService.class);
        var service = new LocalRootWatchService(mock(ProjectRepository.class), projects, changes);
        when(projects.reconcileProject(1L)).thenReturn(new LocalProjectService.ReconcileResult(0, false, false, 0, false));
        when(projects.reconcileProject(2L)).thenReturn(new LocalProjectService.ReconcileResult(0, true, false, 0, false));
        when(projects.reconcileProject(3L)).thenThrow(new IllegalStateException("synthetic failure"));
        try {
            var scheduled = new java.util.ArrayList<java.util.concurrent.Future<?>>();
            for (long id = 1; id <= 3; id++) {
                ReflectionTestUtils.invokeMethod(service, "scheduleReconcile", id);
                var pending = (java.util.Map<?, ?>) ReflectionTestUtils.getField(service, "pending");
                scheduled.add((java.util.concurrent.Future<?>) pending.get(id));
            }
            for (var task : scheduled) task.get(3, TimeUnit.SECONDS);
            verify(projects).reconcileProject(3L);
            verifyNoInteractions(changes);
        } finally {
            service.shutdown();
        }
    }
}
