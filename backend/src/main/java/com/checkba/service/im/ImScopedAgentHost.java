// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.im;

import com.checkba.model.entity.Project;
import com.checkba.repository.ProjectRepository;
import com.checkba.repository.ProjectRemoteRepository;
import com.checkba.version.OfficialCloudService;
import com.checkba.service.ProjectMemberService;
import org.springframework.stereotype.Service;

import java.util.*;

/** Local project IDs never cross the cloud boundary; private context never enters a shared group. */
@Service
@lombok.RequiredArgsConstructor
public class ImScopedAgentHost implements ImProjectActionHandler {
    private final ImGatewayService gateway;
    private final ProjectMemberService members;
    private final ProjectRepository projects;
    private final ImProjectFiles projectFiles;
    private final ImPrivateProjectContext context;
    @org.springframework.beans.factory.annotation.Autowired(required=false)
    private ProjectRemoteRepository projectRemotes;
    @org.springframework.beans.factory.annotation.Autowired(required=false)
    private OfficialCloudService officialCloud;

    @Override public boolean supports(String action) {
        return Set.of("agentScopes", "ensureAgent", "agentReply").contains(action);
    }

    @Override public Object execute(Long userId, Long projectId, String action, Map<String, Object> params) {
        Project project = requireProject(userId, projectId);
        String accountScope = gateway.captureAccountScope();
        Map<String, Object> p = params == null ? Map.of() : params;
        if ("agentScopes".equals(action)) {
            Map<String, Object> remote = map(gateway.executeWithinScope(userId, accountScope, action, Map.of()));
            List<Object> agents = new ArrayList<>();
            Map<String, Object> result = new LinkedHashMap<>(remote);
            try {
                Long boundProject=boundProject(userId,projectId,accountScope);
                Map<String,Object> entry=new LinkedHashMap<>();
                entry.put("scope","project"); entry.put("name",com.checkba.service.LangText.of("项目助手", "Project Assistant")); entry.put("title",project.getName());
                entry.put("private",false); entry.put("localProjectId",projectId);
                if (boundProject!=null) {
                    Map<String,Object> group=projectGroup(userId,projectId,boundProject,accountScope);
                    entry.put("scopeKey","project:"+boundProject); entry.put("conversationId",group.get("id"));
                    // Existing marker histories remain accessible; they are not merged into the wider project audience.
                    try { entry.put("legacyScopeKey",projectFiles.readIdentity(userId,projectId,accountScope)); }
                    catch (IllegalArgumentException absent) { /* Shared project access does not require a local marker file. */ }
                } else entry.put("scopeKey",projectFiles.ensureIdentity(userId,projectId,accountScope));
                agents.add(entry);
            } catch (IllegalArgumentException unavailable) {
                result.put("projectReason", com.checkba.service.LangText.of("当前项目助手尚未就绪，请由项目内部成员打开项目沟通完成关联", "Project Assistant is not ready yet; please ask an internal project member to open Project IM to complete binding"));
            }
            if (remote.get("agents") instanceof List<?> rows) agents.addAll(rows);
            result.put("agents", agents);
            return result;
        }
        if ("ensureAgent".equals(action)) {
            if (p.containsKey("private") && !(p.get("private") instanceof Boolean)) throw new IllegalArgumentException(com.checkba.service.LangText.of("private必须为布尔值", "private must be a boolean"));
            String scope = ImService.string(p, "scope");
            Map<String, Object> request = new LinkedHashMap<>();
            request.put("scope", scope);
            request.put("private", Boolean.TRUE.equals(p.get("private")));
            if ("project".equals(scope)) {
                Long boundProject=boundProject(userId,projectId,accountScope);
                boolean privateChat=Boolean.TRUE.equals(p.get("private"));
                String supplied=ImService.string(p,"scopeKey");
                String boundKey=boundProject==null ? null : "project:"+boundProject;
                if (boundProject!=null && !privateChat) {
                    if (!boundKey.equals(supplied) && !projectFiles.readIdentity(userId,projectId,accountScope).equals(supplied))
                        throw new IllegalArgumentException(com.checkba.service.LangText.of("项目已切换，请重新打开项目助手", "Project has changed; please reopen the Project Assistant"));
                    return projectGroup(userId,projectId,boundProject,accountScope);
                }
                String uid=projectFiles.ensureIdentity(userId,projectId,accountScope);
                if (!uid.equals(supplied) && !Objects.equals(boundKey,supplied)) throw new IllegalArgumentException(com.checkba.service.LangText.of("项目已切换，请重新打开项目助手", "Project has changed; please reopen the Project Assistant"));
                request.put("scopeKey",uid);
                request.put("title",project.getName().substring(0,Math.min(128,project.getName().length())));
                if (boundProject!=null) request.put("projectId",boundProject);
            } else {
                request.put("scopeKey", ImService.string(p, "scopeKey"));
                // Team/firm identity and labels are resolved again by the cloud, never trusted from this request.
            }
            Map<String,Object> result = new LinkedHashMap<>(map(gateway.executeWithinScope(userId, accountScope, action, request)));
            if ("project".equals(scope)) result.put("localProjectId", projectId);
            return result;
        }
        if (!"agentReply".equals(action)) throw new IllegalArgumentException(com.checkba.service.LangText.of("不支持的助手操作", "Unsupported assistant action"));
        String conversationId = ImService.string(p, "conversationId");
        Map<String, Object> conversation = map(gateway.executeWithinScope(userId, accountScope,
                "agentInfo", Map.of("conversationId", conversationId)));
        Map<String, Object> agent = map(conversation.get("agent"));
        Map<String, Object> request = new LinkedHashMap<>();
        request.put("conversationId", conversationId);
        request.put("messageId", p.get("messageId"));
        // A plugin-supplied projectContext is intentionally discarded for every scope.
        if (Boolean.TRUE.equals(agent.get("private")) && "project".equals(agent.get("scope"))) {
            String uid = projectFiles.readIdentity(userId, projectId, accountScope);
            if (!uid.equals(agent.get("scopeKey"))) throw new IllegalArgumentException(com.checkba.service.LangText.of("请切换到这位助手所属的项目后再私聊", "Please switch to the project this assistant belongs to before chatting privately"));
            if (conversation.get("projectId")!=null) {
                Long boundProject=boundProject(userId,projectId,accountScope);
                if (boundProject==null || !String.valueOf(boundProject).equals(String.valueOf(conversation.get("projectId"))))
                    throw new IllegalArgumentException(com.checkba.service.LangText.of("请切换到这位助手所属的项目后再私聊", "Please switch to the project this assistant belongs to before chatting privately"));
            }
            request.put("projectContext", context.build(userId, project));
            requireProject(userId, projectId);
        }
        return gateway.executeWithinScope(userId, accountScope, action, request);
    }

