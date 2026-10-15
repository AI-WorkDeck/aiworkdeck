// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.version;

import com.checkba.model.entity.*;
import com.checkba.repository.*;
import com.checkba.version.objects.LocalVersionObjectStore;
import com.checkba.version.cloud.GitAccessService;
import com.checkba.version.cloud.GitAccessDeniedException;
import com.checkba.service.DeviceTokenService;
import com.checkba.service.ProjectMemberService;
import jakarta.servlet.http.HttpServletRequest;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.NullSource;
import org.junit.jupiter.params.provider.ValueSource;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.locks.ReentrantLock;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;

class CloudCloneReadOnlyTest {
    @TempDir Path temp;
    ProjectRepoService repo;
    WorkSessionService sessions;
    ProjectTreeManifestService manifests;
    ProjectRepository projects;
    ProjectRemoteRepository remotes;
    CloudSyncService cloud;
    String role = "READ_ONLY";
    boolean prepareAllowed;
    int posts;
    TreeManifest current;
    @BeforeEach void setup() {
        repo = mock(ProjectRepoService.class);
        sessions = mock(WorkSessionService.class);
        manifests = mock(ProjectTreeManifestService.class);
        projects = mock(ProjectRepository.class);
        remotes = mock(ProjectRemoteRepository.class);
        CloudConnection conn = new CloudConnection();
        conn.setId(1L); conn.setUserId(42L); conn.setServerUrl("https://test.invalid");
        conn.setUsername("qa"); conn.setDeviceToken("synthetic");
        CloudConnectionRepository connections = mock(CloudConnectionRepository.class);
        when(connections.findById(1L)).thenReturn(Optional.of(conn));
        when(remotes.findByConnectionIdAndRemoteProjectId(1L,"5")).thenReturn(Optional.empty());
        when(projects.save(any(Project.class))).thenAnswer(i -> { Project p=i.getArgument(0);p.setId(77L);return p;});
        when(sessions.repoLock(77L)).thenReturn(new ReentrantLock());
        when(repo.mainBranch()).thenReturn("refs/heads/master");
        when(repo.resolveRef(77L,"refs/heads/master")).thenReturn("ready-head");
        when(repo.gitDir(77L)).thenReturn(temp.resolve("git"));
        when(repo.workTree(77L)).thenReturn(temp.resolve("work"));
        when(repo.objects()).thenReturn(mock(LocalVersionObjectStore.class));
        current=new TreeManifest(2,List.of());
        when(manifests.readAtRef(77L,"HEAD")).thenAnswer(i -> current);
        cloud=new CloudSyncService(repo,sessions,manifests,mock(ProjectFileRepository.class),connections,remotes,projects) {
            @Override protected String httpGet(String url,String token) {
                assertEquals("https://test.invalid/api/projects/my",url);
                assertEquals("synthetic",token);
                return "[{\"id\":5,\"name\":\"QA case\""+(role==null?"":",\"myRole\":\""+role+"\"")+"}]";
            }
            @Override protected String httpPost(String url,String body,String token) {
                posts++;
                assertTrue(url.endsWith("/5/version/prepare-remote"));
                if (!prepareAllowed) return "{\"code\":1,\"message\":\"无权修改该项目\"}";
                current=new TreeManifest(2,List.of());
                return "{\"code\":0}";
            }
        };
    }
    @Test
    void readonlyCloneNeverPreparesRemote() {
        Map<String,Object> result=cloud.cloneFromCloud(1L,5L,42L);
        assertEquals(77L,result.get("localProjectId"));
        assertEquals(0,posts);
        verify(repo).cloneFromRemote(eq(77L),eq("https://test.invalid/git/5.git"),eq("qa"),eq("synthetic"),any(Runnable.class));
        verify(manifests).applyToDatabase(77L,current);
        verify(remotes).save(argThat(r -> !r.getPendingUpload() && "ready-head".equals(r.getLastSyncSha())));
    }
    @ParameterizedTest
    @NullSource
    @ValueSource(strings={"CLIENT", "FUTURE_ROLE"})
    void untrustedRoleSnapshotDoesNotBypassServerReadAuthorization(String value) {
        role = value;
        DeviceTokenService tokens = mock(DeviceTokenService.class);
        ProjectMemberService members = mock(ProjectMemberService.class);
        when(tokens.resolve("synthetic")).thenReturn(new DeviceTokenService.ResolvedToken(42L, 9L));
        // CLIENT can have ordinary project read permission yet must never read Git.
        when(members.isClient(5L, 42L)).thenReturn("CLIENT".equals(value));
        when(members.hasReadPermission(5L, 42L)).thenReturn("CLIENT".equals(value));
        GitAccessService access = new GitAccessService(tokens, members);
        HttpServletRequest request = mock(HttpServletRequest.class);
        when(request.getHeader("Authorization")).thenReturn("Basic " + Base64.getEncoder()
                .encodeToString("qa:synthetic".getBytes(StandardCharsets.UTF_8)));
        doAnswer(call -> {
            access.authorize(request, 5L, false);
            fail("The server must reject this Git read");
            return null;
        }).when(repo).cloneFromRemote(eq(77L), anyString(), anyString(), anyString(), any(Runnable.class));

        GitAccessDeniedException denied = assertThrows(GitAccessDeniedException.class,
                () -> cloud.cloneFromCloud(1L, 5L, 42L));
        assertEquals(403, denied.statusCode());
        assertEquals(0, posts);
        verify(projects).delete(any(Project.class));
        verifyNoInteractions(manifests);
        verify(remotes, never()).save(any());
    }

