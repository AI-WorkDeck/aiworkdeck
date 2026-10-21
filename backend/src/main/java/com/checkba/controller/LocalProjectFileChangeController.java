// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.controller;

import com.checkba.service.LocalProjectFileChangeService;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

@RestController
public class LocalProjectFileChangeController {
    private final LocalProjectFileChangeService changes;
    private final boolean localMode;

    public LocalProjectFileChangeController(LocalProjectFileChangeService changes,
            @Value("${security.local-mode:false}") boolean localMode) {
        this.changes = changes;
        this.localMode = localMode;
    }

    @GetMapping(value = "/api/projects/{projectId}/files/changes", produces = "text/event-stream")
    public ResponseEntity<SseEmitter> connect(@PathVariable Long projectId,
            @RequestHeader(value = "X-Session-Id", required = false) String sessionId) {
        if (!localMode) return ResponseEntity.notFound().build();
        Long userId = AuthController.getUserIdFromSession(sessionId);
        if (userId == null) return ResponseEntity.status(401).build();
        if (!changes.canSubscribe(projectId, userId)) return ResponseEntity.status(403).build();
        return ResponseEntity.ok()
                .header("Cache-Control", "no-cache, no-store")
                .header("X-Accel-Buffering", "no")
                .body(changes.connect(projectId, userId));
    }
}
