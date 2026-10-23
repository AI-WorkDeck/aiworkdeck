// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.controller;

import com.checkba.service.messagecenter.MessageCenterGateway;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;
import java.io.IOException;
import java.util.Map;

/** Core shell capability: installed UI plugins are not required to read or use the message center. */
@RestController
@RequestMapping("/api/message-center")
@RequiredArgsConstructor
public class MessageCenterController {
    private final MessageCenterGateway gateway;
    private final ObjectMapper mapper;

    @PostMapping("/action")
    public Map<String,Object> action(HttpServletRequest request,
            @RequestHeader(value="X-Session-Id",required=false) String sessionId) throws IOException {
        Long userId=AuthController.getUserIdFromSession(sessionId);
        if (userId==null) throw new IllegalArgumentException("请先登录");
        Map<String,Object> body=ImController.readBody(request,mapper);
        String action=body.get("action") instanceof String s?s:"";
        Long projectId=null;
        if (body.get("projectId")!=null) {
            String raw=String.valueOf(body.get("projectId"));
            if (!raw.matches("[1-9][0-9]{0,18}")) throw new IllegalArgumentException("项目编号无效");
            try { projectId=Long.parseLong(raw); } catch (NumberFormatException e) { throw new IllegalArgumentException("项目编号无效"); }
        }
        return Map.of("code",0,"data",gateway.execute(userId,action,ImController.params(body),projectId));
    }
}
