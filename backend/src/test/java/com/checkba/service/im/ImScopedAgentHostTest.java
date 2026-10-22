// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.im;

import com.checkba.model.entity.Project;
import com.checkba.repository.ProjectRepository;
import com.checkba.service.ProjectMemberService;
import org.junit.jupiter.api.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class ImScopedAgentHostTest {
    ImGatewayService gateway = mock(ImGatewayService.class);
    ProjectMemberService members = mock(ProjectMemberService.class);
    ProjectRepository projects = mock(ProjectRepository.class);
    ImProjectFiles projectFiles = mock(ImProjectFiles.class);
    ImPrivateProjectContext context = mock(ImPrivateProjectContext.class);
    ImScopedAgentHost host = new ImScopedAgentHost(gateway, members, projects, projectFiles, context);
    Project project;
    String uid = "d21c3411-371f-41cf-91e6-095c949cdb16";
    @BeforeEach void setup() {
        project = new Project(); project.setId(2L); project.setUid(uid); project.setName("合成并购项目");
        when(members.hasReadPermission(2L, 7L)).thenReturn(true);
        when(projects.findById(2L)).thenReturn(Optional.of(project));
        when(projectFiles.ensureIdentity(7L, 2L, "qa-account")).thenReturn(uid);
        when(projectFiles.readIdentity(7L, 2L, "qa-account")).thenReturn(uid);
        when(gateway.captureAccountScope()).thenReturn("qa-account");
    }
    void info(boolean privateChat, String scope, String key) {
        when(gateway.executeWithinScope(7L, "qa-account", "agentInfo", Map.of("conversationId", "chat")))
                .thenReturn(Map.of("agent", Map.of("private", privateChat, "scope", scope, "scopeKey", key)));
    }
    @Test void sharedReplyNeverReadsOrForwardsPrivateProjectContext() {
        info(false, "project", uid);
        host.execute(7L, 2L, "agentReply", Map.of("conversationId", "chat", "messageId", 41,
                "projectContext", "plugin tries to inject private records"));
        verifyNoInteractions(context);
        verify(gateway).executeWithinScope(7L, "qa-account", "agentReply", Map.of("conversationId", "chat", "messageId", 41));
    }
    @Test void privateProjectMaterialIsBuiltOnlyForTheMatchingProject() {
        info(true, "project", uid);
        when(context.build(7L, project)).thenReturn("verified project context");
        host.execute(7L, 2L, "agentReply", Map.of("conversationId", "chat", "messageId", 41, "projectContext", "untrusted"));
        verify(gateway).executeWithinScope(7L, "qa-account", "agentReply", Map.of("conversationId", "chat", "messageId", 41,
                "projectContext", "verified project context"));
        info(true, "project", "another-project");
        clearInvocations(context, gateway);
        assertThrows(IllegalArgumentException.class, () -> host.execute(7L, 2L, "agentReply", Map.of("conversationId", "chat", "messageId", 42)));
        verifyNoInteractions(context);
        verify(gateway, never()).executeWithinScope(eq(7L), anyString(), eq("agentReply"), anyMap());
    }
    @Test void teamPrivateChatDoesNotInheritCurrentProject() {
        info(true, "team", "team:abc");
        host.execute(7L, 2L, "agentReply", Map.of("conversationId", "chat", "messageId", 41));
        verifyNoInteractions(context, projectFiles);
        verify(gateway).executeWithinScope(7L, "qa-account", "agentReply", Map.of("conversationId", "chat", "messageId", 41));
    }
    @Test void projectPermissionIsCheckedBeforeAnyRemoteOperation() {
        when(members.hasReadPermission(2L, 7L)).thenReturn(false);
        assertThrows(IllegalArgumentException.class, () -> host.execute(7L, 2L, "agentScopes", Map.of()));
        verifyNoInteractions(gateway, projectFiles, context);
    }
    @Test void revokedProjectAfterExtractionDoesNotSendTheMaterial() {
        info(true, "project", uid);
        when(members.hasReadPermission(2L, 7L)).thenReturn(true, false);
        when(context.build(7L, project)).thenReturn("private");
        assertThrows(IllegalArgumentException.class, () -> host.execute(7L, 2L, "agentReply", Map.of("conversationId", "chat", "messageId", 41)));
        verify(gateway, never()).executeWithinScope(any(), anyString(), eq("agentReply"), anyMap());
    }
    @Test void ensureUsesServerProjectIdentityAndRejectsStaleScope() {
        host.execute(7L, 2L, "ensureAgent", Map.of("scope", "project", "scopeKey", uid, "title", "forged", "private", true));
        verify(gateway).executeWithinScope(7L, "qa-account", "ensureAgent", Map.of("scope", "project", "scopeKey", uid,
                "title", "合成并购项目", "private", true));
        assertThrows(IllegalArgumentException.class, () -> host.execute(7L, 2L, "ensureAgent", Map.of("scope", "project", "scopeKey", "other")));
    }
    @Test void catalogueCombinesOnlyCurrentProjectAndAuthorizedRemoteScopes() {
        var team = Map.of("scope", "team", "scopeKey", "team:qa", "name", "团队助手");
        when(gateway.executeWithinScope(7L, "qa-account", "agentScopes", Map.of())).thenReturn(Map.of("agents", List.of(team)));
        var result = (Map<?, ?>) host.execute(7L, 2L, "agentScopes", Map.of("projectId", 999));
        var agents = (List<?>) result.get("agents");
        assertEquals(2, agents.size());
        assertEquals(uid, ((Map<?, ?>) agents.get(0)).get("scopeKey"));
        assertEquals(team, agents.get(1));
    }
    @Test void unavailableProjectIdentityDoesNotHideAuthorizedTeamAssistant() {
        var team = Map.of("scope", "team", "scopeKey", "team:qa", "name", "团队助手");
        when(gateway.executeWithinScope(7L, "qa-account", "agentScopes", Map.of())).thenReturn(Map.of("agents", List.of(team)));
        when(projectFiles.ensureIdentity(7L, 2L, "qa-account")).thenThrow(new IllegalArgumentException("readonly"));
        var result = (Map<?, ?>) host.execute(7L, 2L, "agentScopes", Map.of());
        assertEquals(List.of(team), result.get("agents"));
        assertNotNull(result.get("projectReason"));
    }
}
