// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.controller.ai;

import com.checkba.controller.AuthController;
import com.checkba.repository.UserRepository;
import com.checkba.service.AdminAccessService;
import com.checkba.service.ai.PluginBundledInstaller;
import com.checkba.service.ai.PluginService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.util.Map;

@RestController
@RequestMapping("/api/plugins/bundled")
@RequiredArgsConstructor
public class PluginBundledController {
    private final PluginBundledInstaller installer;
    private final PluginService plugins;
    private final UserRepository users;
    private final AdminAccessService admins;

    @GetMapping
    public ResponseEntity<Map<String, Object>> list(@RequestHeader(value="X-Session-Id", required=false) String session) {
        if (AuthController.getUserIdFromSession(session) == null) return ResponseEntity.status(401).body(Map.of("code", 1, "message", "Sign in required"));
        return ResponseEntity.ok(Map.of("code", 0, "plugins", installer.available()));
    }

    @PostMapping("/{id}/install")
    public ResponseEntity<Map<String, Object>> install(@PathVariable String id,
            @RequestHeader(value="X-Session-Id", required=false) String session) {
        Long userId = AuthController.getUserIdFromSession(session);
        if (userId == null || !users.findById(userId).map(admins::isAdmin).orElse(false)) {
            return ResponseEntity.status(403).body(Map.of("code", 1, "message", "Administrator permission required"));
        }
        try {
            synchronized (plugins) {
                if (plugins.getPlugin(id) == null) plugins.markDisabledBeforeLoad(id);
                installer.install(id);
                plugins.rescan();
            }
            return ResponseEntity.ok(Map.of("code", 0));
        } catch (RuntimeException e) {
            return ResponseEntity.badRequest().body(Map.of("code", 1, "message", "Bundled plugin installation failed"));
        }
    }
}
