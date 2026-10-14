// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service;

import com.checkba.model.entity.*;
import com.checkba.repository.*;
import org.junit.jupiter.api.Test;
import java.util.Optional;
import static org.mockito.Mockito.*;
import static org.junit.jupiter.api.Assertions.*;

class ProjectMemberGlobalClientTest {
    @Test void globalClientCannotBypassGitAndCloudClientChecksThroughProjectOwnership() {
        var members=mock(ProjectMemberRepository.class); var users=mock(UserRepository.class);
        var projects=mock(ProjectRepository.class);
        var service=new ProjectMemberService(members,users,projects,mock(ProjectInvitationRepository.class));
        User client=new User(); client.setId(7L); client.setRole("CLIENT");
        when(users.findById(7L)).thenReturn(Optional.of(client));
        Project project=new Project();project.setId(3L);project.setUserId(7L);
        when(projects.findById(3L)).thenReturn(Optional.of(project));
        assertTrue(service.isClient(3L,7L));
        assertFalse(service.hasWritePermission(3L,7L));
        client.setRole("USER");assertFalse(service.isClient(3L,7L));assertTrue(service.hasWritePermission(3L,7L));
        project.setUserId(8L);
        ProjectMember member=new ProjectMember();member.setRole("CLIENT_NAMED");
        when(members.findByProjectIdAndUserId(3L,7L)).thenReturn(Optional.of(member));
        assertTrue(service.isClient(3L,7L));
        member.setRole("PARTICIPANT");assertFalse(service.isClient(3L,7L));
    }
}
