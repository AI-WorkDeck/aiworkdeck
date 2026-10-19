// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.controller.ai;

import com.checkba.controller.AuthController;
import com.checkba.service.ai.AgentOrchestrator;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.http.HttpStatus;
import java.util.List;
import java.util.Map;

/** Desktop graceful lifecycle; never enabled on the shared cloud backend. */
@RestController
@RequestMapping("/api/agent/restart")
@ConditionalOnProperty(name = "security.local-mode", havingValue = "true")
public class AgentRestartController {
    private final AgentOrchestrator orchestrator;
    public AgentRestartController(AgentOrchestrator orchestrator) { this.orchestrator = orchestrator; }
    public record Attempt(String attemptId) {}
    public record Resume(String conversationId, Long projectId, Long activeFileId) {}
    private Long user(String sessionId) {
        Long id = AuthController.getUserIdFromSession(sessionId);
        if (id == null) throw new ResponseStatusException(HttpStatus.UNAUTHORIZED);
        return id;
    }
    private String attempt(Attempt body) {
        if (body == null || body.attemptId() == null || body.attemptId().isBlank() || body.attemptId().length() > 128)
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Missing restart attempt id");
        return body.attemptId();
    }
    @PostMapping("/prepare")
    public Map<String,Object> prepare(@RequestHeader(value="X-Session-Id", required=false) String session, @RequestBody Attempt body) {
        return orchestrator.prepareRestart(user(session), attempt(body));
    }
    @PostMapping("/abort")
    public Map<String,Object> abort(@RequestHeader(value="X-Session-Id", required=false) String session, @RequestBody Attempt body) {
        return orchestrator.abortRestart(user(session), attempt(body));
    }
    @GetMapping("/pending")
    public List<AgentOrchestrator.RestartPending> pending(@RequestHeader(value="X-Session-Id", required=false) String session) {
        return orchestrator.pendingRestarts(user(session));
    }
    @PostMapping("/resume")
    public Map<String,Object> resume(@RequestHeader(value="X-Session-Id", required=false) String session, @RequestBody Resume body) {
        if (body.conversationId() == null || body.projectId() == null)
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST);
        try { return Map.of("resumed", orchestrator.resumeRestart(body.conversationId(), body.projectId(), body.activeFileId(), user(session))); }
        catch (SecurityException denied) { throw new ResponseStatusException(HttpStatus.FORBIDDEN); }
    }
}
