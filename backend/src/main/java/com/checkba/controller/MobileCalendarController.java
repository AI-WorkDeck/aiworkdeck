// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.controller;
import com.checkba.service.mobile.MobileCalendarService;
import com.checkba.exception.UnauthorizedException;
import com.checkba.service.LangText;
import org.springframework.web.bind.annotation.*;
import java.util.*;
@RestController
@RequestMapping("/api/mobile/calendar")
public class MobileCalendarController {
    private final MobileCalendarService calendar;
    public MobileCalendarController(MobileCalendarService calendar) { this.calendar=calendar; }
    private Long user(String session) {
        Long id=AuthController.getUserIdFromSession(session);
        if(id==null) throw new UnauthorizedException(LangText.of("请先登录","Please sign in first"));
        return id;
    }
    public record Settings(Boolean enabled,String consentVersion) {}
    public record Snapshot(String deviceId,String timeZone,String sourceUpdatedAt,List<Map<String,Object>> events) {}
    @GetMapping("/events") public Map<String,Object> events(@RequestHeader(value="X-Session-Id",required=false) String session) {
        return Map.of("code",0,"data",calendar.events(user(session)));
    }
    @GetMapping("/settings") public Map<String,Object> settings(@RequestHeader(value="X-Session-Id",required=false) String session) {
        return Map.of("code",0,"data",calendar.settings(user(session)));
    }
    @PutMapping("/settings") public Map<String,Object> settings(@RequestHeader(value="X-Session-Id",required=false) String session,@RequestBody Settings request) {
        if(request.enabled()==null) throw new IllegalArgumentException(LangText.of("请选择是否开启日程同步","Missing calendar decision"));
        return Map.of("code",0,"data",calendar.settings(user(session),request.enabled(),request.consentVersion()));
    }
    @PutMapping("/snapshots") public Map<String,Object> snapshot(@RequestHeader(value="X-Session-Id",required=false) String session,@RequestBody Snapshot request) {
        return Map.of("code",0,"data",calendar.replace(user(session),request.deviceId(),request.timeZone(),request.sourceUpdatedAt(),request.events()));
    }
}
