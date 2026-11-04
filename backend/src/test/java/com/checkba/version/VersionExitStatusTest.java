// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.version;

import com.checkba.controller.AuthController;
import com.checkba.service.ProjectMemberService;
import org.junit.jupiter.api.Test;
import java.util.Map;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class VersionExitStatusTest {
    @Test
    void disabledConflictAndDraftSummariesAvoidUnneededWork() {
        var repo = mock(ProjectRepoService.class);
        var sessions = mock(WorkSessionRepository.class);
        var scheduler = mock(org.springframework.scheduling.TaskScheduler.class);
        var service = new WorkSessionService(repo, null, sessions, scheduler, null, event -> {});
        assertFalse(service.exitStatus(7L).enabled());
        verify(repo, never()).pendingChanges(anyLong());
        when(repo.isInitialized(7L)).thenReturn(true);
        when(repo.currentBranch(7L)).thenReturn("draft/1");
        var draft = new WorkSession();
        draft.setId(2L); draft.setBranchName("draft/1"); draft.setTitle("draft");
        when(sessions.findByProjectIdAndStatusAndSessionTypeOrderByStartedAtDesc(
                7L, WorkSession.Status.ACTIVE, WorkSession.SessionType.DRAFT)).thenReturn(java.util.List.of(draft));
        when(repo.repositoryMerging(7L)).thenReturn(true);
        var conflict = service.exitStatus(7L);
        assertTrue(conflict.conflict());
        assertSame(draft, conflict.onDraft());
        verify(repo, never()).pendingChanges(anyLong());
        when(repo.repositoryMerging(7L)).thenReturn(false);
        when(repo.pendingChanges(7L)).thenReturn(java.util.List.of(
                new FileChange("file.txt", FileChange.Type.MODIFY), new FileChange(".awd/tree.json", FileChange.Type.MODIFY)));
        var status = service.exitStatus(7L);
        assertFalse(status.working());
        assertEquals(1, status.changedCount());
        verify(repo, never()).diffNameStatus(anyLong(), anyString(), anyString());
        verify(repo, never()).repoSizeBytes(anyLong());
        verifyNoInteractions(scheduler);
    }

    @Test
    void busyRepositoryFailsFastInsteadOfClaimingThereAreNoChanges() throws Exception {
        var repo = mock(ProjectRepoService.class);
        var service = new WorkSessionService(repo, null, mock(WorkSessionRepository.class),
                mock(org.springframework.scheduling.TaskScheduler.class), null, event -> {});
        var ready = new java.util.concurrent.CountDownLatch(1);
        var release = new java.util.concurrent.CountDownLatch(1);
        Thread holder = new Thread(() -> {
            var lock = service.repoLock(7L);
            lock.lock();
            try { ready.countDown(); release.await(); }
            catch (InterruptedException e) { Thread.currentThread().interrupt(); }
            finally { lock.unlock(); }
        });
        holder.start();
        try {
            assertTrue(ready.await(2, java.util.concurrent.TimeUnit.SECONDS));
            assertTimeoutPreemptively(java.time.Duration.ofSeconds(1),
                    () -> assertThrows(VersionException.class, () -> service.exitStatus(7L)));
            verify(repo, never()).pendingChanges(anyLong());
        } finally { release.countDown(); holder.join(2000); }
    }

    @Test
    void summaryDoesNotReadDiskUsageCloudOrConflictDocuments() {
        var repo = mock(ProjectRepoService.class);
        var sessions = mock(WorkSessionService.class);
        var members = mock(ProjectMemberService.class);
        var controller = new VersionController(repo, sessions, members, null, null, null, null);
        try (var auth = mockStatic(AuthController.class)) {
            auth.when(() -> AuthController.getUserIdFromSession("session")).thenReturn(1L);
            when(members.hasReadPermission(7L, 1L)).thenReturn(true);
            when(members.hasWritePermission(7L, 1L)).thenReturn(true);
            when(sessions.exitStatus(7L)).thenReturn(new WorkSessionService.ExitStatus(true, true, 3, null, false));
            Map<?, ?> data = (Map<?, ?>) controller.exitStatus(7L, "session").getBody().get("data");
            assertEquals(3L, data.get("changedCount"));
            assertEquals(true, data.get("canCommit"));
            assertFalse(data.containsKey("repoSizeBytes"));
            verifyNoInteractions(repo);
            verify(sessions).exitStatus(7L);
            verifyNoMoreInteractions(sessions);

            when(sessions.exitStatus(7L)).thenReturn(new WorkSessionService.ExitStatus(true, true, 0, null, true));
            data = (Map<?, ?>) controller.exitStatus(7L, "session").getBody().get("data");
            assertEquals(true, data.get("conflict"));
            assertEquals(false, data.get("canCommit"));
            when(sessions.exitStatus(7L)).thenReturn(new WorkSessionService.ExitStatus(true, false, 0, null, false));
            data = (Map<?, ?>) controller.exitStatus(7L, "session").getBody().get("data");
            assertEquals(false, data.get("canCommit"));
            when(members.hasWritePermission(7L, 1L)).thenReturn(false);
            when(sessions.exitStatus(7L)).thenReturn(new WorkSessionService.ExitStatus(true, true, 3, null, false));
            data = (Map<?, ?>) controller.exitStatus(7L, "session").getBody().get("data");
            assertEquals(false, data.get("canCommit"));
            when(members.isClient(7L, 1L)).thenReturn(true);
            assertThrows(IllegalArgumentException.class, () -> controller.exitStatus(7L, "session"));
        }
    }
}
