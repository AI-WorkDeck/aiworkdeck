// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.controller;
import com.checkba.service.LangText;
import com.checkba.service.mobile.MobileCalendarPushService;
import com.checkba.exception.UnauthorizedException;
import org.springframework.web.bind.annotation.*;
import java.util.*;
@RestController
@RequestMapping("/api/mobile/calendar/push")
public class MobileCalendarPushController {
    private final MobileCalendarPushService push;
    public MobileCalendarPushController(MobileCalendarPushService push) { this.push=push; }
    private Long user(String session) {
        Long id=AuthController.getUserIdFromSession(session);
        if(id==null) throw new UnauthorizedException(LangText.of("请先登录","Please sign in first"));return id;
    }
    public record Device(String installationId,String token,String environment) {}
    @GetMapping("/status") public Map<String,Object> status(@RequestHeader(value="X-Session-Id",required=false) String session) {
        user(session);return Map.of("code",0,"data",push.status());
    }
    @PutMapping("/device") public Map<String,Object> register(@RequestHeader(value="X-Session-Id",required=false) String session,@RequestBody Device body) {
        return Map.of("code",0,"data",push.register(user(session),body.installationId(),body.token(),body.environment()));
    }
    @DeleteMapping("/device/{installationId}") public Map<String,Object> unregister(
            @RequestHeader(value="X-Session-Id",required=false) String session,@PathVariable String installationId) {
        push.unregister(user(session),installationId);return Map.of("code",0,"data",Map.of("registered",false));
    }
}
