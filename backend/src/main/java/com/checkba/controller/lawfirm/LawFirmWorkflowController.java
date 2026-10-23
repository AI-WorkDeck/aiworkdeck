// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.controller.lawfirm;
import com.checkba.service.lawfirm.LawFirmWorkflowGateway;
import org.springframework.web.bind.annotation.*;
import lombok.RequiredArgsConstructor;
import java.util.Map;
@RestController @RequestMapping("/api/lawfirm/workflow") @RequiredArgsConstructor
public class LawFirmWorkflowController {
    private final LawFirmWorkflowGateway gateway;
    @PostMapping public Map<String,Object> action(@RequestHeader(value="X-Session-Id",required=false) String session,@RequestBody Map<String,Object> body){
        Long user=LawFirmManagementController.requireUser(session);
        String action=body.get("action") instanceof String s?s:"";
        @SuppressWarnings("unchecked") Map<String,Object> params=body.get("params") instanceof Map<?,?> p?(Map<String,Object>)p:Map.of();
        return LawFirmManagementController.run(()->gateway.execute(user,action,params));
    }
}
