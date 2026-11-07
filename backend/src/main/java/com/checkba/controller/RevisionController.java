// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.controller;

import com.checkba.service.LangText;
import com.checkba.service.revision.PendingRevisionService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 外部 Agent 待审修订（docs/plans/agent-app-control.md C7）。
 * 鉴权照 TaskController：X-Session-Id；权限不足抛 IllegalArgumentException 由 GlobalExceptionHandler 转 code=1。
 * 基线过期回 code=4090 + data.status=STALE（HTTP 200，同全站约定）。
 */
@RestController
@RequestMapping("/api/revisions/pending")
public class RevisionController {

    public static final int CODE_STALE = 4090;

    private final PendingRevisionService service;

    public RevisionController(PendingRevisionService service) {
        this.service = service;
    }

    private Long user(String sessionId) {
        Long userId = AuthController.getUserIdFromSession(sessionId);
        if (userId == null) throw new IllegalArgumentException(LangText.of("未登录", "Not signed in"));
        return userId;
    }

    @GetMapping
    public ResponseEntity<Map<String, Object>> list(
            @RequestParam(required = false) Long projectId,
            @RequestParam(required = false) Long fileId,
            @RequestHeader(value = "X-Session-Id", required = false) String sessionId) {
        Long userId = user(sessionId);
        List<Map<String, Object>> rows;
        if (fileId != null) rows = service.listByFile(userId, fileId);
        else if (projectId != null) rows = service.listByProject(userId, projectId);
        else throw new IllegalArgumentException(LangText.of("需要 projectId 或 fileId", "projectId or fileId is required"));
        return ok(Map.of("revisions", rows));
    }

    /** 校验基线并返回要套用的 edits（前端经编辑器执行器落修订）；基线过期回 code=4090。 */
    @PostMapping("/{id}/accept")
    public ResponseEntity<Map<String, Object>> accept(
            @PathVariable Long id,
            @RequestHeader(value = "X-Session-Id", required = false) String sessionId) {
        Long userId = user(sessionId);
        try {
            return ok(service.accept(userId, id));
        } catch (PendingRevisionService.StaleRevisionException e) {
            Map<String, Object> r = new HashMap<>();
            r.put("code", CODE_STALE);
            r.put("message", e.getMessage());
            r.put("data", Map.of("status", "STALE"));
            return ResponseEntity.ok(r);
        }
    }

    /** body: {appliedCount} —— 已落入文档的累计条数，失败后从断点继续。 */
    @PostMapping("/{id}/progress")
    public ResponseEntity<Map<String, Object>> progress(
            @PathVariable Long id,
            @RequestBody Map<String, Object> body,
            @RequestHeader(value = "X-Session-Id", required = false) String sessionId) {
        Object n = body == null ? null : body.get("appliedCount");
        if (!(n instanceof Number num)) throw new IllegalArgumentException(LangText.of("缺少 appliedCount", "appliedCount is required"));
        service.recordProgress(user(sessionId), id, num.intValue());
        return ok(Map.of("appliedCount", num.intValue()));
    }

    /** 前端全部 edits 套用成功后调用，删除提案。 */
    @PostMapping("/{id}/applied")
    public ResponseEntity<Map<String, Object>> applied(
            @PathVariable Long id,
            @RequestHeader(value = "X-Session-Id", required = false) String sessionId) {
        service.markApplied(user(sessionId), id);
        return ok(Map.of("applied", true));
    }

    @PostMapping("/{id}/reject")
    public ResponseEntity<Map<String, Object>> reject(
            @PathVariable Long id,
            @RequestHeader(value = "X-Session-Id", required = false) String sessionId) {
        service.reject(user(sessionId), id);
        return ok(Map.of("rejected", true));
    }

    private ResponseEntity<Map<String, Object>> ok(Map<String, Object> data) {
        return ResponseEntity.ok(Map.of("code", 0, "data", data));
    }
}
