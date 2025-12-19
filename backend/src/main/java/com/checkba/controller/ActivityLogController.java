package com.checkba.controller;

import com.checkba.service.UserActivityLogService;
import lombok.Data;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.Map;

@RestController
@RequestMapping("/api/activity")
@RequiredArgsConstructor
@CrossOrigin(origins = "*")
public class ActivityLogController {

    private final UserActivityLogService userActivityLogService;

    @PostMapping("/log")
    public Map<String, Object> logActivity(
            @RequestBody LogRequest request,
            @RequestHeader(value = "X-Session-Id") String sessionId) {
        
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
                request.getMetaInfo()
        );

        Map<String, Object> result = new HashMap<>();
        result.put("code", 0);
        result.put("message", "Logged");
        return result;
    }

    @GetMapping("/history")
    public Map<String, Object> getActivityHistory(
            @RequestHeader(value = "X-Session-Id") String sessionId) {
        
        Long userId = AuthController.getUserIdFromSession(sessionId);
        if (userId == null) {
            throw new IllegalArgumentException("未登录");
        }

        var logs = userActivityLogService.getUserLogs(userId);

        Map<String, Object> result = new HashMap<>();
        result.put("code", 0);
        result.put("data", logs);
        return result;
    }

    @Data
    static class LogRequest {
        private String actionType;
        private Long targetId;
        private String targetName;
        private Long duration;
        private String metaInfo;
    }
}
