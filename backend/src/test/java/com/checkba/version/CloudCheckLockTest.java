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

    /** A library that accepts the connection and then says nothing (a stalled handshake / saturated link). */
    static java.net.ServerSocket silentServer(long holdMillis) throws Exception {
        var server = new java.net.ServerSocket(0, 50, java.net.InetAddress.getLoopbackAddress());
        Thread t = new Thread(() -> {
            try { while (!server.isClosed()) { var c = server.accept(); Thread.sleep(holdMillis); c.close(); } }
            catch (Exception ignored) { }
        }, "c24-silent-library");
        t.setDaemon(true); t.start();
        return server;
    }

    /**
     * Real repository, real fetch against a library that stalls: while the fetch hangs, the repo lock is free,
     * so status / save / 交稿 go on; the check then falls back to offline. Red on the old checkCloud (it fetched
     * under the lock): this is the lock-out lane C's thread dump showed, reproduced with a real JGit fetch.
     */
    @Test void aStalledLibraryNeverHoldsTheRepoLock(@org.junit.jupiter.api.io.TempDir java.nio.file.Path tmp) throws Exception {
        var props = new com.checkba.storage.StorageProperties(); props.getLocal().setRootPath(tmp.toString());
        ProjectRepoService real = new ProjectRepoService(new com.checkba.storage.ProjectStorageResolver(props, null));
        java.nio.file.Files.createDirectories(real.workTree(7));
        java.nio.file.Files.writeString(real.workTree(7).resolve("说明.txt"), "第一版");
        real.init(7, "Synthetic", "s@example.test");
        try (var server = silentServer(2500)) {
            real.setRemoteOrigin(7, "http://127.0.0.1:" + server.getLocalPort() + "/git/5.git");
            cloud = new CloudSyncService(real, sessions, mock(ProjectTreeManifestService.class), mock(ProjectFileRepository.class),
                    connectionsFor(), remotesFor(), mock(ProjectRepository.class)) {
                @Override protected String httpGet(String url, String token) { return "{\"code\":0,\"data\":[]}"; }
            };
            var result = java.util.concurrent.CompletableFuture.supplyAsync(() -> cloud.checkCloud(7L));
            Thread.sleep(1000); // the fetch is now waiting on the silent library
            assertFalse(result.isDone(), "precondition: the check is stuck on the network");
            assertTrue(lock.tryLock(), "version actions can take the repo lock while the check waits on the network");
            lock.unlock();
            assertEquals(true, result.get(30, java.util.concurrent.TimeUnit.SECONDS).get("offline"));
        }
    }

    /**
     * Why a 60 s fetch timeout still allowed a 7-minute lock-out: JGit's timeout is a per-read socket timeout, and
     * every byte that arrives restarts it. A library answer that trickles in (a saturated link) keeps one fetch
     * going far past the timeout. Here: 1 s timeout, one byte every 250 ms for ~4 s: the call lasts over 3 s (lane C's link: minutes).
     */
    @Test void aTricklingAnswerOutlastsTheFetchTimeout() throws Exception {
        String reply = "HTTP/1.1 200 OK\r\nContent-Type: application/x-git-upload-pack-advertisement\r\nX-Pad: " + "x".repeat(14) + "\r\n\r\n";
        try (var server = new java.net.ServerSocket(0, 50, java.net.InetAddress.getLoopbackAddress())) {
            Thread t = new Thread(() -> {
                try (var c = server.accept(); var out = c.getOutputStream()) {
                    byte[] bytes = reply.getBytes(java.nio.charset.StandardCharsets.US_ASCII);
                    for (int i = 0; i < 16; i++) { out.write(bytes[i]); out.flush(); Thread.sleep(250); } // ~4 s, then hang up
                } catch (Exception ignored) { }
            }, "c24-trickling-library");
            t.setDaemon(true); t.start();
            long start = System.nanoTime();
            assertThrows(Exception.class, () -> org.eclipse.jgit.api.Git.lsRemoteRepository()
                    .setRemote("http://127.0.0.1:" + server.getLocalPort() + "/git/5.git").setTimeout(1).call());
            long seconds = (System.nanoTime() - start) / 1_000_000_000L;
            assertTrue(seconds >= 3, "one call outlived its 1 s timeout by trickling: " + seconds + " s");
        }
    }

    CloudConnectionRepository connectionsFor() {
        CloudConnection conn = new CloudConnection();
        conn.setId(1L); conn.setUserId(42L); conn.setServerUrl("https://test.invalid");
        conn.setUsername("lu"); conn.setDeviceToken("synthetic");
        CloudConnectionRepository connections = mock(CloudConnectionRepository.class);
        when(connections.findById(1L)).thenReturn(Optional.of(conn));
        return connections;
    }

    ProjectRemoteRepository remotesFor() {
        ProjectRemote remote = new ProjectRemote();
        remote.setProjectId(7L); remote.setConnectionId(1L); remote.setRemoteProjectId("5");
        ProjectRemoteRepository remotes = mock(ProjectRemoteRepository.class);
        when(remotes.findByProjectId(7L)).thenReturn(Optional.of(remote));
        return remotes;
    }
}
