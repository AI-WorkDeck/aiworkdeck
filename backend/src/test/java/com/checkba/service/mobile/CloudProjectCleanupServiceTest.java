// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.mobile;
import com.checkba.model.entity.*;
import com.checkba.repository.*;
import com.checkba.service.ProjectService;
import org.junit.jupiter.api.Test;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
class CloudProjectCleanupServiceTest {
    final ProjectRepository projects=mock(ProjectRepository.class);
    final ProjectMemberRepository members=mock(ProjectMemberRepository.class);
    final ProjectRemoteRepository remotes=mock(ProjectRemoteRepository.class);
    final ProjectService deletion=mock(ProjectService.class);
    Project project() { var p=new Project();p.setId(1L);p.setUserId(7L);p.setUid("immutable-project");p.setCloudBillingOwnerId(7L);p.setCloudOwnership("PERSONAL");return p; }
    CloudProjectCleanupService service(boolean local) {return new CloudProjectCleanupService(projects,members,remotes,deletion,true,local);}
    @Test void onlyExplicitPersonalOwnerIsEligible() {
        var p=project();when(projects.findByUserIdOrderByCreatedAtDesc(7L)).thenReturn(List.of(p));
        assertEquals(List.of(new CloudProjectCleanupService.Target(7L,1L,"immutable-project")),service(false).listOwnedCleanupTargets(7L));
        assertFalse(service(false).needsReview(7L));
        p.setCloudBillingOwnerId(null);
        assertTrue(service(false).listOwnedCleanupTargets(7L).isEmpty());assertTrue(service(false).needsReview(7L));
    }
    @Test void localFilesAndSharedProjectsCannotBeDeletedAutomatically() {
        var p=project();when(projects.findByUserIdOrderByCreatedAtDesc(7L)).thenReturn(List.of(p));
        p.setLocalRoot("/real/local");assertTrue(service(false).needsReview(7L));
        p.setLocalRoot(null);var member=new ProjectMember();member.setUserId(8L);
        when(members.findByProjectId(1L)).thenReturn(List.of(member));assertTrue(service(false).needsReview(7L));
        when(members.findByProjectId(1L)).thenReturn(List.of());when(remotes.findByProjectId(1L)).thenReturn(Optional.of(new ProjectRemote()));
        assertTrue(service(false).needsReview(7L));
        assertTrue(service(true).listOwnedCleanupTargets(7L).isEmpty());
        assertThrows(IllegalStateException.class,()->service(true).deleteExact(new CloudProjectCleanupService.Target(7L,1L,"immutable-project")));
        verifyNoInteractions(deletion);
    }
    @Test void exactDeletionPassesImmutableIdentityForLockedRevalidation() {
        service(false).deleteExact(new CloudProjectCleanupService.Target(7L,1L,"immutable-project"));
        verify(deletion).deleteOwnedCloudProject(1L,7L,"immutable-project");
        verify(deletion,never()).deleteProject(anyLong());
    }
}
