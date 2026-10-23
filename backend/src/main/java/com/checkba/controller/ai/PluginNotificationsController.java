// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.controller.ai;

import com.checkba.controller.AuthController;
import com.checkba.controller.ImController;
import com.checkba.service.ai.PluginService;
import com.checkba.service.messagecenter.MessageCenterGateway;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;
import java.io.IOException;
import java.util.Map;

/** The host binds the iframe's actual plugin ID; body fields cannot supply identity or other recipients. */
@RestController
@RequestMapping("/api/plugins/{id}/notifications")
@RequiredArgsConstructor
public class PluginNotificationsController {
    private final PluginService plugins;
    private final MessageCenterGateway gateway;
    private final ObjectMapper mapper;

    @PostMapping
    public Map<String,Object> action(@PathVariable("id") String pluginId,HttpServletRequest request,
            @RequestHeader(value="X-Session-Id",required=false) String sessionId) throws IOException {
        Long userId=AuthController.getUserIdFromSession(sessionId);
        if (userId==null) throw new IllegalArgumentException("请先登录");
        var plugin=plugins.getPlugin(pluginId);
        if (plugin==null || !plugins.isEnabled(pluginId) || plugins.revokedReason(pluginId)!=null)
            throw new IllegalArgumentException("插件不存在或未启用");
        if (plugin.getPermissions()==null || !plugin.getPermissions().contains("notifications"))
            throw new IllegalArgumentException("插件未获得通知权限");
        byte[] bytes=request.getInputStream().readNBytes(65537);
        if (bytes.length>65536) throw new IllegalArgumentException("通知请求过大");
        Map<String,Object> body;
        try { body=mapper.readValue(bytes,new TypeReference<>(){}); }
        catch (com.fasterxml.jackson.core.JsonProcessingException e) { throw new IllegalArgumentException("通知请求格式无效"); }
        if (body==null) throw new IllegalArgumentException("通知请求格式无效");
        Map<String,Object> p=ImController.params(body);
        Object result=switch(String.valueOf(body.getOrDefault("action","publish"))) {
            case "publish" -> gateway.publishPlugin(userId,pluginId,p);
            case "resolve" -> gateway.resolvePlugin(userId,pluginId,text(p,"eventKey"),String.valueOf(p.getOrDefault("state","done")));
            default -> throw new IllegalArgumentException("不支持的插件通知操作");
        };
        // Recheck grant after network latency; disabling a plugin cannot deliver stale results to its iframe.
        if (!plugins.isEnabled(pluginId) || plugins.revokedReason(pluginId)!=null) throw new IllegalArgumentException("插件已停用");
        return Map.of("code",0,"data",result);
    }
    private static String text(Map<String,Object> p,String key) {
        if (!(p.get(key) instanceof String s) || s.isBlank() || s.length()>160) throw new IllegalArgumentException("通知字段无效");
        return s;
    }
}
