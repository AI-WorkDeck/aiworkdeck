// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.controller;
import com.checkba.exception.UnauthorizedException;
import com.checkba.service.LangText;
import com.checkba.service.mobile.MobileAssistantDesktopCopyService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;
import java.util.Map;

@RestController
@RequestMapping("/api/mobile/assistant")
@RequiredArgsConstructor
public class MobileAssistantDesktopCopyController {
    private final MobileAssistantDesktopCopyService copies;
    @PostMapping("/conversations/{id}/copy-to-desktop")
    public Map<String,Object> create(@RequestHeader(value="X-Session-Id",required=false) String session,
            @PathVariable String id,@RequestBody MobileAssistantDesktopCopyService.Request body) {
        return result(copies.create(user(session),id,body));
    }
    @GetMapping("/conversations/{id}/desktop-copies")
    public Map<String,Object> history(@RequestHeader(value="X-Session-Id",required=false) String session,@PathVariable String id) {
        return result(copies.history(user(session),id));
    }
    @GetMapping("/desktop-copies/{id}")
    public Map<String,Object> get(@RequestHeader(value="X-Session-Id",required=false) String session,@PathVariable String id) {
        return result(copies.get(user(session),id));
    }
    @GetMapping("/desktop-copies/pending")
    public Map<String,Object> pending(@RequestHeader(value="X-Session-Id",required=false) String session,@RequestParam String deviceId) {
        return result(copies.pending(user(session),deviceId));
    }
    @PostMapping("/desktop-copies/{id}/ack")
    public Map<String,Object> ack(@RequestHeader(value="X-Session-Id",required=false) String session,
            @PathVariable String id,@RequestBody MobileAssistantDesktopCopyService.Ack body) {
        return result(copies.ack(user(session),id,body));
    }
    private static Map<String,Object> result(Object data) { return Map.of("code",0,"data",data); }
    private static Long user(String session) { Long user=AuthController.getUserIdFromSession(session);
        if(user==null) throw new UnauthorizedException(LangText.of("请先登录","Please sign in first"));return user; }
}
