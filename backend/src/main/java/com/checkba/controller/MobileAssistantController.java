// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.controller;

import com.checkba.exception.UnauthorizedException;
import com.checkba.service.LangText;
import com.checkba.service.mobile.MobileAssistantService;
import org.springframework.web.bind.annotation.*;
import java.util.Map;

@RestController
@RequestMapping("/api/mobile/assistant")
public class MobileAssistantController {
    private final MobileAssistantService service;
    public MobileAssistantController(MobileAssistantService service) {this.service=service;}
    private Long user(String session) {
        Long id=AuthController.getUserIdFromSession(session);
        if(id==null) throw new UnauthorizedException(LangText.of("请先登录","Please sign in first"));
        return id;
    }
    private Map<String,Object> ok(Object value) {return Map.of("code",0,"data",value);}
    @GetMapping("/status")
    public Map<String,Object> status(@RequestHeader(value="X-Session-Id",required=false) String session) {
        return ok(service.status(user(session)));
    }
    public record Settings(Boolean enabled,String consentVersion) {}
    @PutMapping("/settings")
    public Map<String,Object> settings(@RequestHeader(value="X-Session-Id",required=false) String session,@RequestBody Settings request) {
        Long id=user(session);
        if(request.enabled()==null) throw new IllegalArgumentException(LangText.of("必须明确选择是否开通","Explicitly choose whether to enable the personal assistant"));
        return ok(service.settings(id,request.enabled(),request.consentVersion()));
    }
    @PutMapping("/snapshots")
    public Map<String,Object> snapshot(@RequestHeader(value="X-Session-Id",required=false) String session,@RequestBody MobileAssistantService.Snapshot request) {
        return ok(service.snapshot(user(session),request));
    }
    @DeleteMapping("/snapshots")
    public Map<String,Object> remove(@RequestHeader(value="X-Session-Id",required=false) String session,@RequestParam String deviceId,@RequestParam String projectKey) {
        service.removeSnapshot(user(session),deviceId,projectKey);return ok(Map.of("deleted",true));
    }
    @GetMapping("/summaries")
    public Map<String,Object> summaries(@RequestHeader(value="X-Session-Id",required=false) String session,
            @RequestParam(defaultValue="") String query,@RequestParam(defaultValue="false") boolean includeRemoved) {
        return ok(includeRemoved ? service.cleanupCandidates(user(session)) : service.search(user(session),query));
    }
    @PostMapping("/chat")
    public Map<String,Object> chat(@RequestHeader(value="X-Session-Id",required=false) String session,@RequestBody MobileAssistantService.ChatInput request) {
        return ok(service.chat(user(session),request));
    }
    @GetMapping("/requests/{id}")
    public Map<String,Object> requestStatus(@RequestHeader(value="X-Session-Id",required=false) String session,@PathVariable String id) {
        return ok(service.requestStatus(user(session),id));
    }
    @GetMapping("/conversations/{id}")
    public Map<String,Object> history(@RequestHeader(value="X-Session-Id",required=false) String session,@PathVariable String id) {
        return ok(service.history(user(session),id));
    }
}
