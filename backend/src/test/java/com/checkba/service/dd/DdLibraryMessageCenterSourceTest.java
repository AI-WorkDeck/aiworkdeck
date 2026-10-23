// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.dd;

import com.checkba.model.entity.*;
import com.checkba.repository.*;
import com.checkba.service.DdWorkflowService;
import com.checkba.service.ProjectMemberService;
import com.checkba.service.account.AccountService;
import com.checkba.version.CloudSyncService;
import com.checkba.version.OfficialCloudService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.*;
import java.nio.charset.StandardCharsets;
import java.time.LocalDateTime;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class DdLibraryMessageCenterSourceTest {
    final DdWorkflowService workflow=mock(DdWorkflowService.class);
    final ProjectRepository projects=mock(ProjectRepository.class);
    final ProjectRemoteRepository remotes=mock(ProjectRemoteRepository.class);
    final CloudConnectionRepository connections=mock(CloudConnectionRepository.class);
    final ProjectMemberService permissions=mock(ProjectMemberService.class);
    final AccountService account=mock(AccountService.class);
    final OfficialCloudService official=mock(OfficialCloudService.class);
    final CloudSyncService cloud=mock(CloudSyncService.class);
    DdLibraryMessageCenterSource source;
    @BeforeEach void setup() {
        when(account.accountFingerprintOrNull()).thenReturn("account-a");when(official.officialBaseUrl()).thenReturn("https://official.example.test");
        List<ProjectRemote> rows=new ArrayList<>();
        for(long id=1;id<=2;id++) {
            ProjectRemote r=new ProjectRemote();r.setProjectId(id);r.setConnectionId(id+10);r.setRemoteProjectId("42");rows.add(r);
            when(remotes.findByProjectId(id)).thenReturn(Optional.of(r));
            CloudConnection c=new CloudConnection();c.setId(id+10);c.setUserId(7L);c.setAccountFingerprint("account-a");c.setServerUrl("https://independent"+id+".example.test");
            when(connections.findById(id+10)).thenReturn(Optional.of(c));
            when(permissions.hasReadPermission(id,7L)).thenReturn(true);
            Project p=new Project();p.setId(id);p.setName("Synthetic "+id);when(projects.findById(id)).thenReturn(Optional.of(p));
        }
        when(remotes.findAll()).thenReturn(rows);
        when(cloud.proxyDd(1L,"GET","/notifications","",null,null)).thenReturn(reply(200,"["
                +"{\"id\":12,\"requestId\":8,\"createdAtIso\":\"2026-10-22T04:00:00Z\",\"actionState\":\"pending\"},"
                +"{\"id\":13,\"requestId\":8,\"createdAt\":\"2026-10-22T12:00:00\",\"readAt\":\"2026-10-22T13:00:00\",\"actionState\":\"pending\"}]"));
        when(cloud.proxyDd(2L,"GET","/notifications","",null,null)).thenReturn(reply(503,"{}"));
        source=new DdLibraryMessageCenterSource(workflow,projects,remotes,connections,permissions,account,official,cloud,new ObjectMapper());
    }
    CloudSyncService.RawResponse reply(int status,String body) {
        return new CloudSyncService.RawResponse(status,"application/json",null,body.getBytes(StandardCharsets.UTF_8));
    }
    @Test void partialIndependentLibrariesPreserveSuccessAndCountsAcrossLocalAndRemote() {
        DdNotification local=new DdNotification();local.setId(21L);local.setProjectId(3L);local.setRequestId(8L);
        local.setCreatedAt(LocalDateTime.of(2026,10,21,12,0));local.setKind("NOTICE");local.setTitle("Synthetic local");local.setActionState("pending");
        when(workflow.accountInbox(7L)).thenReturn(List.of(local));
        var snapshot=source.list(7L,1);
        assertEquals(1,snapshot.items().size());assertEquals(2,snapshot.unread());assertEquals(3,snapshot.pending());assertTrue(snapshot.hasMore());
        assertEquals(List.of("2"),snapshot.unavailableSources());
        var legacy=source.list(7L,200).items().stream().filter(e->e.id().equals("1:13")).findFirst().orElseThrow();
        assertTrue(legacy.read());assertNull(legacy.readAt());assertNull(legacy.createdAt());
    }
    @Test void readRequiresRemoteAcknowledgementAndRechecksMembership() {
        when(cloud.proxyDd(eq(1L),eq("POST"),eq("/notifications/12/read"),eq(""),any(byte[].class),eq("application/json")))
                .thenReturn(reply(200,"{}"),reply(500,"{\"id\":12,\"readAt\":\"2026-10-22T12:00:00\"}"),
                        reply(200,"{\"id\":12,\"readAtIso\":\"2026-10-22T04:00:00Z\"}"));
        assertThrows(IllegalArgumentException.class,()->source.markRead(7L,"1:12"));
        assertThrows(IllegalArgumentException.class,()->source.markRead(7L,"1:12"));
        assertDoesNotThrow(()->source.markRead(7L,"1:12"));
        when(permissions.hasReadPermission(1L,7L)).thenReturn(false);
        assertThrows(IllegalArgumentException.class,()->source.markRead(7L,"1:12"));
        verify(cloud,times(3)).proxyDd(eq(1L),eq("POST"),eq("/notifications/12/read"),eq(""),any(byte[].class),eq("application/json"));
    }
    @Test void accountSwitchDuringRemoteReadCannotReturnOldAccountPartialResults() {
        when(cloud.proxyDd(1L,"GET","/notifications","",null,null)).thenAnswer(i->{
            when(account.accountFingerprintOrNull()).thenReturn("account-b");return reply(200,"[]");
        });
        assertThrows(IllegalArgumentException.class,()->source.list(7L,100));
    }
    @Test void inaccessibleProjectsAreNotContactedAndLocalFailureKeepsRemoteSuccess() {
        when(workflow.accountInbox(7L)).thenThrow(new IllegalStateException("synthetic local failure"));
        when(permissions.hasReadPermission(2L,7L)).thenReturn(false);
        var snapshot=source.list(7L,100);
        assertEquals(2,snapshot.items().size());assertEquals(List.of("local"),snapshot.unavailableSources());
        verify(cloud,never()).proxyDd(2L,"GET","/notifications","",null,null);
        assertThrows(IllegalArgumentException.class,()->source.target(8L,"1:12"));
    }
}
