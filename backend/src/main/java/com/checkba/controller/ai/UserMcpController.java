// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.controller.ai;

import com.checkba.controller.AuthController;
import com.checkba.service.LangText;
import com.checkba.service.ai.mcp.PluginMcpException;
import com.checkba.service.ai.mcp.UserMcpConnectionService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.util.Map;
import java.util.List;

@RestController
@RequestMapping("/api/mcp")
public class UserMcpController {
    private final UserMcpConnectionService service;
    public UserMcpController(UserMcpConnectionService service) { this.service = service; }
    @GetMapping("/presets")
    public Map<String, Object> presets(@RequestHeader(value="X-Session-Id", required=false) String session) {
        user(session); return Map.of("code", 0, "presets", service.presets());
    }
    @GetMapping("/connections")
    public Map<String, Object> list(@RequestHeader(value="X-Session-Id", required=false) String session) {
        return service.snapshot(user(session));
    }
    @PostMapping("/connections")
    public Map<String, Object> create(@RequestHeader(value="X-Session-Id", required=false) String session,
            @RequestBody UserMcpConnectionService.Update input,
            @RequestHeader(value="X-MCP-Scope", required=false) String expectedScope) {
        return Map.of("code", 0, "connection", service.save(user(session), null, input, expectedScope));
    }
    @PutMapping("/connections/{id}")
    public Map<String, Object> save(@RequestHeader(value="X-Session-Id", required=false) String session,
            @PathVariable String id, @RequestBody UserMcpConnectionService.Update input,
            @RequestHeader(value="X-MCP-Scope", required=false) String expectedScope) {
        return Map.of("code", 0, "connection", service.save(user(session), id, input, expectedScope));
    }
    @DeleteMapping("/connections/{id}")
    public Map<String, Object> delete(@RequestHeader(value="X-Session-Id", required=false) String session, @PathVariable String id,
            @RequestHeader(value="X-MCP-Scope", required=false) String expectedScope) {
        service.delete(user(session), id, expectedScope); return Map.of("code", 0);
    }
    public record TestOptions(boolean allowLocalExecution, Long expectedRevision) {}
    @PostMapping("/connections/{id}/test")
    public Map<String, Object> test(@RequestHeader(value="X-Session-Id", required=false) String session, @PathVariable String id,
            @RequestHeader(value="X-MCP-Scope", required=false) String expectedScope,
            @RequestBody(required=false) TestOptions options) {
        return Map.of("code", 0, "connection", service.test(user(session), id, expectedScope, options != null && options.allowLocalExecution(), options == null ? null : options.expectedRevision()));
    }
    public record Enabled(boolean enabled) {}
    @PostMapping("/connections/{id}/enable")
    public Map<String, Object> enable(@RequestHeader(value="X-Session-Id", required=false) String session,
            @PathVariable String id, @RequestBody Enabled body,
            @RequestHeader(value="X-MCP-Scope", required=false) String expectedScope) {
        return Map.of("code", 0, "connection", service.enable(user(session), id, body.enabled(), expectedScope));
    }
    public record ImportRequest(String json, List<Integer> selectedIndices) {}
    @PostMapping("/import/preview")
    public Map<String, Object> preview(@RequestHeader(value="X-Session-Id", required=false) String session,
            @RequestHeader(value="X-MCP-Scope", required=false) String scope, @RequestBody ImportRequest input) {
        return service.previewImport(user(session), input.json(), scope);
    }
    @PostMapping("/import")
    public Map<String, Object> importConnections(@RequestHeader(value="X-Session-Id", required=false) String session,
            @RequestHeader(value="X-MCP-Scope", required=false) String scope, @RequestBody ImportRequest input) {
        return service.importConnections(user(session), input.json(), input.selectedIndices(), scope);
    }
    @PostMapping("/connections/{id}/oauth/authorize")
    public Map<String, Object> authorize(@RequestHeader(value="X-Session-Id", required=false) String session, @PathVariable String id,
            @RequestHeader(value="X-MCP-Scope", required=false) String scope) {
        Map<String, Object> result = new java.util.LinkedHashMap<>(service.authorize(user(session), id, scope));
        result.put("code", 0); return result;
    }
    @DeleteMapping("/connections/{id}/oauth")
    public Map<String, Object> disconnectOAuth(@RequestHeader(value="X-Session-Id", required=false) String session, @PathVariable String id,
            @RequestHeader(value="X-MCP-Scope", required=false) String scope) {
        service.disconnectOAuth(user(session), id, scope); return Map.of("code", 0);
    }
    private Long user(String session) {
        Long user = AuthController.getUserIdFromSession(session);
        if (user == null) throw new PluginMcpException("not_authenticated", 401, LangText.of("请先登录。", "Sign in first."));
        return user;
    }
    @ExceptionHandler(PluginMcpException.class)
    public ResponseEntity<?> error(PluginMcpException e) {
        String message = switch (e.code()) {
            case "invalid_endpoint" -> LangText.of("仅支持不含凭据、查询参数或片段的公网 HTTPS 地址。", "Use a public HTTPS URL without credentials, query parameters or a fragment.");
            case "authentication_required", "invalid_credential" -> LangText.of("请检查此服务的凭据或重新授权，然后测试连接。", "Check this service's credentials or authorize again, then test the connection.");
            case "transport_error" -> LangText.of("MCP 连接失败或超时，请检查地址及网络。", "The MCP connection failed or timed out. Check its URL and network.");
            case "protocol_error", "remote_error", "session_expired", "response_too_large" -> LangText.of("MCP 服务未返回有效响应，请检查服务状态后重试。", "The MCP service did not return a valid response. Check its status and retry.");
            case "schema_mismatch", "invalid_schema" -> LangText.of("MCP 工具定义已变化或不受支持，请重新测试连接。", "The MCP tool schema changed or is unsupported. Test the connection again.");
            case "cancelled" -> LangText.of("连接或权限已改变，本次操作已停止。", "The connection or permission changed; this operation stopped.");
            default -> e.getMessage();
        };
        return ResponseEntity.status(e.status()).body(Map.of("code", 1, "errorCode", e.code(), "message", message));
    }
}
