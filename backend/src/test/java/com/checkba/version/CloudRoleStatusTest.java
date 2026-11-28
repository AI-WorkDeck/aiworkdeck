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

    /**
     * C9 (CEO 11-28, small version): a role changed by the owner reached this member only after the 60 s cache
     * expired, even when the lawyer pressed 「刷新状态」. The explicit refresh reads members fresh; the automatic
     * checks (focus, file open, every 2 min) keep the once-a-minute limit.
     */
    @Test void theExplicitRefreshReadsTheRoleFreshTheAutomaticChecksKeepTheCache() {
        assertEquals("READ_ONLY", cloud.checkCloud(7L).get("myRole"));
        members = members.replace("\"role\":\"READ_ONLY\"", "\"role\":\"EDITOR\"");   // the owner promoted lu
        assertEquals("READ_ONLY", cloud.checkCloud(7L).get("myRole"), "automatic check: cached");
        assertEquals(1, memberCalls);
        assertEquals("EDITOR", cloud.checkCloud(7L, null, true).get("myRole"), "刷新状态: fresh");
        assertEquals(2, memberCalls);
        assertEquals("EDITOR", cloud.checkCloud(7L).get("myRole"), "and the cache holds the fresh answer");
        assertEquals(2, memberCalls);
    }

    @Test void fetchRefusedMeansRemovedWithOwnerNameNotOffline() {
        cloud.checkCloud(7L); // remember the owner while still a member
        doThrow(new VersionException("从云端更新失败", new RuntimeException("https://test.invalid/git/5.git: git-upload-pack not permitted")))
                .when(repo).fetchOriginForCheck(eq(7L), any(), any());
        Map<String, Object> st = cloud.checkCloud(7L);
        assertEquals(Boolean.TRUE, st.get("removed"));
        assertNull(st.get("offline"));
        assertEquals("沈律师", st.get("ownerName"));
    }

    @Test void networkFailureStaysOffline() {
        doThrow(new VersionException("从云端更新失败", new java.net.ConnectException("Connection refused")))
                .when(repo).fetchOriginForCheck(eq(7L), any(), any());
        Map<String, Object> st = cloud.checkCloud(7L);
        assertEquals(Boolean.TRUE, st.get("offline"));
        assertNull(st.get("removed"));
    }

    @Test void accessRefusedClassification() {
        assertTrue(CloudSyncService.isAccessRefused(new RuntimeException("x", new RuntimeException("git-receive-pack not permitted on 'x'"))));
        assertTrue(CloudSyncService.isAccessRefused(new RuntimeException("401 Unauthorized")));
        assertFalse(CloudSyncService.isAccessRefused(new RuntimeException("Connection reset")));
    }

    /**
     * 0.91.0 gate (lane C, master c1cb22412): with pending local commits, the page re-reads this local
     * snapshot every 15 s and after each action. It used to drop myRole/removed, so the read-only notice and
     * 「你已不在这份案卷里」 vanished and 交稿 came back. The local status now carries the last observation.
     */
    @Test void localStatusKeepsTheLastObservedReadOnlyRoleWithPendingCommits() {
        remote.setPendingUpload(true);
        assertNull(cloud.cloudStatus(7L, 42L).get("myRole"), "nothing observed yet");
        cloud.checkCloud(7L);
        Map<String, Object> local = cloud.cloudStatus(7L, 42L);
        assertEquals(Boolean.TRUE, local.get("pendingUpload"));
        assertEquals("READ_ONLY", local.get("myRole"));
        assertEquals("沈律师", local.get("ownerName"));
    }

    @Test void localStatusKeepsRemovedUntilTheLibraryIsReadableAgain() {
        remote.setPendingUpload(true);
        cloud.checkCloud(7L);
        doThrow(new VersionException("从云端更新失败", new RuntimeException("git-upload-pack not permitted")))
                .when(repo).fetchOriginForCheck(eq(7L), any(), any());
        cloud.checkCloud(7L);
        Map<String, Object> local = cloud.cloudStatus(7L, 42L);
        assertEquals(Boolean.TRUE, local.get("removed"));
        assertEquals("沈律师", local.get("ownerName"));
        assertNull(local.get("myRole"), "a removed member has no role to show");

        doReturn(null).when(repo).fetchOriginForCheck(eq(7L), any(), any()); // re-added: readable again
        cloud.checkCloud(7L);
        assertNull(cloud.cloudStatus(7L, 42L).get("removed"));
    }

    @Test void ownerIsTheRowMarkedOwnerEvenWhenItsRoleIsAdmin() {
        members = "{\"code\":0,\"data\":[{\"username\":\"awd_partner\",\"displayName\":\"沈砚\",\"role\":\"ADMIN\",\"owner\":true},"
                + "{\"username\":\"lu\",\"displayName\":\"陆知微\",\"role\":\"MEMBER\",\"owner\":false}]}";
        Map<String, Object> st = cloud.checkCloud(7L);
        assertEquals("MEMBER", st.get("myRole"));
        assertEquals("沈砚", st.get("ownerName"));
    }
}