    /** Only an official connection for this account can translate a local ID into a cloud capability. */
    private Long boundProject(Long userId,Long projectId,String accountScope) {
        if (projectRemotes==null || officialCloud==null) return null;
        var remote=projectRemotes.findByProjectId(projectId).orElse(null);
        if (remote==null) return null;
        gateway.assertAccountScope(accountScope);
        var connection=officialCloud.connectOfficial(userId);
        if (!Objects.equals(userId,connection.getUserId()) || !Objects.equals(accountScope,connection.getAccountFingerprint()))
            throw new IllegalArgumentException(com.checkba.service.LangText.of("账户已变化，请重新打开项目助手", "Account has changed; please reopen the Project Assistant"));
        if (!Objects.equals(connection.getId(),remote.getConnectionId())) return null;
        requireProject(userId,projectId); gateway.assertAccountScope(accountScope);
        String id=remote.getRemoteProjectId();
        if (id==null || !id.matches("[1-9][0-9]{0,18}")) throw new IllegalArgumentException(com.checkba.service.LangText.of("案件库项目标识无效", "Invalid case library project ID"));
        try { return Long.valueOf(id); }
        catch (NumberFormatException invalid) { throw new IllegalArgumentException(com.checkba.service.LangText.of("案件库项目标识无效", "Invalid case library project ID")); }
    }

    private Map<String,Object> projectGroup(Long userId,Long localProjectId,Long remoteProjectId,String accountScope) {
        Map<String,Object> group=new LinkedHashMap<>(map(gateway.executeWithinScope(userId,accountScope,"projectGroup",Map.of("projectId",remoteProjectId))));
        if (!String.valueOf(remoteProjectId).equals(String.valueOf(group.get("projectId")))) throw new IllegalArgumentException(com.checkba.service.LangText.of("项目群关联无效", "Invalid project group binding"));
        requireProject(userId,localProjectId); gateway.assertAccountScope(accountScope);
        group.put("localProjectId",localProjectId); return group;
    }

    private Project requireProject(Long userId, Long projectId) {
        if (userId == null || projectId == null || !members.hasReadPermission(projectId, userId))
            throw new IllegalArgumentException(com.checkba.service.LangText.of("没有当前项目的访问权限", "You do not have access to the current project"));
        return projects.findById(projectId).orElseThrow(() -> new IllegalArgumentException(com.checkba.service.LangText.of("项目不存在", "Project not found")));
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> map(Object value) {
        if (!(value instanceof Map<?, ?>)) throw new IllegalArgumentException(com.checkba.service.LangText.of("助手服务响应无效，请重试", "Invalid assistant service response; please try again"));
        return (Map<String, Object>) value;
    }
}
