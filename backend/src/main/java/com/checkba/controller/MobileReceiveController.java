// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.controller;

import com.checkba.exception.UnauthorizedException;
import com.checkba.service.mobile.MobileRelayClientService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.util.Map;

/** 本机收件进度；云端不注册，也不暴露设备令牌。 */
@RestController
@RequestMapping("/api/mobile-receive")
@ConditionalOnProperty(name = "security.local-mode", havingValue = "true")
public class MobileReceiveController {
    private static final Logger log = LoggerFactory.getLogger(MobileReceiveController.class);
    private final MobileRelayClientService client;

    public MobileReceiveController(MobileRelayClientService client) {
        this.client = client;
    }

    // 未登录走全局 4010（UnauthorizedException；中文字面量在出口按语言翻译），前端据此处理会话失效（问题 6）
    private void requireUser(String session) {
        if (AuthController.getUserIdFromSession(session) == null) throw new UnauthorizedException("请先登录");
    }

    /**
     * 云端目录 / 收件链路的失败（MobileRelayClientService 抛的 IllegalStateException，message 都是
     * LangText 用户文案）在本控制器内透出，别被全局兜底成「服务器内部错误」（问题 6）。只管这个控制器。
     */
    @ExceptionHandler(IllegalStateException.class)
    public ResponseEntity<Map<String, Object>> handleRelayFailure(IllegalStateException e) {
        log.warn("mobile-receive 请求失败: {}", e.getMessage(), e.getCause());
        String message = e.getMessage() != null && !e.getMessage().isBlank() ? e.getMessage()
                : com.checkba.service.LangText.of("云端请求失败", "Cloud request failed");
        return ResponseEntity.ok(Map.of("code", 1, "message", message));
    }

    @GetMapping("/catalog")
    public java.util.List<Map<String, Object>> catalog(
            @RequestHeader(value = "X-Session-Id", required = false) String session) {
        requireUser(session);
        return client.catalog();
    }

    @PostMapping("/catalog/request")
    public com.fasterxml.jackson.databind.JsonNode catalogRequest(
            @RequestBody com.fasterxml.jackson.databind.JsonNode body,
            @RequestHeader(value = "X-Session-Id", required = false) String session) {
        requireUser(session);
        client.requireCatalogAccountScope(body.path("accountScope").asText());
        return client.catalogRequest(body.path("method").asText(), body.path("path").asText(), body.get("body"), body.path("accountScope").asText());
    }
    @PostMapping("/catalog/import")
    public Map<String, Object> importFile(@RequestBody com.fasterxml.jackson.databind.JsonNode body,
            @RequestHeader(value = "X-Session-Id", required = false) String session) {
        requireUser(session);
        client.requireCatalogAccountScope(body.path("accountScope").asText());
        return client.importCatalogFile(body.path("targetProjectId").asLong(), body.path("projectUid").asText(),
                body.path("fileUid").asText(), body.hasNonNull("transferId") ? body.get("transferId").asLong() : null, body.path("accountScope").asText());
    }

    @GetMapping("/backup-consent")
    public com.fasterxml.jackson.databind.JsonNode backupConsent(
            @RequestHeader(value = "X-Session-Id", required = false) String session) {
        requireUser(session);
        return client.backupConsent();
    }

    @PutMapping("/backup-consent")
    public com.fasterxml.jackson.databind.JsonNode setBackupConsent(
            @RequestBody com.fasterxml.jackson.databind.JsonNode body,
            @RequestHeader(value = "X-Session-Id", required = false) String session) {
        requireUser(session);
        if (!body.path("enabled").isBoolean()) throw new IllegalArgumentException("Missing explicit consent decision");
        return client.setBackupConsent(body.path("enabled").asBoolean(), body.path("consentVersion").asText(),
                body.path("accountScope").asText());
    }

    @GetMapping("/status")
    public Map<String, Object> status(
            @RequestHeader(value = "X-Session-Id", required = false) String session,
            @RequestParam(value = "projectKey", required = false) String projectKey) {
        requireUser(session);
        return client.receiveStatus(projectKey);
    }

    @PostMapping("/check")
    public Map<String, Object> check(@RequestHeader(value = "X-Session-Id", required = false) String session) {
        requireUser(session);
        client.receiveNow();
        return Map.of("code", 0);
    }
}
