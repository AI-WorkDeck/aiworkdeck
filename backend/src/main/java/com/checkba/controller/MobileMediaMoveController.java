// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.controller;
import com.checkba.exception.UnauthorizedException;
import com.checkba.service.LangText;
import com.checkba.service.mobile.MobileMediaMoveService;
import org.springframework.web.bind.annotation.*;
import java.util.Map;

@RestController
@RequestMapping("/api/mobile/media/moves")
public class MobileMediaMoveController {
    private final MobileMediaMoveService moves;
    public MobileMediaMoveController(MobileMediaMoveService moves) {this.moves=moves;}
    private Long user(String session) {
        Long user=AuthController.getUserIdFromSession(session);
        if(user==null) throw new UnauthorizedException(LangText.of("请先登录","Please sign in first"));
        return user;
    }
    @PostMapping public Map<String,Object> register(@RequestHeader(value="X-Session-Id",required=false) String session,
            @RequestBody MobileMediaMoveService.Request request) {
        Long user=user(session);
        try {return Map.of("code",0,"data",moves.register(user,request));}
        catch(MobileMediaMoveService.NotRegistered e) {return Map.of("code",1,"kind","MOVE_NOT_REGISTERED","message",e.getMessage());}
    }
    @GetMapping("/{requestId}") public Map<String,Object> get(@RequestHeader(value="X-Session-Id",required=false) String session,
            @PathVariable String requestId) {return Map.of("code",0,"data",moves.get(user(session),requestId));}
    @PostMapping("/{requestId}/retry") public Map<String,Object> retry(@RequestHeader(value="X-Session-Id",required=false) String session,
            @PathVariable String requestId) {return Map.of("code",0,"data",moves.retry(user(session),requestId));}
    @GetMapping("/commands") public Map<String,Object> commands(@RequestHeader(value="X-Session-Id",required=false) String session,
            @RequestParam String deviceId) {return Map.of("code",0,"commands",moves.commands(user(session),deviceId));}
    @PostMapping("/{requestId}/result") public Map<String,Object> result(@RequestHeader(value="X-Session-Id",required=false) String session,
            @PathVariable String requestId,@RequestBody MobileMediaMoveService.Result result) {
        return Map.of("code",0,"data",moves.result(user(session),requestId,result));
    }
}
