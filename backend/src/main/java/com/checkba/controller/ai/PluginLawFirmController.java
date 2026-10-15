// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.controller.ai;

import com.checkba.controller.ImController;
import com.checkba.controller.lawfirm.LawFirmManagementController;
import com.checkba.service.ai.PluginService;
import com.checkba.service.lawfirm.LawFirmManagementService;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.*;

import java.io.IOException;
import java.util.Map;

/**
 * 律所管理插件桥（PluginPane 的 {@code lawfirm.request} 落点）。闸门与 PluginImController 同款：
 * 登录会话 + 插件存在/启用/未封禁 + manifest 声明了 {@code lawfirm} 权限。
 */
@RestController
@RequestMapping("/api/plugins/{id}/lawfirm")
@lombok.RequiredArgsConstructor
public class PluginLawFirmController {
    private final PluginService plugins;
    private final LawFirmManagementService service;
    private final ObjectMapper mapper;

    @PostMapping
    public Map<String, Object> action(@PathVariable("id") String pluginId, HttpServletRequest request,
                                      @RequestHeader(value = "X-Session-Id", required = false) String sessionId) throws IOException {
        Long userId = LawFirmManagementController.requireUser(sessionId);
        var plugin = plugins.getPlugin(pluginId);
        if (plugin == null || !plugins.isEnabled(pluginId) || plugins.revokedReason(pluginId) != null)
            throw new IllegalArgumentException("插件不存在或未启用");
        if (plugin.getPermissions() == null || !plugin.getPermissions().contains("lawfirm"))
            throw new IllegalArgumentException("插件未获得律所管理权限");
        Map<String, Object> body = ImController.readBody(request, mapper);
        Map<String, Object> params = ImController.params(body);
        String action = body.get("action") == null ? "" : String.valueOf(body.get("action")).trim();
        Long projectId = LawFirmManagementController.parseProjectId(body.get("projectId"));
        return LawFirmManagementController.run(() -> service.execute(userId, projectId, action, params));
    }
}
