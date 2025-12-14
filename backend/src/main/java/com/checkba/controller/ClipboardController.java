package com.checkba.controller;

import com.checkba.service.ClipboardService;
import lombok.Data;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.Map;

@RestController
@RequestMapping("/api/clipboard")
@CrossOrigin(origins = "*")
@RequiredArgsConstructor
public class ClipboardController {

    private final ClipboardService clipboardService;

    @GetMapping
    public ResponseEntity<?> list(
            @RequestHeader(value = "X-Session-Id", required = false) String sessionId,
            @RequestParam(value = "q", required = false) String q,
            @RequestParam(value = "limit", required = false, defaultValue = "50") int limit
    ) {
        Long userId = AuthController.getUserIdFromSession(sessionId);
        if (userId == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(error("请先登录"));
        }
        return ResponseEntity.ok(clipboardService.list(userId, q, limit));
    }

    @PostMapping("/text")
    public ResponseEntity<?> saveText(
            @RequestHeader(value = "X-Session-Id", required = false) String sessionId,
            @RequestBody SaveTextRequest request
    ) {
        Long userId = AuthController.getUserIdFromSession(sessionId);
        if (userId == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(error("请先登录"));
        }
        return ResponseEntity.ok(success(clipboardService.saveText(userId, request.getText())));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<?> delete(
            @RequestHeader(value = "X-Session-Id", required = false) String sessionId,
            @PathVariable Long id
    ) {
        Long userId = AuthController.getUserIdFromSession(sessionId);
        if (userId == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(error("请先登录"));
        }
        clipboardService.delete(id, userId);
        Map<String, Object> ok = new HashMap<>();
        ok.put("code", 0);
        ok.put("message", "删除成功");
        ok.put("data", new HashMap<>());
        return ResponseEntity.ok(ok);
    }

    private Map<String, Object> error(String message) {
        Map<String, Object> result = new HashMap<>();
        result.put("code", 1);
        result.put("message", message);
        result.put("data", new HashMap<>());
        return result;
    }

    private Map<String, Object> success(Object data) {
        Map<String, Object> result = new HashMap<>();
        result.put("code", 0);
        result.put("message", "OK");
        result.put("data", data);
        return result;
    }

    @Data
    public static class SaveTextRequest {
        private String text;
    }
}

