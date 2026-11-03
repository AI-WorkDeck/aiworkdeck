// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.controller;
import com.checkba.service.ScratchTransferService;
import com.checkba.exception.UnauthorizedException;
import com.checkba.service.LangText;
import org.springframework.web.bind.annotation.*;
import java.util.Map;

@RestController
@RequestMapping("/api/projects/scratch")
public class ScratchTransferController {
    private final ScratchTransferService transfers;
    public ScratchTransferController(ScratchTransferService transfers) { this.transfers = transfers; }
    @PostMapping("/copy-to-project")
    public Map<String,Object> copy(@RequestHeader(value="X-Session-Id",required=false) String session,
            @RequestBody ScratchTransferService.Request request) {
        Long user = AuthController.getUserIdFromSession(session);
        if (user == null) throw new UnauthorizedException(LangText.of("请先登录", "Please sign in first"));
        return Map.of("code",0,"data",transfers.copy(user,request));
    }
}
