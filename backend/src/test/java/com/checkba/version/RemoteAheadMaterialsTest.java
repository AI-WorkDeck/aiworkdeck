// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.version;

import com.checkba.model.entity.*;
import com.checkba.repository.*;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.*;
import java.util.concurrent.locks.ReentrantLock;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** C23 (lane C nit): 「星禾科技 王经理等 2 人交了新稿」 called client portal materials a 稿; they are counted apart now. */
class RemoteAheadMaterialsTest {
    static VersionEntry entry(String sha, String author, String kind) {
        return new VersionEntry(sha, "m", author, author + "@x", Instant.now(), kind, null, List.of(), null, List.of(), null, List.of());
    }

    @Test
    void clientMaterialsAreNotCountedAsDraftsOrAuthors() {
        ProjectRepoService repo = mock(ProjectRepoService.class);
        ProjectRemoteRepository remotes = mock(ProjectRemoteRepository.class);
        CloudConnectionRepository connections = mock(CloudConnectionRepository.class);
        ProjectRemote remote = new ProjectRemote(); remote.setProjectId(7L); remote.setConnectionId(1L); remote.setRemoteProjectId("5");
        when(remotes.findByProjectId(7L)).thenReturn(Optional.of(remote));
        CloudConnection conn = new CloudConnection(); conn.setId(1L); conn.setServerUrl("https://test.invalid");
        when(connections.findById(1L)).thenReturn(Optional.of(conn));
        when(repo.mainBranch()).thenReturn("master");
        when(repo.originMasterSha(7L)).thenReturn("b".repeat(40));
        when(repo.isAncestor(eq(7L), anyString(), anyString())).thenReturn(false);
        WorkSessionService sessions = mock(WorkSessionService.class);
        when(sessions.repoLock(7L)).thenReturn(new ReentrantLock());
        var cloud = new CloudSyncService(repo, sessions, mock(ProjectTreeManifestService.class), mock(ProjectFileRepository.class),
                connections, remotes, mock(ProjectRepository.class)) {
            @Override protected String httpGet(String url, String token) { return "{\"code\":0,\"data\":[]}"; }
        };

        when(repo.commitsBetween(eq(7L), anyString(), anyString(), anyInt())).thenReturn(List.of(
                entry("1", "星禾科技 王经理", "client-submission"), entry("2", "星禾科技 王经理", "client-submission"),
                entry("3", "沈砚", "session")));
        Map<String, Object> st = cloud.cloudStatus(7L, null);
        assertEquals(1, st.get("remoteAheadCount"), "one 稿, by the partner");
        assertEquals(2, st.get("remoteAheadMaterials"));
        assertEquals(List.of("沈砚"), st.get("remoteAheadAuthors"), "the client is not listed as an author of 稿");

        when(repo.commitsBetween(eq(7L), anyString(), anyString(), anyInt())).thenReturn(List.of(
                entry("4", "星禾科技 王经理", "client-submission")));
        st = cloud.cloudStatus(7L, null);
        assertEquals(0, st.get("remoteAheadCount"));
        assertEquals(1, st.get("remoteAheadMaterials"));
        assertEquals(Boolean.TRUE, st.get("remoteAhead"), "there is still something to pull");
    }
}
