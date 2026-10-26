// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.controller.ai;

import com.checkba.controller.AuthController;
import com.checkba.service.ai.VersionToolActionService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import java.util.Map;

@RestController
@RequestMapping("/api/ai/agent/version-action")
@RequiredArgsConstructor
public class VersionToolActionController {
    private final VersionToolActionService actions;
    public record ExecuteRequest(String operationId, String conversationId) {}
    public record MergeRequest(String operationId, String conversationId, String stepId, String kind, String path) {}

    @GetMapping("/state")
    public Map<String, Object> state(@RequestParam String operationId, @RequestParam String conversationId,
            @RequestParam(required = false) String stepId,
            @RequestHeader(value = "X-Session-Id", required = false) String sessionId) {
        return Map.of("code", 0, "data", actions.state(operationId, conversationId,
                AuthController.getUserIdFromSession(sessionId), stepId));
    }

    @PostMapping("/execute")
    public Map<String, Object> execute(@RequestBody ExecuteRequest request,
            @RequestHeader(value = "X-Session-Id", required = false) String sessionId) {
        return Map.of("code", 0, "data", actions.execute(request.operationId(), request.conversationId(),
                AuthController.getUserIdFromSession(sessionId), sessionId));
    }

    @PostMapping("/merge")
    public Map<String, Object> merge(@RequestBody MergeRequest request,
            @RequestHeader(value = "X-Session-Id", required = false) String sessionId) {
        return Map.of("code", 0, "data", actions.mergeStep(request.operationId(), request.conversationId(),
                AuthController.getUserIdFromSession(sessionId), sessionId, request.stepId(), request.kind(), request.path(), null));
    }

    @PostMapping("/merge-file")
    public Map<String, Object> mergeFile(@RequestParam String operationId, @RequestParam String conversationId,
            @RequestParam String stepId, @RequestParam String path, @RequestPart MultipartFile file,
            @RequestHeader(value = "X-Session-Id", required = false) String sessionId) {
        return Map.of("code", 0, "data", actions.mergeStep(operationId, conversationId,
                AuthController.getUserIdFromSession(sessionId), sessionId, stepId, "file", path, file));
    }
}
