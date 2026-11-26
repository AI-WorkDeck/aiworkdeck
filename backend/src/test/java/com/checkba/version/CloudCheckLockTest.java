// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.version;

import com.checkba.model.entity.*;
import com.checkba.repository.*;
import org.junit.jupiter.api.*;
import java.util.*;
import java.util.concurrent.locks.ReentrantLock;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;

/**
 * C24 (lane C thread dump): the routine cloud check ran its JGit fetch while holding the shared repo lock. On a
 * link saturated by a large backup upload even the TLS handshake stalled for minutes, and every version call
 * (status, save, 交稿) answered 「正在整理版本」 meanwhile. The network work now runs without the lock; only the
 * quick local steps take it, and an open merge window still never sees origin/master move.
 */
class CloudCheckLockTest {
    ProjectRepoService repo;
    WorkSessionService sessions;
    CloudSyncService cloud;
    final ReentrantLock lock = new ReentrantLock();
    final List<String> steps = new ArrayList<>();

    @BeforeEach void setup() {
        repo = mock(ProjectRepoService.class);
        sessions = mock(WorkSessionService.class);
        ProjectRemoteRepository remotes = mock(ProjectRemoteRepository.class);
        CloudConnection conn = new CloudConnection();
        conn.setId(1L); conn.setUserId(42L); conn.setServerUrl("https://test.invalid");
        conn.setUsername("lu"); conn.setDeviceToken("synthetic");
        CloudConnectionRepository connections = mock(CloudConnectionRepository.class);
        when(connections.findById(1L)).thenReturn(Optional.of(conn));
        ProjectRemote remote = new ProjectRemote();
        remote.setProjectId(7L); remote.setConnectionId(1L); remote.setRemoteProjectId("5");
        when(remotes.findByProjectId(7L)).thenReturn(Optional.of(remote));
        when(sessions.repoLock(7L)).thenReturn(lock);
        when(repo.mainBranch()).thenReturn("refs/heads/master");
        cloud = new CloudSyncService(repo, sessions, mock(ProjectTreeManifestService.class), mock(ProjectFileRepository.class),
                connections, remotes, mock(ProjectRepository.class)) {
            @Override protected String httpGet(String url, String token) {
                assertFalse(lock.isLocked(), "the member lookup is network work: no repo lock");
                steps.add("members");
                return "{\"code\":0,\"data\":[]}";
            }
        };
    }

    @Test void theFetchRunsWithoutTheRepoLockAndOnlyThePublishTakesIt() {
        when(repo.fetchOriginForCheck(eq(7L), any(), any())).thenAnswer(i -> {
            assertFalse(lock.isLocked(), "a stalled fetch must not lock out every version action");
            steps.add("fetch");
            return "abc";
        });
        doAnswer(i -> { assertTrue(lock.isHeldByCurrentThread(), "origin/master moves under the lock"); steps.add("publish"); return null; })
                .when(repo).publishCheckedOrigin(7L, "abc");
        Map<String, Object> st = cloud.checkCloud(7L);
        assertNull(st.get("offline"));
        assertEquals(List.of("fetch", "publish", "members"), steps);
        assertFalse(lock.isLocked());
    }

    @Test void aMergeWindowThatOpensDuringTheFetchKeepsOriginMasterWhereItWas() {
        when(repo.repositoryMerging(7L)).thenReturn(false, true);
        when(repo.fetchOriginForCheck(eq(7L), any(), any())).thenReturn("abc");
        Map<String, Object> st = cloud.checkCloud(7L);
        assertEquals(true, st.get("merging"));
        verify(repo, never()).publishCheckedOrigin(anyLong(), any());
    }

    @Test void aFailedFetchStillAnswersOfflineWithoutHoldingTheLock() {
        when(repo.fetchOriginForCheck(eq(7L), any(), any())).thenAnswer(i -> {
            assertFalse(lock.isLocked());
            throw new VersionException("从云端更新失败: project=7", new java.io.IOException("handshake timed out"));
        });
        assertEquals(true, cloud.checkCloud(7L).get("offline"));
        verify(repo, never()).publishCheckedOrigin(anyLong(), any());
    }
}
