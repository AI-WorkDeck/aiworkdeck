// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.controller.ai;

import com.checkba.controller.AuthController;
import com.checkba.controller.ImController;
import com.checkba.service.ai.PluginService;
import com.checkba.service.im.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.web.bind.annotation.*;

import java.io.IOException;
import java.util.Map;

@RestController
@RequestMapping("/api/plugins/{id}/im")
@lombok.RequiredArgsConstructor
public class PluginImController {
    private final PluginService plugins;
    private final ImGatewayService gateway;
    private final ObjectMapper mapper;
    private final ObjectProvider<ImProjectActionHandler> projectHandlers;

    @PostMapping
    public Map<String,Object> action(@PathVariable("id") String pluginId, HttpServletRequest request,
            @RequestHeader(value="X-Session-Id",required=false) String sessionId) throws IOException {
        Long userId = AuthController.getUserIdFromSession(sessionId);
        if (userId == null) throw new IllegalArgumentException("请先登录");
        var plugin = plugins.getPlugin(pluginId);
        if (plugin == null || !plugins.isEnabled(pluginId) || plugins.revokedReason(pluginId) != null)
            throw new IllegalArgumentException("插件不存在或未启用");
        if (plugin.getPermissions() == null || !plugin.getPermissions().contains("im"))
            throw new IllegalArgumentException("插件未获得沟通权限");
        Map<String,Object> body = ImController.readBody(request, mapper);
        Map<String,Object> params = ImController.params(body);
        String action = ImService.string(body, "action");
        Long projectId = projectId(body.get("projectId"));
        for (ImProjectActionHandler handler : projectHandlers) {
            if (handler.supports(action)) {
                String permission = "sendFile".equals(action) ? "file_read" : "file_write";
                if (!plugin.getPermissions().contains(permission)) throw new IllegalArgumentException("插件未获得文件权限：" + permission);
                if ("sendFile".equals(action) && !plugin.getPermissions().contains("file_write"))
                    throw new IllegalArgumentException("项目引用需 file_write 权限保存跨设备标识");
                return Map.of("code", 0, "data", handler.execute(userId, projectId, action, params));
            }
        }
        return Map.of("code", 0, "data", gateway.execute(userId, action, params));
    }

    static Long projectId(Object value) {
        if (value == null || "".equals(value)) return null;
        String raw = String.valueOf(value);
        if (!raw.matches("[1-9][0-9]{0,18}")) throw new IllegalArgumentException("项目编号无效");
        try { return Long.parseLong(raw); }
        catch (NumberFormatException e) { throw new IllegalArgumentException("项目编号无效"); }
    }
}
