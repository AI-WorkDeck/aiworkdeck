// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.im;

import com.checkba.model.entity.Project;
import com.checkba.repository.ProjectRepository;
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
                String uid = projectFiles.ensureIdentity(userId, projectId, accountScope);
                agents.add(Map.of("scope", "project", "scopeKey", uid, "name", "项目助手",
                        "title", project.getName(), "private", false));
            } catch (IllegalArgumentException unavailable) {
                result.put("projectReason", "当前项目助手尚未就绪，请由项目内部成员打开项目沟通完成关联");
            }
            if (remote.get("agents") instanceof List<?> rows) agents.addAll(rows);
            result.put("agents", agents);
            return result;
        }
        if ("ensureAgent".equals(action)) {
            String scope = ImService.string(p, "scope");
            Map<String, Object> request = new LinkedHashMap<>();
            request.put("scope", scope);
            request.put("private", Boolean.TRUE.equals(p.get("private")));
            if ("project".equals(scope)) {
                String uid = projectFiles.ensureIdentity(userId, projectId, accountScope);
                if (!uid.equals(p.get("scopeKey"))) throw new IllegalArgumentException("项目已切换，请重新打开项目助手");
                request.put("scopeKey", uid);
                request.put("title", project.getName().substring(0, Math.min(128, project.getName().length())));
            } else {
                request.put("scopeKey", ImService.string(p, "scopeKey"));
                // Team/firm identity and labels are resolved again by the cloud, never trusted from this request.
            }
            return gateway.executeWithinScope(userId, accountScope, action, request);
        }
        if (!"agentReply".equals(action)) throw new IllegalArgumentException("不支持的助手操作");
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
            if (!uid.equals(agent.get("scopeKey"))) throw new IllegalArgumentException("请切换到这位助手所属的项目后再私聊");
            request.put("projectContext", context.build(userId, project));
            requireProject(userId, projectId);
        }
        return gateway.executeWithinScope(userId, accountScope, action, request);
    }

    private Project requireProject(Long userId, Long projectId) {
        if (userId == null || projectId == null || !members.hasReadPermission(projectId, userId))
            throw new IllegalArgumentException("没有当前项目的访问权限");
        return projects.findById(projectId).orElseThrow(() -> new IllegalArgumentException("项目不存在"));
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> map(Object value) {
        if (!(value instanceof Map<?, ?>)) throw new IllegalArgumentException("助手服务响应无效，请重试");
        return (Map<String, Object>) value;
    }
}
