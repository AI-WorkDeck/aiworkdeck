// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.controller.internal;

import com.checkba.repository.AccountBindingRepository;
import com.checkba.service.audit.FirmAuditLog;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * 律所审计日志的内部上报口（readiness S20）：官网（同机 Next，127.0.0.1）把只在官网发生的事
 * ——入所/退所/被移出、角色变更、官网登录失败、账户 Key 签发与吊销——写进案件库的同一份律所审计日志。
 *
 * <p>闸门与 {@link InternalRefController} 同一套，任一不满足都回<b>裸 404</b>（与公网 nginx 的
 * {@code ^~ /api/internal/} 兜底同一副面孔）：
 * <ol>
 *   <li>{@code audit.ingest.serve} 未开（只有 case profile 打开）；</li>
 *   <li>{@code audit.ingest.secret} 未配置（与名录、参考口是不同的密钥）；</li>
 *   <li>{@code X-Internal-Secret} 不等（常量时间比较）；</li>
 *   <li>来源不是回环地址。</li>
 * </ol>
 *
 * <p>只收白名单里的动作与类别，detail 只收标量且键名受限；{@code eventId} 是幂等键（官网重试安全）。
 * 入队即回，不等落库。
 */
@RestController
@RequestMapping("/api/internal/firm-audit")
public class InternalFirmAuditController {

    /** 官网能上报的动作（与官网 lib/firm-audit.ts 一一对应）。 */
    static final Map<String, String> ACTIONS = Map.ofEntries(
            Map.entry("FIRM_MEMBER_JOINED", "MEMBERSHIP"),
            Map.entry("FIRM_MEMBER_LEFT", "MEMBERSHIP"),
            Map.entry("FIRM_MEMBER_REMOVED", "MEMBERSHIP"),
            Map.entry("FIRM_ROLE_CHANGED", "MEMBERSHIP"),
            Map.entry("FIRM_TEAM_JOINED", "MEMBERSHIP"),
            Map.entry("FIRM_TEAM_LEFT", "MEMBERSHIP"),
            Map.entry("FIRM_TEAM_REMOVED", "MEMBERSHIP"),
            Map.entry("FIRM_CREATED", "SETTINGS"),
            Map.entry("FIRM_JOIN_CODE_REGENERATED", "SETTINGS"),
            Map.entry("WEBSITE_LOGIN_FAILED", "AUTH"),
            Map.entry("ACCOUNT_API_KEY_CREATED", "DEVICES"),
            Map.entry("ACCOUNT_API_KEY_REVOKED", "DEVICES"));

    static final Set<String> DETAIL_KEYS = Set.of("via", "role", "fromRole", "toRole", "firmAdmin", "teamId", "teamName",
            "memberCount", "keyPrefix", "label", "reason", "removedBy");

    private static final Pattern EVENT_ID = Pattern.compile("[A-Za-z0-9-]{8,64}");
    private static final Pattern FIRM_ID = Pattern.compile("[A-Za-z0-9_-]{1,64}");

    private final boolean serve;
    private final String secret;
    private final FirmAuditLog audit;
    private final AccountBindingRepository bindings;

    public InternalFirmAuditController(@Value("${audit.ingest.serve:false}") boolean serve,
                                       @Value("${audit.ingest.secret:}") String secret,
                                       FirmAuditLog audit, AccountBindingRepository bindings) {
        this.serve = serve;
        this.secret = secret == null ? "" : secret.trim();
        this.audit = audit;
        this.bindings = bindings;
    }

    @PostMapping
    public ResponseEntity<Map<String, Object>> ingest(@RequestBody(required = false) Map<String, Object> body,
                                                      @RequestHeader(value = "X-Internal-Secret", required = false) String header,
                                                      HttpServletRequest request) {
        if (!serve || secret.isEmpty() || header == null
                || !MessageDigest.isEqual(secret.getBytes(StandardCharsets.UTF_8), header.trim().getBytes(StandardCharsets.UTF_8))
                || !InternalRefController.loopback(request == null ? null : request.getRemoteAddr())) {
            return ResponseEntity.notFound().build();
        }
        if (body == null) return bad("body");
        String eventId = str(body.get("eventId"));
        String firmId = str(body.get("firmId"));
        String action = str(body.get("action"));
        if (eventId == null || !EVENT_ID.matcher(eventId).matches()) return bad("eventId");
        if (firmId == null || !FIRM_ID.matcher(firmId).matches()) return bad("firmId");
        String category = action == null ? null : ACTIONS.get(action);
        if (category == null) return bad("action");
        Instant at;
        try {
            at = body.get("occurredAt") instanceof String s ? Instant.parse(s) : Instant.now();
        } catch (Exception e) {
            return bad("occurredAt");
        }

        String accountId = str(body.get("actorAccountId"));
        FirmAuditLog.Event e = FirmAuditLog.event(category, action).firm(firmId).eventId(eventId).source("website").at(at)
                .actorName(str(body.get("actorName")))
                .from(str(body.get("sourceIp")), str(body.get("userAgent")))
                .target(str(body.get("targetType")), str(body.get("targetId")), str(body.get("targetLabel")));
        if (accountId != null) {
            bindings.findByExternalAccountId(accountId).ifPresent(b -> e.actor(b.getUserId()));
            e.detail("actorAccountId", accountId);
        }
        if ("FAILURE".equals(body.get("outcome")) || action.endsWith("_FAILED")) e.failed();
        if (body.get("detail") instanceof Map<?, ?> d) {
            d.forEach((k, v) -> {
                if (k instanceof String key && DETAIL_KEYS.contains(key)) e.detail(key, v);
            });
        }
        audit.recordNow(e);
        return ResponseEntity.ok(Map.of("code", 0, "accepted", true));
    }

    private static ResponseEntity<Map<String, Object>> bad(String field) {
        return ResponseEntity.badRequest().body(Map.of("code", 1, "message", "invalid " + field));
    }

    private static String str(Object v) {
        if (!(v instanceof String s)) return null;
        String t = s.strip();
        return t.isEmpty() ? null : t;
    }
}
