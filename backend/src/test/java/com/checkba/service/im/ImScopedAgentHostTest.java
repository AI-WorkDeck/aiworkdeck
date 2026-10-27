// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.im;

import com.checkba.model.entity.Project;
import com.checkba.model.entity.ProjectRemote;
import com.checkba.model.entity.CloudConnection;
import com.checkba.repository.ProjectRemoteRepository;
import com.checkba.version.OfficialCloudService;
import org.springframework.test.util.ReflectionTestUtils;
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
        when(gateway.executeWithinScope(eq(7L),eq("qa-account"),eq("ensureAgent"),anyMap())).thenReturn(Map.of("id","private-chat"));
    }
    void info(boolean privateChat, String scope, String key) {
        when(gateway.executeWithinScope(7L, "qa-account", "agentInfo", Map.of("conversationId", "chat")))
                .thenReturn(Map.of("agent", Map.of("private", privateChat, "scope", scope, "scopeKey", key)));
    }
    void bindOfficialProject() {
        ProjectRemoteRepository remotes=mock(ProjectRemoteRepository.class); OfficialCloudService official=mock(OfficialCloudService.class);
        ProjectRemote remote=new ProjectRemote(); remote.setProjectId(2L); remote.setConnectionId(11L); remote.setRemoteProjectId("77");
        CloudConnection connection=new CloudConnection(); connection.setId(11L); connection.setUserId(7L); connection.setAccountFingerprint("qa-account");
        when(remotes.findByProjectId(2L)).thenReturn(Optional.of(remote)); when(official.connectOfficial(7L)).thenReturn(connection);
        ReflectionTestUtils.setField(host,"projectRemotes",remotes); ReflectionTestUtils.setField(host,"officialCloud",official);
        when(gateway.executeWithinScope(7L,"qa-account","projectGroup",Map.of("projectId",77L)))
                .thenReturn(Map.of("id","bound-project-group","projectId",77L,"agent",Map.of("scope","project","scopeKey","project:77","private",false)));
        when(gateway.executeWithinScope(7L,"qa-account","agentScopes",Map.of())).thenReturn(Map.of("agents",List.of()));
    }
    @Test void boundProjectCatalogueAndSharedEnsureReuseTheActualProjectGroup() {
        bindOfficialProject();
        var catalogue=(Map<?,?>)host.execute(7L,2L,"agentScopes",Map.of()); var scope=(Map<?,?>)((List<?>)catalogue.get("agents")).get(0);
        assertEquals("project:77",scope.get("scopeKey")); assertEquals(uid,scope.get("legacyScopeKey")); assertEquals(2L,scope.get("localProjectId"));
        var group=(Map<?,?>)host.execute(7L,2L,"ensureAgent",Map.of("scope","project","scopeKey","project:77","private",false));
        assertEquals("bound-project-group",group.get("id")); assertEquals(2L,group.get("localProjectId"));
        verify(gateway,never()).executeWithinScope(any(),anyString(),eq("ensureAgent"),anyMap()); verify(projectFiles,never()).ensureIdentity(any(),any(),any());
        assertThrows(IllegalArgumentException.class,()->host.execute(7L,2L,"ensureAgent",Map.of("scope","project","scopeKey","project:999","private",false)));
    }
    @Test void privateFromBoundGroupReusesVerifiedMarkerAndAddsOnlyMappedCloudAssociation() {
        bindOfficialProject(); host.execute(7L,2L,"ensureAgent",Map.of("scope","project","scopeKey","project:77","private",true,"projectId",2L));
        verify(gateway).executeWithinScope(7L,"qa-account","ensureAgent",Map.of("scope","project","scopeKey",uid,"private",true,"title","合成并购项目","projectId",77L));
        assertThrows(IllegalArgumentException.class,()->host.execute(7L,2L,"ensureAgent",Map.of("scope","project","scopeKey","project:2","private",true)));
    }
    @Test void privateBoundReplyRequiresBothMarkerAndCurrentOfficialProjectMapping() {
        bindOfficialProject(); when(gateway.executeWithinScope(7L,"qa-account","agentInfo",Map.of("conversationId","chat")))
                .thenReturn(Map.of("projectId",88L,"agent",Map.of("scope","project","scopeKey",uid,"private",true)));
        assertThrows(IllegalArgumentException.class,()->host.execute(7L,2L,"agentReply",Map.of("conversationId","chat","messageId",41)));
        verifyNoInteractions(context); verify(gateway,never()).executeWithinScope(any(),anyString(),eq("agentReply"),anyMap());
    }
    @Test void projectReadOnlyMemberCanUseBoundSharedGroupWithoutCreatingLocalMarker() {
        bindOfficialProject(); when(projectFiles.readIdentity(7L,2L,"qa-account")).thenThrow(new IllegalArgumentException("no marker"));
        when(projectFiles.ensureIdentity(7L,2L,"qa-account")).thenThrow(new IllegalArgumentException("readonly"));
        var result=(Map<?,?>)host.execute(7L,2L,"agentScopes",Map.of());
        assertEquals("project:77",((Map<?,?>)((List<?>)result.get("agents")).get(0)).get("scopeKey"));
        assertThrows(IllegalArgumentException.class,()->host.execute(7L,2L,"ensureAgent",Map.of("scope","project","scopeKey","project:77","private",true)));
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
        when(context.build(7L, project, "", List.of())).thenReturn("verified project context");
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
        when(context.build(7L, project, "", List.of())).thenReturn("private");
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
    @Test void privateReplyUsesBoundedSelectionHintsButNeverForwardsLocalIdsToCloud() {
        info(true, "project", uid);
        when(context.build(7L, project, "李某是谁", List.of(71L))).thenReturn("原告：李某。合成本机起诉状正文");
        host.execute(7L, 2L, "agentReply", Map.of("conversationId", "chat", "messageId", 41,
                "question", "李某是谁", "preferredFileIds", List.of("plugin-tab", 71L), "projectContext", "forged"));
        verify(gateway).executeWithinScope(7L, "qa-account", "agentReply", Map.of("conversationId", "chat", "messageId", 41,
                "projectContext", "原告：李某。合成本机起诉状正文"));
    }

}
