// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.controller.ai;

import com.checkba.controller.AuthController;
import com.checkba.service.ai.ChatSuggestionService;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.web.bind.annotation.*;
import java.util.Map;

@RestController
@RequestMapping("/api/ai/suggestions")
@ConditionalOnProperty(name = "security.local-mode", havingValue = "true")
public class ChatSuggestionController {
    private final ChatSuggestionService service;
    public ChatSuggestionController(ChatSuggestionService service) { this.service = service; }
    public record Request(String conversationId, String modelId) {}
    public record Feedback(String clientRequestId, boolean dismissed) {}
    @PostMapping
    public ChatSuggestionService.Suggestion suggest(@RequestBody Request request,
            @RequestHeader(value = "X-Session-Id", required = false) String session) {
        try { return service.suggest(AuthController.getUserIdFromSession(session), request.conversationId(), request.modelId()); }
        catch (org.springframework.web.server.ResponseStatusException e) { throw e; }
        catch (RuntimeException ignored) { return null; } // Never expose provider response bodies or disrupt the main chat.
    }
    @PostMapping("/{id}/feedback")
    public Map<String, Boolean> feedback(@PathVariable String id, @RequestBody Feedback feedback,
            @RequestHeader(value = "X-Session-Id", required = false) String session) {
        service.feedback(AuthController.getUserIdFromSession(session), id, feedback.clientRequestId(), feedback.dismissed());
        return Map.of("ok", true);
    }
}