    @ParameterizedTest @ValueSource(strings={"ADMIN","PARTICIPANT","OWNER"})
    void writersRetainLegacyPreparation(String value) {
        role=value;prepareAllowed=true;current=new TreeManifest(1,List.of());
        cloud.cloneFromCloud(1L,5L,42L);
        assertEquals(1,posts);
        verify(manifests).applyToDatabase(77L,current);
        assertEquals(2,current.version());
    }
    @Test void staleWriterRoleStillRequiresServerPermission() {
        role="PARTICIPANT";
        assertThrows(VersionException.class,()->cloud.cloneFromCloud(1L,5L,42L));
        assertEquals(1,posts);verify(projects,never()).save(any());verifyNoInteractions(manifests);
    }
    @ParameterizedTest @ValueSource(ints={0,1})
    void readonlyLegacyOrMissingManifestRefusesAndCleansUp(int version) throws Exception {
        current=version==0?null:new TreeManifest(version,List.of());
        Files.createDirectories(temp.resolve("git"));Files.createDirectories(temp.resolve("work"));
        Files.writeString(temp.resolve("work/partial.txt"),"synthetic partial clone");
        VersionException e=assertThrows(VersionException.class,()->cloud.cloneFromCloud(1L,5L,42L));
        assertEquals(0,posts);assertTrue(e.isUserFacing());
        verify(projects).delete(any(Project.class));verify(remotes,never()).save(any());
        verify(manifests,never()).applyToDatabase(anyLong(),any());
        assertFalse(Files.exists(temp.resolve("git")));assertFalse(Files.exists(temp.resolve("work")));
    }
    @Test void revokedReadPermissionIsNotBypassedAndCleansUp() {
        VersionException denied=new VersionException("synthetic Git read denied");
        doThrow(denied).when(repo).cloneFromRemote(eq(77L),anyString(),anyString(),anyString(),any(Runnable.class));
        assertSame(denied,assertThrows(VersionException.class,()->cloud.cloneFromCloud(1L,5L,42L)));
        assertEquals(0,posts);verify(projects).delete(any(Project.class));
        verifyNoInteractions(manifests);verify(remotes,never()).save(any());
    }
}
