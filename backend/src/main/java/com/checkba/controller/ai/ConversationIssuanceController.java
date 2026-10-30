// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.controller.ai;

import com.checkba.controller.AuthController;
import com.checkba.service.LangText;
import com.checkba.service.ProjectMemberService;
import com.checkba.service.ai.ConversationIssuanceService;
import lombok.Data;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/**
 * conversationId 服务端签发端点（安全审计遗留 + Office 插件 Phase D）。
 *
 * 契约（与插件端并行开发约定，勿改形状）：
 *   POST /api/agent/conversations  body {"projectId": 123}
 *   → 200 {"conversationId": "conv-<毫秒>-<16位随机base64url>"}
 *
 * 独立于 AiAgentController 成文件，避免与并行分支冲突。
 * 桌面前端现有「客户端自造 conv-毫秒 ID」流程在默认配置下不受影响；
 * 官方云开启 security.conversation-issuance-required 后，空会话必须先经此端点签发。
 */
@RestController
@RequestMapping("/api/agent/conversations")
@RequiredArgsConstructor
public class ConversationIssuanceController {

    private final ConversationIssuanceService conversationIssuanceService;
    private final ProjectMemberService projectMemberService;
    @org.springframework.beans.factory.annotation.Autowired
    private com.checkba.service.ProjectAiMessageService messageService;

    @PostMapping
    public ResponseEntity<Map<String, String>> issue(@RequestBody IssueRequest request,
                                                     @RequestHeader(value = "X-Session-Id", required = false) String sessionId) {
        Long userId = AuthController.getUserIdFromSession(sessionId);
        if (userId == null) {
            return ResponseEntity.status(403).body(Map.of("error", LangText.of("会话身份无效", "Invalid session identity")));
        }
        Long projectId = request == null ? null : request.getProjectId();
        if (projectId == null || !projectMemberService.hasReadPermission(projectId, userId)) {
            return ResponseEntity.status(403).body(Map.of("error", LangText.of("无权访问该项目", "You do not have access to this project")));
        }
        String scope;
        try {
            scope = ConversationIssuanceService.normalizeScope(request.getConversationScope());
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
        if (request.getConversationId() != null) {
            if (!messageService.adoptConversationScope(request.getConversationId(), userId, projectId, scope)) {
                return ResponseEntity.status(403).body(Map.of("error", LangText.of(
                        "无法将此会话归入诉讼可视化", "This conversation cannot be assigned to Litigation Visualization")));
            }
            return ResponseEntity.ok(Map.of("conversationId", request.getConversationId()));
        }
        String conversationId = scope == null ? conversationIssuanceService.issue(userId, projectId)
                : conversationIssuanceService.issue(userId, projectId, scope);
        return ResponseEntity.ok(Map.of("conversationId", conversationId));
    }

    @Data
    public static class IssueRequest {
        private Long projectId;
        private String conversationScope;
        private String conversationId;
    }
}
