// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.controller.ai;

import com.checkba.controller.AuthController;
import com.checkba.service.ai.harness.HarnessEvolutionService;
import lombok.RequiredArgsConstructor;
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
 */
@RestController
@RequestMapping("/api/agent/harness")
@RequiredArgsConstructor
public class HarnessEvolutionController {

    private final HarnessEvolutionService harnessEvolutionService;

    private static Long getUserIdOrDefault(String sessionId) {
        Long uid = AuthController.getUserIdFromSession(sessionId);
        return uid != null ? uid : 1L;
    }

    @GetMapping("/evolutions")
    public ResponseEntity<List<HarnessEvolutionService.HarnessEvolutionRecord>> listEvolutions(
            @RequestHeader(value = "X-Session-Id", required = false) String sessionId,
            @RequestParam(required = false) Long projectId,
            @RequestParam(required = false) String conversationId) {
        Long userId = getUserIdOrDefault(sessionId);
        return ResponseEntity.ok(harnessEvolutionService.listEvolutions(userId, projectId, conversationId));
    }

    @PostMapping("/evolutions/{id}/scope")
    public ResponseEntity<?> switchScope(
            @RequestHeader(value = "X-Session-Id", required = false) String sessionId,
            @PathVariable String id,
            @RequestBody Map<String, Object> body) {
        Long userId = getUserIdOrDefault(sessionId);
        String targetScope = body == null ? null : String.valueOf(body.getOrDefault("scope", "project"));
        try {
            HarnessEvolutionService.HarnessEvolutionRecord updated =
                    harnessEvolutionService.switchScope(userId, id, targetScope);
            return ResponseEntity.ok(updated);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    @PostMapping("/evolutions/{id}/promote-skill")
    public ResponseEntity<?> promoteToSkill(
            @RequestHeader(value = "X-Session-Id", required = false) String sessionId,
            @PathVariable String id,
            @RequestBody(required = false) Map<String, Object> body) {
        Long userId = getUserIdOrDefault(sessionId);
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
            HarnessEvolutionService.HarnessEvolutionRecord promoted =
                    harnessEvolutionService.promoteToSkill(userId, id, name, triggers, rule, verificationPolicy);
            return ResponseEntity.ok(promoted);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    @DeleteMapping("/evolutions/{id}")
    public ResponseEntity<?> revertEvolution(
            @RequestHeader(value = "X-Session-Id", required = false) String sessionId,
            @PathVariable String id) {
        Long userId = getUserIdOrDefault(sessionId);
        try {
            HarnessEvolutionService.HarnessEvolutionRecord reverted =
                    harnessEvolutionService.revertEvolution(userId, id);
            return ResponseEntity.ok(reverted);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }
}
