// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.lawfirm;

import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 本机台账调用律所云端「time」功能的薄封装：经律所云端统一入口（{@link LawFirmCloudCaller}，与利冲协作同一连接与账户凭据），
 * 不另开通道。开关本身在律所管理插件的「律所云端」页（cloud.settings.*），这里只读。
 */
@Component
@RequiredArgsConstructor
public class LawFirmBillingCloudClient {

    private final LawFirmCloudCaller caller;

    public Map<String, Object> call(Long userId, String action, Map<String, Object> params) {
        try {
            return caller.call(userId, action, params);
        } catch (IllegalArgumentException e) {
            // 云端的业务拒绝（权限、事项已停止接收等）在本机统一按「操作未完成」返回给界面
            throw new IllegalStateException(e.getMessage());
        }
    }

    /**
     * 不抛异常的状态：available=false 时带原因（没连账户、协作服务太旧、网络不通）；
     * enabled=false 时律所还没开启「计时工时汇总」，界面引导到「律所云端」页。
     */
    public Map<String, Object> statusOrUnavailable(Long userId) {
        try {
            Map<String, Object> settings = call(userId, LawFirmCloudService.SETTINGS_GET, Map.of());
            boolean on = settings.get("switches") instanceof Map<?, ?> sw && Boolean.TRUE.equals(sw.get("time"));
            Map<String, Object> out = new LinkedHashMap<>();
            if (on) out.putAll(call(userId, "time.status", Map.of()));
            out.put("available", true);
            out.put("enabled", on);
            out.put("firmAdmin", settings.get("firmAdmin"));
            out.putIfAbsent("matters", List.of());
            return out;
        } catch (RuntimeException e) {
            return Map.of("available", false, "reason", e.getMessage() == null ? "" : e.getMessage(),
                    "enabled", false, "matters", List.of());
        }
    }
}
