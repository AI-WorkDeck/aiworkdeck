// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.version;

import com.checkba.model.entity.*;
import com.checkba.repository.*;
import org.junit.jupiter.api.*;
import java.util.*;
import java.util.concurrent.locks.ReentrantLock;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * 教程第 11 集：明确「重新连接云端」换了令牌之后，已入库案卷的写门禁要跟着换（不然全卡在
 * 「请明确重新连接」）；还卡着的那份由律师点「重新绑定这份案卷」——先拆本机绑定、再放进去一次。
 */
class CloudSyncRebindTest {
    ProjectRepoService repo;
    WorkSessionService sessions;
    ProjectRemoteRepository remotes;
    CloudConnectionRepository connections;
    CloudSyncService cloud;
    final List<String> httpCalls = new ArrayList<>();

    @BeforeEach void setup() {
        repo = mock(ProjectRepoService.class);
        sessions = mock(WorkSessionService.class);
        remotes = mock(ProjectRemoteRepository.class);
        connections = mock(CloudConnectionRepository.class);
        CloudConnection conn = new CloudConnection();
        conn.setId(1L); conn.setUserId(42L); conn.setServerUrl("https://test.invalid");
        conn.setUsername("awd_me"); conn.setDeviceToken("awdt_new");
        when(connections.findById(1L)).thenReturn(Optional.of(conn));
        when(sessions.repoLock(anyLong())).thenAnswer(i -> new ReentrantLock());
        cloud = new CloudSyncService(repo, sessions, null, null, connections, remotes, mock(ProjectRepository.class)) {
            @Override protected String httpPost(String url, String body, String token) { httpCalls.add(url); return "{\"code\":0}"; }
            @Override protected String httpDelete(String url, String token) { httpCalls.add(url); return "{\"code\":0}"; }
        };
    }

    private static ProjectRemote remote(long projectId, String remoteId) {
        ProjectRemote r = new ProjectRemote();
        r.setProjectId(projectId); r.setConnectionId(1L); r.setRemoteProjectId(remoteId);
        return r;
    }

    @Test void refenceMovesEveryBoundCaseOntoTheNewTokenAndSurvivesOneFailure() {
        when(remotes.findByConnectionId(1L)).thenReturn(List.of(remote(7L, "70"), remote(8L, "80")));
        doThrow(VersionException.cloudReconnectRequired("gone"))
                .when(repo).bindCloudEpoch(eq(7L), any(), any(), any());

        assertDoesNotThrow(() -> cloud.refenceConnectionProjects(1L, 42L));

        verify(repo).bindCloudEpoch(7L, "https://test.invalid/git/70.git", "awd_me", "awdt_new");
        verify(repo).bindCloudEpoch(8L, "https://test.invalid/git/80.git", "awd_me", "awdt_new");
    }

    @Test void refenceIgnoresAConnectionThatIsNotMine() {
        assertThrows(VersionException.class, () -> cloud.refenceConnectionProjects(1L, 99L));
        verify(repo, never()).bindCloudEpoch(anyLong(), any(), any(), any());
    }

    @Test void unbindOnlyDropsTheLocalBindingAndTouchesNothingInTheCloud() {
        ProjectRemote bound = remote(7L, "70");
        when(remotes.findByProjectId(7L)).thenReturn(Optional.of(bound));

        cloud.unbindProject(7L, 42L);

        verify(remotes).delete(bound);
        assertTrue(httpCalls.isEmpty(), "云端那份案卷一个字不动: " + httpCalls);
        verify(repo, never()).bindCloudEpoch(anyLong(), any(), any(), any());
    }

    @Test void unbindIsRefusedWhileChoicesArePending() {
        when(remotes.findByProjectId(7L)).thenReturn(Optional.of(remote(7L, "70")));
        when(repo.repositoryMerging(7L)).thenReturn(true);

        VersionException e = assertThrows(VersionException.class, () -> cloud.unbindProject(7L, 42L));
        assertTrue(e.isUserFacing());
        verify(remotes, never()).delete(any());
    }

    /** 同一个后端上的另一位律师：哪怕对这份案卷有写权限，也拆不了挂在别人连接上的绑定。 */
    @Test void unbindRefusesABindingThatHangsOnSomeoneElsesConnection() {
        when(remotes.findByProjectId(7L)).thenReturn(Optional.of(remote(7L, "70")));

        assertThrows(VersionException.class, () -> cloud.unbindProject(7L, 99L));
        verify(remotes, never()).delete(any());
    }
}
