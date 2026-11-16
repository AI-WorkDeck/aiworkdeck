// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.controller.lawfirm;

import com.checkba.service.lawfirm.LawFirmWorkflowGateway;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

/**
 * 律所云端统一入口：{@code POST /api/lawfirm/cloud}，body {@code {action, params}}。
 * 服务端（官方协作服务 / 自建团队服务器）直接分发到已登记的功能；桌面端经同一网关转发到官方协作服务，不回落本机。
 */
@RestController
@RequestMapping("/api/lawfirm/cloud")
@RequiredArgsConstructor
public class LawFirmCloudController {
    private final LawFirmWorkflowGateway gateway;

    @PostMapping
    public Map<String, Object> action(@RequestHeader(value = "X-Session-Id", required = false) String session,
                                      @RequestBody Map<String, Object> body) {
        Long user = LawFirmManagementController.requireUser(session);
        String action = body.get("action") instanceof String s ? s : "";
        @SuppressWarnings("unchecked")
        Map<String, Object> params = body.get("params") instanceof Map<?, ?> p ? (Map<String, Object>) p : Map.of();
        return LawFirmManagementController.run(() -> gateway.executeCloud(user, action, params));
    }
}
