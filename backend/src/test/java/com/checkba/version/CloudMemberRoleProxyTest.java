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

/** C9 desktop proxy: 协作 → 案件参与人 changes a role on the case library and re-reads the viewer's own role. */
class CloudMemberRoleProxyTest {
    ProjectRemoteRepository remotes;
    CloudSyncService cloud;
    final List<String[]> puts = new ArrayList<>();
    String putAnswer = "{\"code\":0}";
    int memberReads;

    @BeforeEach void setup() {
        ProjectRepoService repo = mock(ProjectRepoService.class);
        WorkSessionService sessions = mock(WorkSessionService.class);
        remotes = mock(ProjectRemoteRepository.class);
        CloudConnection conn = new CloudConnection();
        conn.setId(1L); conn.setUserId(42L); conn.setServerUrl("https://test.invalid");
        conn.setUsername("shen"); conn.setDeviceToken("synthetic");
        CloudConnectionRepository connections = mock(CloudConnectionRepository.class);
        when(connections.findById(1L)).thenReturn(Optional.of(conn));
        ProjectRemote remote = new ProjectRemote();
        remote.setProjectId(7L); remote.setConnectionId(1L); remote.setRemoteProjectId("5");
        when(remotes.findByProjectId(7L)).thenReturn(Optional.of(remote));
        when(sessions.repoLock(7L)).thenReturn(new ReentrantLock());
        when(repo.mainBranch()).thenReturn("refs/heads/master");
        cloud = new CloudSyncService(repo, sessions, mock(ProjectTreeManifestService.class), mock(ProjectFileRepository.class),
                connections, remotes, mock(ProjectRepository.class)) {
            @Override protected String httpPut(String url, String body, String token) { puts.add(new String[]{url, body, token}); return putAnswer; }
            @Override protected String httpGet(String url, String token) {
                memberReads++;
                return "{\"code\":0,\"data\":[{\"username\":\"shen\",\"displayName\":\"沈砚\",\"role\":\"OWNER\"}]}";
            }
        };
    }

    @Test void changesTheRoleOnTheCaseLibraryAndDropsTheCachedRole() {
        cloud.checkCloud(7L);
        assertEquals(1, memberReads);
        cloud.proxyMemberRole(7L, 31L, "READ_ONLY");
        assertEquals(1, puts.size());
        assertEquals("https://test.invalid/api/projects/5/members/31/role", puts.get(0)[0]);
        assertTrue(puts.get(0)[1].contains("\"role\":\"READ_ONLY\""), puts.get(0)[1]);
        assertEquals("synthetic", puts.get(0)[2]);
        cloud.checkCloud(7L);
        assertEquals(2, memberReads, "the role cache is dropped, so the next check reads the members again");
    }

    @Test void aRefusalFromTheCaseLibraryReachesTheLawyer() {
        putAnswer = "{\"code\":1,\"message\":\"权限不足：您无法修改该成员的角色\"}";
        VersionException e = assertThrows(VersionException.class, () -> cloud.proxyMemberRole(7L, 31L, "ADMIN"));
        assertTrue(e.getMessage().contains("权限不足"), e.getMessage());
    }
}
