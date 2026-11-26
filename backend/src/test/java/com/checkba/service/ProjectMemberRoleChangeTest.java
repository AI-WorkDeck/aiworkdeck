// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service;

import com.checkba.model.entity.Project;
import com.checkba.model.entity.ProjectMember;
import com.checkba.repository.ProjectInvitationRepository;
import com.checkba.repository.ProjectMemberRepository;
import com.checkba.repository.ProjectRepository;
import com.checkba.repository.UserRepository;
import com.checkba.version.cloud.CollabEvent;
import com.checkba.version.cloud.CollabEventService;
import org.junit.jupiter.api.DynamicTest;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestFactory;

import java.util.*;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** C9: a case member's role changes in place (协作 → 案件参与人), with the same matrix as removeMember. */
class ProjectMemberRoleChangeTest {
    private static final long PROJECT = 1L, OWNER = 10L, REQUESTER = 11L, TARGET = 12L;
    private static final List<String> MEMBER_ROLES = List.of("ADMIN", "PARTICIPANT", "READ_ONLY", "CLIENT", "CLIENT_NAMED", "CLIENT_GENERIC");
    private static final List<String> NEW_ROLES = List.of("ADMIN", "PARTICIPANT", "READ_ONLY");

    private record Fixture(ProjectMemberService service, ProjectMemberRepository members, CollabEventService events,
                           Map<Long, ProjectMember> rows) {}

    /** requesterRole/targetRole: "OWNER", a member role, or null (not in the case). */
    private static Fixture fixture(String requesterRole, String targetRole) {
        var members = mock(ProjectMemberRepository.class);
        var projects = mock(ProjectRepository.class);
        var events = mock(CollabEventService.class);
        Project project = new Project();
        project.setId(PROJECT);
        project.setUserId(OWNER);
        when(projects.findById(PROJECT)).thenReturn(Optional.of(project));
        Map<Long, ProjectMember> rows = new HashMap<>();
        put(rows, REQUESTER, requesterRole);
        put(rows, TARGET, targetRole);
        when(members.findByProjectIdAndUserId(eq(PROJECT), anyLong()))
                .thenAnswer(call -> Optional.ofNullable(rows.get((Long) call.getArgument(1))));
        when(members.save(any())).thenAnswer(call -> call.getArgument(0));
        var service = new ProjectMemberService(members, mock(UserRepository.class), projects, mock(ProjectInvitationRepository.class));
        service.setCollabEventServiceForTest(events);
        return new Fixture(service, members, events, rows);
    }

    private static void put(Map<Long, ProjectMember> rows, long user, String role) {
        if (role == null || "OWNER".equals(role)) return;
        ProjectMember member = new ProjectMember();
        member.setProjectId(PROJECT);
        member.setUserId(user);
        member.setRole(role);
        rows.put(user, member);
    }

    private static boolean expectedAllowed(String requester, String target, String newRole) {
        if (target == null || "OWNER".equals(target) || target.startsWith("CLIENT")) return false;
        if ("OWNER".equals(requester)) return true;
        if ("ADMIN".equals(requester))
            return ("PARTICIPANT".equals(target) || "READ_ONLY".equals(target)) && !"ADMIN".equals(newRole);
        return false;
    }

    @TestFactory
    Stream<DynamicTest> permissionMatrixOverEveryRolePair() {
        List<String> requesters = new ArrayList<>(List.of("OWNER"));
        requesters.addAll(MEMBER_ROLES);
        requesters.add(null);
        List<String> targets = new ArrayList<>(List.of("OWNER"));
        targets.addAll(MEMBER_ROLES);
        targets.add(null);
        List<DynamicTest> cases = new ArrayList<>();
        for (String requester : requesters) for (String target : targets) for (String newRole : NEW_ROLES) {
            if (Objects.equals(target, newRole)) continue; // no-op, covered separately
            if ("OWNER".equals(requester) && "OWNER".equals(target)) continue; // that is self, covered separately
            cases.add(DynamicTest.dynamicTest(requester + " sets " + target + " to " + newRole, () -> {
                Fixture f = fixture(requester, target);
                long requesterId = "OWNER".equals(requester) ? OWNER : REQUESTER;
                long targetId = "OWNER".equals(target) ? OWNER : TARGET;
                if (expectedAllowed(requester, target, newRole)) {
                    f.service().changeRole(PROJECT, targetId, newRole, requesterId);
                    assertEquals(newRole, f.rows().get(targetId).getRole());
                    verify(f.events()).record(eq(CollabEvent.Kind.MEMBER_ROLE_CHANGED), eq(PROJECT), eq(requesterId),
                            isNull(), isNull(), isNull(), isNull(), eq(targetId), eq(Map.of("fromRole", target, "toRole", newRole)));
                } else {
                    assertThrows(IllegalArgumentException.class, () -> f.service().changeRole(PROJECT, targetId, newRole, requesterId));
                    if (f.rows().get(targetId) != null) assertEquals(target, f.rows().get(targetId).getRole());
                    verify(f.members(), never()).save(any());
                    verifyNoInteractions(f.events());
                }
            }));
        }
        return cases.stream();
    }

    @Test
    void nobodyChangesTheirOwnRole() {
        Fixture owner = fixture(null, null);
        assertThrows(IllegalArgumentException.class, () -> owner.service().changeRole(PROJECT, OWNER, "READ_ONLY", OWNER));
        Fixture admin = fixture("ADMIN", null);
        assertThrows(IllegalArgumentException.class, () -> admin.service().changeRole(PROJECT, REQUESTER, "READ_ONLY", REQUESTER));
        verify(admin.members(), never()).save(any());
    }

    @Test
    void settingTheCurrentRoleIsANoOpWithoutEvent() {
        Fixture f = fixture("OWNER", "READ_ONLY");
        f.service().changeRole(PROJECT, TARGET, "READ_ONLY", OWNER);
        assertEquals("READ_ONLY", f.rows().get(TARGET).getRole());
        verify(f.members(), never()).save(any());
        verifyNoInteractions(f.events());
    }

    @Test
    void unknownOrMissingRoleIsRejected() {
        for (String role : Arrays.asList("OWNER", "CLIENT", "SUPERUSER", "read_only", "", null)) {
            Fixture f = fixture("OWNER", "PARTICIPANT");
            assertThrows(IllegalArgumentException.class, () -> f.service().changeRole(PROJECT, TARGET, role, OWNER), String.valueOf(role));
            assertEquals("PARTICIPANT", f.rows().get(TARGET).getRole());
            verifyNoInteractions(f.events());
        }
    }

    @Test
    void demotionIsSavedSoTheNextWriteCheckRefusesIt() {
        Fixture f = fixture("OWNER", "PARTICIPANT");
        assertTrue(f.service().hasWritePermission(PROJECT, TARGET));
        f.service().changeRole(PROJECT, TARGET, "READ_ONLY", OWNER);
        verify(f.members()).save(argThat(m -> m.getUserId() == TARGET && "READ_ONLY".equals(m.getRole())));
        assertFalse(f.service().hasWritePermission(PROJECT, TARGET));
    }
}
