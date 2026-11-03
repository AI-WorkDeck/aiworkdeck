// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.controller;
import com.checkba.exception.UnauthorizedException;
import com.checkba.service.LangText;
import com.checkba.service.mobile.MobileAssistantCopyService;
import org.springframework.web.bind.annotation.*;
import java.util.Map;

@RestController
@RequestMapping("/api/mobile/assistant/conversations")
public class MobileAssistantCopyController {
    private final MobileAssistantCopyService copies;
    public MobileAssistantCopyController(MobileAssistantCopyService copies) { this.copies = copies; }
    public record Request(Long targetProjectId) {}
    @PostMapping("/{id}/copy-to-project")
    public Map<String,Object> copy(@RequestHeader(value="X-Session-Id",required=false) String session,
            @PathVariable String id, @RequestBody Request request) {
        Long user = AuthController.getUserIdFromSession(session);
        if (user == null) throw new UnauthorizedException(LangText.of("请先登录", "Please sign in first"));
        return Map.of("code",0,"data",copies.copy(user,id,request.targetProjectId()));
    }
}
