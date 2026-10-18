// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.controller.ai;

import com.checkba.controller.AuthController;
import com.checkba.service.ai.mcp.PluginMcpException;
import com.checkba.service.ai.mcp.PluginMcpService;
import com.checkba.service.ai.tools.ToolContext;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.util.Map;

@RestController
@RequestMapping("/api/plugins/{id}/mcp")
public class PluginMcpController {
    private final PluginMcpService service;
    public PluginMcpController(PluginMcpService service) { this.service = service; }
    public record CallRequest(String serverId, String name, Map<String, Object> arguments, Long projectId) {}
    @GetMapping("/servers")
    public ResponseEntity<?> servers(@PathVariable("id") String id, @RequestParam("projectId") Long projectId,
                                    @RequestHeader(value = "X-Session-Id", required = false) String session) {
        try { return ResponseEntity.ok(Map.of("code", 0, "servers", service.servers(id, AuthController.getUserIdFromSession(session), projectId))); }
        catch (PluginMcpException e) { return failure(e); }
    }
    @PostMapping("/call")
    public ResponseEntity<?> call(@PathVariable("id") String id, @RequestBody CallRequest request,
                                 @RequestHeader(value = "X-Session-Id", required = false) String session) {
        try {
            var context = new ToolContext(request.projectId(), null, AuthController.getUserIdFromSession(session), null);
            return ResponseEntity.ok(Map.of("code", 0, "result", service.call(id, request.serverId(), request.name(), request.arguments(), context)));
        } catch (PluginMcpException e) { return failure(e); }
    }
    private ResponseEntity<?> failure(PluginMcpException e) {
        return ResponseEntity.status(e.status()).body(Map.of("code", 1, "errorCode", e.code(), "message", e.getMessage()));
    }
}
