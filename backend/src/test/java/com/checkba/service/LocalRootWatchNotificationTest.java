// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service;

import com.checkba.repository.ProjectRepository;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.*;

class LocalRootWatchNotificationTest {
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
