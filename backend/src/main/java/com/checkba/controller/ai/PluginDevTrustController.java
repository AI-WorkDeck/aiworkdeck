// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.controller.ai;

import com.checkba.controller.AuthController;
import com.checkba.repository.UserRepository;
import com.checkba.service.AdminAccessService;
import com.checkba.service.ai.PluginDevTrustService;
import com.checkba.service.ai.PluginService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.util.Map;
import java.util.NoSuchElementException;

@RestController
@RequestMapping("/api/plugins/{id}/dev-trust")
public class PluginDevTrustController {
    private final PluginService plugins;
    private final AdminAccessService admins;
    private final UserRepository users;
    public PluginDevTrustController(PluginService plugins, AdminAccessService admins, UserRepository users) {
        this.plugins = plugins; this.admins = admins; this.users = users;
    }
    public record TrustRequest(Boolean trusted) {}

    @GetMapping
    public ResponseEntity<Map<String, Object>> get(@PathVariable("id") String id,
            @RequestHeader(value = "X-Session-Id", required = false) String session) {
        if (AuthController.getUserIdFromSession(session) == null) return failure(401, "Sign in required");
        try { return success(PluginDevTrustService.status(plugins, id)); }
        catch (NoSuchElementException e) { return failure(404, "Plugin not found"); }
        catch (IllegalArgumentException e) { return failure(400, e.getMessage()); }
    }

    @PostMapping
    public ResponseEntity<Map<String, Object>> set(@PathVariable("id") String id, @RequestBody TrustRequest request,
            @RequestHeader(value = "X-Session-Id", required = false) String session) {
        Long user = AuthController.getUserIdFromSession(session);
        if (user == null) return failure(401, "Sign in required");
        if (!users.findById(user).map(admins::isAdmin).orElse(false)) return failure(403, "Administrator permission required");
        if (request == null || request.trusted() == null) return failure(400, "trusted must be a boolean");
        try { return success(PluginDevTrustService.setTrusted(plugins, id, request.trusted())); }
        catch (NoSuchElementException e) { return failure(404, "Plugin not found"); }
        catch (IllegalArgumentException | IllegalStateException e) { return failure(400, e.getMessage()); }
    }
    private static ResponseEntity<Map<String, Object>> success(PluginDevTrustService.Status state) {
        return ResponseEntity.ok(Map.of("code", 0, "devInstalled", state.devInstalled(), "trusted", state.trusted()));
    }
    private static ResponseEntity<Map<String, Object>> failure(int status, String message) {
        return ResponseEntity.status(status).body(Map.of("code", 1, "message", message));
    }
}
