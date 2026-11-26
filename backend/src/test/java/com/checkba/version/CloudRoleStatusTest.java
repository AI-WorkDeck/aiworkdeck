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
 * Lane C S2 (C8/C10): the online cloud check tells the desktop the member's own role and the owner's
 * name, so a read-only member opens read-only; a git "not permitted" on fetch means removed, not
 * offline; a push refused for permission says so instead of 「稍后还可以再交」.
 */
class CloudRoleStatusTest {
    ProjectRepoService repo;
    WorkSessionService sessions;
    ProjectRemoteRepository remotes;
    CloudSyncService cloud;
    ProjectRemote remote;
    int memberCalls;
    String members = "{\"code\":0,\"data\":[{\"username\":\"shen\",\"displayName\":\"沈律师\",\"role\":\"OWNER\"},"
            + "{\"username\":\"lu\",\"displayName\":\"陆知微\",\"role\":\"READ_ONLY\"}]}";

    @BeforeEach void setup() {
        repo = mock(ProjectRepoService.class);
        sessions = mock(WorkSessionService.class);
        remotes = mock(ProjectRemoteRepository.class);
        CloudConnection conn = new CloudConnection();
        conn.setId(1L); conn.setUserId(42L); conn.setServerUrl("https://test.invalid");
        conn.setUsername("lu"); conn.setDeviceToken("synthetic");
        CloudConnectionRepository connections = mock(CloudConnectionRepository.class);
        when(connections.findById(1L)).thenReturn(Optional.of(conn));
        remote = new ProjectRemote();
        remote.setProjectId(7L); remote.setConnectionId(1L); remote.setRemoteProjectId("5");
        when(remotes.findByProjectId(7L)).thenReturn(Optional.of(remote));
        when(sessions.repoLock(7L)).thenReturn(new ReentrantLock());
        when(repo.mainBranch()).thenReturn("refs/heads/master");
        cloud = new CloudSyncService(repo, sessions, mock(ProjectTreeManifestService.class), mock(ProjectFileRepository.class),
                connections, remotes, mock(ProjectRepository.class)) {
            @Override protected String httpGet(String url, String token) {
                assertEquals("https://test.invalid/api/projects/5/members", url);
                memberCalls++;
                return members;
            }
        };
    }

    @Test void onlineCheckReportsMyRoleAndOwnerAndCachesIt() {
        Map<String, Object> st = cloud.checkCloud(7L);
        assertEquals("READ_ONLY", st.get("myRole"));
        assertEquals("沈律师", st.get("ownerName"));
        cloud.checkCloud(7L);
        assertEquals(1, memberCalls, "members are read at most once a minute");
    }

    @Test void fetchRefusedMeansRemovedWithOwnerNameNotOffline() {
        cloud.checkCloud(7L); // remember the owner while still a member
        doThrow(new VersionException("从云端更新失败", new RuntimeException("https://test.invalid/git/5.git: git-upload-pack not permitted")))
                .when(repo).fetchFromOrigin(eq(7L), any(), any());
        Map<String, Object> st = cloud.checkCloud(7L);
        assertEquals(Boolean.TRUE, st.get("removed"));
        assertNull(st.get("offline"));
        assertEquals("沈律师", st.get("ownerName"));
    }

    @Test void networkFailureStaysOffline() {
        doThrow(new VersionException("从云端更新失败", new java.net.ConnectException("Connection refused")))
                .when(repo).fetchFromOrigin(eq(7L), any(), any());
        Map<String, Object> st = cloud.checkCloud(7L);
        assertEquals(Boolean.TRUE, st.get("offline"));
        assertNull(st.get("removed"));
    }

    @Test void accessRefusedClassification() {
        assertTrue(CloudSyncService.isAccessRefused(new RuntimeException("x", new RuntimeException("git-receive-pack not permitted on 'x'"))));
        assertTrue(CloudSyncService.isAccessRefused(new RuntimeException("401 Unauthorized")));
        assertFalse(CloudSyncService.isAccessRefused(new RuntimeException("Connection reset")));
    }
}
