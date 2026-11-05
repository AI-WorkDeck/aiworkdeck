// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.controller;

import com.checkba.service.UserActivityLogService;
import lombok.Data;
import lombok.RequiredArgsConstructor;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDate;
import java.util.HashMap;
import java.util.Map;

@RestController
@RequestMapping("/api/activity")
@RequiredArgsConstructor
public class ActivityLogController {

    private final UserActivityLogService userActivityLogService;

    // X-Session-Id 一律 required=false：local-mode 免登请求不带 header，required
    // 会在进 controller 前被 Spring 以 MissingRequestHeaderException 500 掉；
    // 身份判定统一交给 getUserIdFromSession（server 模式 null header 仍按未登录拒绝）。
    @PostMapping("/log")
    public Map<String, Object> logActivity(
            @RequestBody LogRequest request,
            @RequestHeader(value = "X-Session-Id", required = false) String sessionId) {
        
        Long userId = AuthController.getUserIdFromSession(sessionId);
        if (userId == null) {
            throw new IllegalArgumentException("未登录");
        }

        userActivityLogService.logActivity(
                userId,
                request.getActionType(),
                request.getTargetId(),
                request.getTargetName(),
                request.getDuration(),
                request.getMetaInfo(),
                request.getProjectId()
        );

        Map<String, Object> result = new HashMap<>();
        result.put("code", 0);
        result.put("message", "Logged");
        return result;
    }

    // from/to：yyyy-MM-dd，可选（dev-board#1713）。都不传时与旧版一致：最近 500 条。
    @GetMapping("/history")
    public Map<String, Object> getActivityHistory(
            @RequestHeader(value = "X-Session-Id", required = false) String sessionId,
            @RequestParam(value = "from", required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam(value = "to", required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to) {
        
        Long userId = AuthController.getUserIdFromSession(sessionId);
        if (userId == null) {
            throw new IllegalArgumentException("未登录");
        }

        var page = userActivityLogService.getUserLogs(userId, from, to);

        Map<String, Object> result = new HashMap<>();
        result.put("code", 0);
        result.put("data", page.logs());
        result.put("truncated", page.truncated());
        return result;
    }

    static class LogRequest {
        private String actionType;
        private Long targetId;
        private String targetName;
        private Long duration;
        private String metaInfo;
        private Long projectId;

        public String getActionType() { return actionType; }
        public void setActionType(String actionType) { this.actionType = actionType; }
        public Long getTargetId() { return targetId; }
        public void setTargetId(Long targetId) { this.targetId = targetId; }
        public String getTargetName() { return targetName; }
        public void setTargetName(String targetName) { this.targetName = targetName; }
        public Long getDuration() { return duration; }
        public void setDuration(Long duration) { this.duration = duration; }
        public String getMetaInfo() { return metaInfo; }
        public void setMetaInfo(String metaInfo) { this.metaInfo = metaInfo; }
        public Long getProjectId() { return projectId; }
        public void setProjectId(Long projectId) { this.projectId = projectId; }
    }
}
