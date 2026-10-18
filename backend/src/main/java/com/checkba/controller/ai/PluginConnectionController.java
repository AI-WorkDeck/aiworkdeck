// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.controller.ai;

import com.checkba.controller.AuthController;
import com.checkba.service.ProjectMemberService;
import com.checkba.service.account.MachineAccountGuard;
import com.checkba.service.ai.PluginService;
import com.checkba.service.entitlement.EntitlementService;
import com.checkba.service.plugin.PluginConnectionService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.util.Map;

@RestController
@RequestMapping("/api/plugins")
@RequiredArgsConstructor
public class PluginConnectionController {
    private final PluginConnectionService connections;
    private final PluginService plugins;
    private final EntitlementService entitlements;
    private final MachineAccountGuard machineAccountGuard;
    private final ProjectMemberService projectMembers;

    @GetMapping("/{id}/connections")
    public Map<String, Object> list(@PathVariable String id, @RequestHeader(value="X-Session-Id", required=false) String session) {
        return Map.of("code", 0, "connections", connections.list(id, user(session)));
    }

    @PostMapping("/{id}/connections/{connectionId}/connect")
    public Map<String, Object> connect(@PathVariable String id, @PathVariable String connectionId,
            @RequestHeader(value="X-Session-Id", required=false) String session, @RequestBody Map<String, String> body) {
        connections.connect(id, user(session), connectionId, body.get("token"));
        return Map.of("code", 0);
    }

    @PostMapping("/{id}/connections/{connectionId}/disconnect")
    public Map<String, Object> disconnect(@PathVariable String id, @PathVariable String connectionId,
            @RequestHeader(value="X-Session-Id", required=false) String session) {
        connections.disconnect(id, user(session), connectionId);
        return Map.of("code", 0);
    }

    @PostMapping("/{id}/connections/{connectionId}/authorize")
    public Map<String, Object> authorize(@PathVariable String id, @PathVariable String connectionId,
            @RequestHeader(value="X-Session-Id", required=false) String session) {
        return Map.of("code", 0, "data", connections.authorize(id, user(session), connectionId));
    }

    @GetMapping(value="/oauth/callback", produces="text/plain;charset=UTF-8")
    public ResponseEntity<String> callback(@RequestParam(required=false) String state, @RequestParam(required=false) String code) {
        try {
            connections.callback(state, code);
            return ResponseEntity.ok().header("Cache-Control", "no-store").header("Referrer-Policy", "no-referrer")
                    .body("连接成功，请返回 AI WorkDeck。Connected. You can return to AI WorkDeck.");
        } catch (RuntimeException e) {
            return ResponseEntity.badRequest().header("Cache-Control", "no-store").header("Referrer-Policy", "no-referrer")
                    .body("连接未完成，请从插件设置重试。Connection failed. Please retry from plugin settings.");
        }
    }

    @PostMapping("/{id}/connections/{connectionId}/request")
    public Map<String, Object> request(@PathVariable String id, @PathVariable String connectionId,
            @RequestHeader(value="X-Session-Id", required=false) String session, @RequestBody Map<String, Object> body) {
        Long userId = user(session);
        if (body.get("projectId") instanceof Number n && !projectMembers.hasWritePermission(n.longValue(), userId)) {
            throw new IllegalArgumentException("No access to this project");
        }
        @SuppressWarnings("unchecked") Map<String, Object> params = body.get("params") instanceof Map<?, ?> m
                ? (Map<String, Object>) m : Map.of();
        return Map.of("code", 0, "data", connections.request(id, userId, connectionId,
                String.valueOf(body.get("operation")), params));
    }

    @GetMapping("/{id}/billing")
    public Map<String, Object> billing(@PathVariable String id, @RequestParam(required=false) String connectionId,
            @RequestHeader(value="X-Session-Id", required=false) String session) {
        Long userId = user(session);
        requirePlugin(id);
        if (connectionId != null) return Map.of("code", 0, "data", connections.billingStatus(id, userId, connectionId));
        machineAccountGuard.requireMachineScope(session);
        return Map.of("code", 0, "data", Map.of("provider", "host", "active", entitlements.isEnabled("plugin:" + id)));
    }

    @GetMapping("/{id}/billing/checkout")
    public Map<String, Object> checkout(@PathVariable String id, @RequestParam(required=false) String connectionId,
            @RequestHeader(value="X-Session-Id", required=false) String session) {
        user(session); requirePlugin(id);
        String url = connectionId == null ? "https://www.aiworkdeck.com/zh/plugins" : connections.checkout(id, connectionId);
        return Map.of("code", 0, "data", Map.of("url", url));
    }

    private void requirePlugin(String id) {
        if (plugins.getPlugin(id) == null || !plugins.isEnabled(id)) throw new IllegalArgumentException("Plugin is not enabled");
    }
    private Long user(String session) {
        Long id = AuthController.getUserIdFromSession(session);
        if (id == null) throw new IllegalArgumentException("Sign in required");
        return id;
    }
    @ExceptionHandler({IllegalArgumentException.class, IllegalStateException.class})
    public ResponseEntity<Map<String, Object>> error(RuntimeException e) {
        String message = e.getMessage() == null ? "Plugin service failed" : e.getMessage();
        String code = "connection_required".equals(message) || "payment_required".equals(message) ? message : "plugin_service_failed";
        return ResponseEntity.badRequest().body(Map.of("code", 1, "errorCode", code, "message", message));
    }
}
