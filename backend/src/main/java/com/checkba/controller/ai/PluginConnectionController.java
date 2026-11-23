// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.controller.ai;

import com.checkba.controller.AuthController;
import com.checkba.service.ProjectMemberService;
import com.checkba.service.LangText;
import com.checkba.service.account.AccountException;
import com.checkba.service.account.AccountService;
import com.checkba.service.account.MachineAccountGuard;
import com.checkba.service.ai.PluginService;
import com.checkba.service.entitlement.EntitlementService;
import com.checkba.service.plugin.PluginConnectionService;
import com.checkba.service.site.SiteProfileService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;

@RestController
@RequestMapping("/api/plugins")
public class PluginConnectionController {
    private static final Set<String> PASS_THROUGH_ERROR_CODES = Set.of(
            "connection_required", "payment_required", "account_required",
            "not_selected", "slots_full", "already_bid", "already_selected",
            "profile_incomplete", "bid_closed");

    private final PluginConnectionService connections;
    private final PluginService plugins;
    private final EntitlementService entitlements;
    private final MachineAccountGuard machineAccountGuard;
    private final ProjectMemberService projectMembers;
    private final SiteProfileService sites;
    private final AccountService account;

    @Autowired
    public PluginConnectionController(PluginConnectionService connections, PluginService plugins,
            EntitlementService entitlements, MachineAccountGuard machineAccountGuard,
            ProjectMemberService projectMembers, SiteProfileService sites, AccountService account) {
        this.connections = connections;
        this.plugins = plugins;
        this.entitlements = entitlements;
        this.machineAccountGuard = machineAccountGuard;
        this.projectMembers = projectMembers;
        this.sites = sites;
        this.account = account;
    }

    public PluginConnectionController(PluginConnectionService connections, PluginService plugins,
            EntitlementService entitlements, MachineAccountGuard machineAccountGuard,
            ProjectMemberService projectMembers, SiteProfileService sites) {
        this(connections, plugins, entitlements, machineAccountGuard, projectMembers, sites, null);
    }

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
        boolean refreshed = entitlements.refreshQuietly();
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("provider", "host");
        data.put("active", entitlements.isEnabled("plugin:" + id));
        data.put("expiresAt", entitlements.expiresAt("plugin:" + id));
        data.put("accountConnected", account != null && account.isConnected());
        data.put("refreshed", refreshed);
        return Map.of("code", 0, "data", data);
    }

    @GetMapping("/{id}/billing/checkout")
    public Map<String, Object> checkout(@PathVariable String id, @RequestParam(required=false) String connectionId,
            @RequestHeader(value="X-Session-Id", required=false) String session) {
        user(session); requirePlugin(id);
        if (connectionId != null) {
            return Map.of("code", 0, "data", Map.of("url", connections.checkout(id, connectionId)));
        }
        String url = sites.baseUrl() + (LangText.isEnglish() ? "/en" : "/zh") + "/marketplace/plugins";
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("url", url);
        if ("aifirm-partner".equals(id)) {
            data.put("mode", "in_app");
            data.put("pluginId", id);
        }
        return Map.of("code", 0, "data", data);
    }

    @GetMapping("/{id}/billing/plans")
    public Map<String, Object> billingPlans(@PathVariable String id,
            @RequestHeader(value="X-Session-Id", required=false) String session) {
        user(session); requirePlugin(id);
        if (account == null) throw new IllegalStateException("Account service unavailable");
        return Map.of("code", 0, "data", account.fetchPluginSubscriptionPlans(id));
    }

    @PostMapping("/{id}/billing/subscribe")
    public Map<String, Object> subscribe(@PathVariable String id,
            @RequestHeader(value="X-Session-Id", required=false) String session,
            @RequestBody(required = false) Map<String, Object> body) {
        user(session); requirePlugin(id);
        machineAccountGuard.requireMachineScope(session);
        if (account == null) throw new IllegalStateException("Account service unavailable");
        String skuId = body != null && body.get("skuId") instanceof String s ? s.trim() : "";
        long amount = body != null && body.get("amount") instanceof Number n ? n.longValue() : -1L;
        String idempotencyKey = body != null && body.get("idempotencyKey") instanceof String k ? k.trim() : null;
        return Map.of("code", 0, "data", account.createPluginSubscriptionOrder(id, skuId, amount, idempotencyKey));
    }

    @GetMapping("/{id}/billing/order-status")
    public Map<String, Object> billingOrderStatus(@PathVariable String id,
            @RequestParam String outTradeNo,
            @RequestHeader(value="X-Session-Id", required=false) String session) {
        user(session); requirePlugin(id);
        machineAccountGuard.requireMachineScope(session);
        if (account == null) throw new IllegalStateException("Account service unavailable");
        if (outTradeNo == null || outTradeNo.isBlank()) throw new IllegalArgumentException("outTradeNo is required");
        Map<String, Object> status = account.queryPluginOrderStatus(outTradeNo.trim());
        if (status.get("order") instanceof Map<?, ?> order && "paid".equals(order.get("status"))) {
            entitlements.refreshQuietly();
            account.clearPluginAssertionCache(id);
        }
        Map<String, Object> out = new LinkedHashMap<>(status);
        out.put("active", entitlements.isEnabled("plugin:" + id));
        out.put("expiresAt", entitlements.expiresAt("plugin:" + id));
        return Map.of("code", 0, "data", out);
    }

    private void requirePlugin(String id) {
        if (plugins.getPlugin(id) == null || !plugins.isEnabled(id)) throw new IllegalArgumentException("Plugin is not enabled");
    }
    private Long user(String session) {
        Long id = AuthController.getUserIdFromSession(session);
        if (id == null) throw new IllegalArgumentException("Sign in required");
        return id;
    }
    @ExceptionHandler({IllegalArgumentException.class, IllegalStateException.class, AccountException.class})
    public ResponseEntity<Map<String, Object>> error(RuntimeException e) {
        String message = e.getMessage() == null ? "Plugin service failed" : e.getMessage();
        String code = PASS_THROUGH_ERROR_CODES.contains(message) ? message : "plugin_service_failed";
        if (e instanceof AccountException ae && (ae.getKind() == AccountException.Kind.NOT_CONNECTED
                || ae.getKind() == AccountException.Kind.UNAUTHORIZED)) {
            code = "account_required";
        }
        if (com.checkba.service.ai.mcp.PluginMcpEndpointPolicy.isFakeIpResolutionFailure(e)) code = "dns_resolution_failed";
        return ResponseEntity.badRequest().body(Map.of("code", 1, "errorCode", code, "message", message));
    }
}
