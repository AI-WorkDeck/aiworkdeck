package com.checkba.controller;

import com.checkba.model.entity.User;
import com.checkba.service.UserService;
import lombok.Data;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.Map;

@RestController
@RequestMapping("/api/auth")
@CrossOrigin(origins = "*")
public class AuthController {

    private final UserService userService;

    // 简单的 session 存储（内存中，实际生产环境应使用 Redis 或 JWT）
    private static final Map<String, Long> SESSION_STORE = new HashMap<>();

    public AuthController(UserService userService) {
        this.userService = userService;
    }

    /**
     * 用户注册
     */
    @PostMapping("/register")
    public Map<String, Object> register(@RequestBody RegisterRequest request) {
        try {
            User user = userService.register(
                    request.getUsername(),
                    request.getPassword(),
                    request.getDisplayName()
            );

            // 注册成功后自动登录
            String sessionId = generateSessionId();
            SESSION_STORE.put(sessionId, user.getId());

            Map<String, Object> result = new HashMap<>();
            result.put("code", 0);
            result.put("message", "注册成功");
            result.put("data", Map.of(
                    "sessionId", sessionId,
                    "user", Map.of(
                            "id", user.getId(),
                            "username", user.getUsername(),
                            "displayName", user.getDisplayName(),
                            "avatarUrl", user.getAvatarUrl() != null ? user.getAvatarUrl() : ""
                    )
            ));
            return result;
        } catch (IllegalArgumentException e) {
            Map<String, Object> result = new HashMap<>();
            result.put("code", 1);
            result.put("message", e.getMessage());
            return result;
        }
    }

    /**
     * 用户登录
     */
    @PostMapping("/login")
    public Map<String, Object> login(@RequestBody LoginRequest request) {
        try {
            User user = userService.login(request.getUsername(), request.getPassword());

            String sessionId = generateSessionId();
            SESSION_STORE.put(sessionId, user.getId());

            Map<String, Object> result = new HashMap<>();
            result.put("code", 0);
            result.put("message", "登录成功");
            result.put("data", Map.of(
                    "sessionId", sessionId,
                    "user", Map.of(
                            "id", user.getId(),
                            "username", user.getUsername(),
                            "displayName", user.getDisplayName(),
                            "avatarUrl", user.getAvatarUrl() != null ? user.getAvatarUrl() : ""
                    )
            ));
            return result;
        } catch (IllegalArgumentException e) {
            Map<String, Object> result = new HashMap<>();
            result.put("code", 1);
            result.put("message", e.getMessage());
            return result;
        }
    }

    /**
     * 获取当前登录用户信息
     */
    @GetMapping("/me")
    public Map<String, Object> getCurrentUser(@RequestHeader(value = "X-Session-Id", required = false) String sessionId) {
        if (sessionId == null || !SESSION_STORE.containsKey(sessionId)) {
            Map<String, Object> result = new HashMap<>();
            result.put("code", 1);
            result.put("message", "未登录");
            return result;
        }

        Long userId = SESSION_STORE.get(sessionId);
        User user = userService.getUserById(userId);

        Map<String, Object> result = new HashMap<>();
        result.put("code", 0);
        result.put("data", Map.of(
                "id", user.getId(),
                "username", user.getUsername(),
                "displayName", user.getDisplayName(),
                "avatarUrl", user.getAvatarUrl() != null ? user.getAvatarUrl() : ""
        ));
        return result;
    }

    /**
     * 用户登出
     */
    @PostMapping("/logout")
    public Map<String, Object> logout(@RequestHeader(value = "X-Session-Id", required = false) String sessionId) {
        if (sessionId != null) {
            SESSION_STORE.remove(sessionId);
        }
        Map<String, Object> result = new HashMap<>();
        result.put("code", 0);
        result.put("message", "登出成功");
        return result;
    }

    /**
     * 根据 sessionId 获取用户 ID（供其他 Controller 使用）
     */
    public static Long getUserIdFromSession(String sessionId) {
        return SESSION_STORE.get(sessionId);
    }

    private String generateSessionId() {
        return "session_" + System.currentTimeMillis() + "_" + String.valueOf(Math.random()).substring(2, 15);
    }

    @Data
    static class RegisterRequest {
        private String username;
        private String password;
        private String displayName;
    }

    @Data
    static class LoginRequest {
        private String username;
        private String password;
    }
}

