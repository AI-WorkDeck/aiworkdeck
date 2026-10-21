// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.controller;

import com.checkba.service.ocr.OcrRoutingService;
import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.web.bind.annotation.*;
import java.util.Map;

@RestController
@RequestMapping("/api/ocr/routing")
public class OcrRoutingController {
    private final OcrRoutingService routing;
    public OcrRoutingController(OcrRoutingService routing) { this.routing = routing; }
    private Long user(String session) {
        Long user = AuthController.getUserIdFromSession(session);
        if (user == null) throw new IllegalArgumentException("未登录");
        return user;
    }
    private Map<String, Object> ok(Object data) { return Map.of("code", 0, "data", data); }
    @GetMapping public Map<String, Object> get(@RequestHeader(value="X-Session-Id", required=false) String session) {
        return ok(routing.preference(user(session)));
    }
    @PutMapping public Map<String, Object> save(@RequestHeader(value="X-Session-Id", required=false) String session,
            @RequestBody JsonNode body) {
        Long user = user(session);
        routing.savePreference(user, body.path("choice").asText(), body.path("version").asText());
        return ok(routing.preference(user));
    }
    @PostMapping("/cancel") public Map<String, Object> cancel(@RequestHeader(value="X-Session-Id", required=false) String session,
            @RequestBody JsonNode body) {
        routing.cancel(user(session), body.path("conversationId").asText(), body.path("decisionId").asText());
        return ok(Map.of("cancelled", true));
    }
    @PostMapping("/choice") public Map<String, Object> choose(@RequestHeader(value="X-Session-Id", required=false) String session,
            @RequestBody JsonNode body) {
        if (!body.path("remember").isBoolean()) throw new IllegalArgumentException("记住选择必须为布尔值");
        routing.choose(user(session), body.path("conversationId").asText(), body.path("decisionId").asText(),
                body.path("choice").asText(), body.path("remember").booleanValue(), body.path("version").asText());
        return ok(Map.of("accepted", true));
    }
}
