// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.controller.ai;

import com.checkba.controller.AuthController;
import com.checkba.repository.UserRepository;
import com.checkba.service.AdminAccessService;
import com.checkba.service.LangText;
import com.checkba.service.ai.harness.HarnessEvolutionService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

/**
 * Harness 用户自进化控制面板 REST 入口（dev-board#1481）。
 *
 * <p>配合前端 {@code HarnessEvolutionCard.vue}，让用户能在会话气泡内直接：
 * <ul>
 *   <li>切换某条自进化规则的作用域（{@code project} ⇄ {@code user}）；</li>
 *   <li>将高频自进化规则一键晋升为持久化 Skill（支持附带收尾 Challenger 核验策略）；</li>
 *   <li>一键撤销某条自进化学习。</li>
 * </ul>
 *
 * <p>权限：全部要求登录，且只能操作本人的记录（服务层按「不存在」处理他人记录）。
 * 升格技能会写入实例级可写 skill 目录、对该实例所有用户生效，因此与广场安装同口径只许管理员
 * （桌面单机全员管理员，团队服务器上普通成员只能切作用域与撤销）。
 */
@RestController
@RequestMapping("/api/agent/harness")
@RequiredArgsConstructor
public class HarnessEvolutionController {

    private final HarnessEvolutionService harnessEvolutionService;
    private final UserRepository userRepository;
    private final AdminAccessService adminAccessService;

    private static ResponseEntity<Map<String, Object>> unauthorized() {
        return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                .body(Map.of("error", LangText.of("未登录", "Not signed in")));
    }

    private boolean isAdmin(Long userId) {
        return userId != null && userRepository.findById(userId)
                .map(adminAccessService::isAdmin)
                .orElse(false);
    }

    @GetMapping("/evolutions")
    public ResponseEntity<?> listEvolutions(
            @RequestHeader(value = "X-Session-Id", required = false) String sessionId,
            @RequestParam(required = false) Long projectId,
            @RequestParam(required = false) String conversationId) {
        Long userId = AuthController.getUserIdFromSession(sessionId);
        if (userId == null) {
            return unauthorized();
        }
        return ResponseEntity.ok(harnessEvolutionService.listEvolutions(userId, projectId, conversationId));
    }

    @PostMapping("/evolutions/{id}/scope")
    public ResponseEntity<?> switchScope(
            @RequestHeader(value = "X-Session-Id", required = false) String sessionId,
            @PathVariable String id,
            @RequestBody Map<String, Object> body) {
        Long userId = AuthController.getUserIdFromSession(sessionId);
        if (userId == null) {
            return unauthorized();
        }
        String targetScope = body == null ? null : String.valueOf(body.getOrDefault("scope", "project"));
        try {
            return ResponseEntity.ok(harnessEvolutionService.switchScope(userId, id, targetScope));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("error", e.getMessage()));
        }
    }

    @PostMapping("/evolutions/{id}/promote-skill")
    public ResponseEntity<?> promoteToSkill(
            @RequestHeader(value = "X-Session-Id", required = false) String sessionId,
            @PathVariable String id,
            @RequestBody(required = false) Map<String, Object> body) {
        Long userId = AuthController.getUserIdFromSession(sessionId);
        if (userId == null) {
            return unauthorized();
        }
        if (!isAdmin(userId)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN)
                    .body(Map.of("error", LangText.of("仅管理员可升格为技能", "Administrator permission required to promote a skill")));
        }
        String name = body != null && body.get("name") != null ? String.valueOf(body.get("name")) : null;
        String rule = body != null && body.get("actionableRule") != null ? String.valueOf(body.get("actionableRule")) : null;
        String verificationPolicy = body != null && body.get("verificationPolicy") != null
                ? String.valueOf(body.get("verificationPolicy"))
                : null;
        List<String> triggers = null;
        if (body != null && body.get("triggers") instanceof List<?> rawList) {
            triggers = rawList.stream().filter(java.util.Objects::nonNull).map(String::valueOf).toList();
        }
        try {
            return ResponseEntity.ok(
                    harnessEvolutionService.promoteToSkill(userId, id, name, triggers, rule, verificationPolicy));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("error", e.getMessage()));
        }
    }

    @DeleteMapping("/evolutions/{id}")
    public ResponseEntity<?> revertEvolution(
            @RequestHeader(value = "X-Session-Id", required = false) String sessionId,
            @PathVariable String id) {
        Long userId = AuthController.getUserIdFromSession(sessionId);
        if (userId == null) {
            return unauthorized();
        }
        try {
            return ResponseEntity.ok(harnessEvolutionService.revertEvolution(userId, id));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("error", e.getMessage()));
        }
    }
}
