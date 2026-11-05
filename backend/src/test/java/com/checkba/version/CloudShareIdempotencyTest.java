// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.version;

import cn.hutool.json.JSONUtil;
import com.checkba.model.entity.*;
import com.checkba.repository.*;
import org.junit.jupiter.api.*;
import java.util.*;
import java.util.concurrent.locks.ReentrantLock;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

/** shareToCloud 的建项目 POST 超时后重试，必须带同一个 clientRequestId，让服务端去重而不是再造一个云端项目。 */
class CloudShareIdempotencyTest {
    final List<String> createBodies = new ArrayList<>();
    boolean timeoutOnCreate = true;
    CloudSyncService cloud;

    @BeforeEach void setup() {
        ProjectRepoService repo = mock(ProjectRepoService.class);
        WorkSessionService sessions = mock(WorkSessionService.class);
        ProjectRemoteRepository remotes = mock(ProjectRemoteRepository.class);
        ProjectRepository projects = mock(ProjectRepository.class);
        CloudConnectionRepository connections = mock(CloudConnectionRepository.class);
        CloudConnection conn = new CloudConnection();
        conn.setId(1L); conn.setUserId(42L); conn.setServerUrl("https://test.invalid"); conn.setDeviceToken("tok");
        when(connections.findById(1L)).thenReturn(Optional.of(conn));
        when(sessions.repoLock(7L)).thenReturn(new ReentrantLock());
        when(repo.isInitialized(7L)).thenReturn(true);
        when(remotes.findByProjectId(7L)).thenReturn(Optional.empty());
        cloud = new CloudSyncService(repo, sessions, null, null, connections, remotes, projects) {
            @Override protected String httpPost(String url, String body, String token) {
                if (url.endsWith("/api/projects")) {
                    createBodies.add(body);
                    if (timeoutOnCreate) throw new IllegalStateException("云端不可达: Read timed out");
                    return "{\"id\":55}";
                }
                throw new IllegalStateException("stop after create");
            }
            @Override protected String httpDelete(String url, String token) { return "{\"code\":0}"; }
        };
    }

    private static String idOf(String body) { return JSONUtil.parseObj(body).getStr("clientRequestId"); }

    @Test void retryAfterCreateTimeoutReusesTheSameClientRequestId() {
        assertThrows(RuntimeException.class, () -> cloud.shareToCloud(7L, 1L, 42L));
        timeoutOnCreate = false;
        assertThrows(RuntimeException.class, () -> cloud.shareToCloud(7L, 1L, 42L));
        assertEquals(2, createBodies.size());
        assertNotNull(idOf(createBodies.get(0)));
        assertEquals(idOf(createBodies.get(0)), idOf(createBodies.get(1)));
    }

    @Test void afterCreateAnsweredANewAttemptGetsAFreshId() {
        timeoutOnCreate = false;
        assertThrows(RuntimeException.class, () -> cloud.shareToCloud(7L, 1L, 42L));
        assertThrows(RuntimeException.class, () -> cloud.shareToCloud(7L, 1L, 42L));
        assertNotEquals(idOf(createBodies.get(0)), idOf(createBodies.get(1)));
    }
}
