// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.controller.ai;

import com.checkba.service.LangText;
import com.checkba.service.LocalIdentityService;
import com.checkba.service.mcpserver.LocalMcpServerSettings;
import com.checkba.service.mcpserver.LocalMcpServerTools;
import com.checkba.util.ProductIdentity;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.RestController;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * AI WorkDeck 作为 MCP 服务器（第一期：本机、只读，docs/plans/stella-alignment/mcp-server.md）。
 *
 * <ul>
 *   <li>{@code POST /mcp}：MCP Streamable HTTP 端点，只回 application/json，不开 SSE 流。
 *       仅单机模式（local-mode）存在；默认关闭，关闭时与不存在一样回 404；
 *       每个请求必须带 {@code Authorization: Bearer awdm_...}；带 Origin 头的请求一律拒绝
 *       （防浏览器页面借 DNS 重绑定打本机端口）。</li>
 *   <li>{@code /api/mcp-server/*}：桌面端开关与令牌签发。</li>
 * </ul>
 */
@RestController
@Slf4j
public class LocalMcpServerController {

    static final List<String> SUPPORTED_PROTOCOL_VERSIONS = List.of("2025-06-18", "2025-03-26", "2024-11-05");

    private final LocalMcpServerSettings settings;
    private final LocalMcpServerTools tools;
    private final LocalIdentityService localIdentity;
    private final ObjectMapper objectMapper;

    public LocalMcpServerController(LocalMcpServerSettings settings, LocalMcpServerTools tools,
                                    LocalIdentityService localIdentity, ObjectMapper objectMapper) {
        this.settings = settings;
        this.tools = tools;
        this.localIdentity = localIdentity;
        this.objectMapper = objectMapper;
    }

    // ---------- 管理接口（桌面端调用） ----------

    @GetMapping("/api/mcp-server/status")
    public ResponseEntity<Map<String, Object>> status(HttpServletRequest request) {
        if (!localIdentity.isLocalMode()) return ResponseEntity.notFound().build();
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("code", 0);
        body.put("enabled", settings.isEnabled());
        body.put("endpoint", endpoint(request));
        return ResponseEntity.ok(body);
    }

    /** 开启或轮换令牌。令牌明文只在这里出现一次。 */
    @PostMapping("/api/mcp-server/enable")
    public ResponseEntity<Map<String, Object>> enable(HttpServletRequest request) {
        if (!localIdentity.isLocalMode()) return ResponseEntity.notFound().build();
        String token = settings.enableAndIssueToken();
        String endpoint = endpoint(request);
        log.info("本机 MCP 服务器已开启（令牌已签发/轮换）");
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("code", 0);
        body.put("enabled", true);
        body.put("endpoint", endpoint);
        body.put("token", token);
        body.put("claudeCodeCommand", "claude mcp add --transport http aiworkdeck " + endpoint
                + " --header \"Authorization: Bearer " + token + "\"");
        return ResponseEntity.ok(body);
    }

    @PostMapping("/api/mcp-server/disable")
    public ResponseEntity<Map<String, Object>> disable() {
        if (!localIdentity.isLocalMode()) return ResponseEntity.notFound().build();
        settings.disable();
        log.info("本机 MCP 服务器已关闭");
        return ResponseEntity.ok(Map.of("code", 0, "enabled", false));
    }

    private static String endpoint(HttpServletRequest request) {
        return "http://127.0.0.1:" + request.getLocalPort() + "/mcp";
    }

    // ---------- MCP 端点 ----------

    /** 不提供服务端主动推送的 SSE 流，也不维护会话：GET / DELETE 一律 405。 */
    @RequestMapping(value = "/mcp", method = {RequestMethod.GET, RequestMethod.DELETE})
    public ResponseEntity<Void> unsupported() {
        if (!localIdentity.isLocalMode() || !settings.isEnabled()) return ResponseEntity.notFound().build();
        return ResponseEntity.status(HttpStatus.METHOD_NOT_ALLOWED).header(HttpHeaders.ALLOW, "POST").build();
    }

    @PostMapping(value = "/mcp", produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<Object> mcp(@RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String auth,
                                      @RequestHeader(value = HttpHeaders.ORIGIN, required = false) String origin,
                                      @RequestBody(required = false) String rawBody) {
        if (!localIdentity.isLocalMode() || !settings.isEnabled()) return ResponseEntity.notFound().build();
        if (origin != null && !origin.isEmpty()) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build();
        }
        String token = auth != null && auth.regionMatches(true, 0, "Bearer ", 0, 7) ? auth.substring(7).trim() : null;
        if (!settings.verify(token)) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                    .header(HttpHeaders.WWW_AUTHENTICATE, "Bearer realm=\"aiworkdeck-mcp\"").build();
        }
        JsonNode message;
        try {
            message = objectMapper.readTree(rawBody == null ? "" : rawBody);
        } catch (JsonProcessingException e) {
            return ResponseEntity.badRequest().body(error(null, -32700, "Parse error"));
        }
        if (message == null || !message.isObject() || !message.hasNonNull("method")) {
            // 2025-06-18 起协议不再支持批量请求；只回应答消息（无 method）也无需处理
            if (message != null && message.isObject() && !message.has("method")) return ResponseEntity.accepted().build();
            return ResponseEntity.badRequest().body(error(null, -32600, "Invalid Request"));
        }
        JsonNode id = message.get("id");
        String method = message.get("method").asText();
        if (id == null || id.isNull()) {
            // 通知（notifications/initialized 等）：无需应答
            return ResponseEntity.accepted().build();
        }
        Object result;
        switch (method) {
            case "initialize" -> result = initializeResult(message.path("params").path("protocolVersion").asText(""));
            case "ping" -> result = Map.of();
            case "tools/list" -> result = Map.of("tools", toolList());
            case "tools/call" -> result = callTool(message.path("params"));
            default -> {
                return ResponseEntity.ok(error(id, -32601, "Method not found: " + method));
            }
        }
        if (result == null) return ResponseEntity.ok(error(id, -32602, "Invalid params"));
        Map<String, Object> response = new LinkedHashMap<>();
        response.put("jsonrpc", "2.0");
        response.put("id", id);
        response.put("result", result);
        return ResponseEntity.ok(response);
    }

    private Map<String, Object> initializeResult(String requested) {
        String version = SUPPORTED_PROTOCOL_VERSIONS.contains(requested) ? requested : SUPPORTED_PROTOCOL_VERSIONS.get(0);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("protocolVersion", version);
        result.put("capabilities", Map.of("tools", Map.of("listChanged", false)));
        result.put("serverInfo", Map.of("name", "aiworkdeck", "title", ProductIdentity.PRODUCT_NAME,
                "version", ProductIdentity.version()));
        result.put("instructions", "Read-only access to the local AI WorkDeck projects. "
                + "Start with list_projects, then list_project_files or search_project, then read_file.");
        return result;
    }

    private List<Map<String, Object>> toolList() {
        return LocalMcpServerTools.DEFINITIONS.stream().map(def -> {
            Map<String, Object> tool = new LinkedHashMap<>();
            tool.put("name", def.name());
            tool.put("description", def.description());
            tool.put("inputSchema", def.inputSchema());
            tool.put("annotations", Map.of("readOnlyHint", true, "destructiveHint", false,
                    "idempotentHint", true, "openWorldHint", false));
            return tool;
        }).toList();
    }

    /** 工具层错误按 MCP 约定放进 result（isError=true），让调用它的模型看得见、能改参数重试。 */
    private Map<String, Object> callTool(JsonNode params) {
        if (!params.path("name").isTextual()) return null;
        String name = params.get("name").asText();
        JsonNode argsNode = params.path("arguments");
        if (!argsNode.isMissingNode() && !argsNode.isNull() && !argsNode.isObject()) return null;
        @SuppressWarnings("unchecked")
        Map<String, Object> args = argsNode.isObject() ? objectMapper.convertValue(argsNode, Map.class) : Map.of();
        Long userId = localIdentity.localUserId();
        log.info("MCP tools/call name={} projectId={} fileId={}", name, args.get("projectId"), args.get("fileId"));
        Map<String, Object> result = new LinkedHashMap<>();
        try {
            Object value = tools.call(name, args, userId);
            result.put("content", List.of(Map.of("type", "text", "text", objectMapper.writeValueAsString(value))));
            result.put("isError", false);
        } catch (LocalMcpServerTools.ToolError e) {
            result.put("content", List.of(Map.of("type", "text", "text", e.getMessage())));
            result.put("isError", true);
        } catch (Exception e) {
            log.warn("MCP tools/call {} failed", name, e);
            result.put("content", List.of(Map.of("type", "text",
                    "text", LangText.of("工具执行失败", "Tool execution failed"))));
            result.put("isError", true);
        }
        return result;
    }

    private static Map<String, Object> error(JsonNode id, int code, String message) {
        Map<String, Object> response = new LinkedHashMap<>();
        response.put("jsonrpc", "2.0");
        response.put("id", id);
        response.put("error", Map.of("code", code, "message", message));
        return response;
    }
}
