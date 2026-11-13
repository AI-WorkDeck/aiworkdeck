// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.lawfirm;

import com.checkba.service.LangText;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Map;

/**
 * 桌面端调用律所云端工时汇总的薄封装：全部经 {@link LawFirmWorkflowGateway}（与云端利冲协作同一入口、同一账户凭据），
 * 不另开通道。只在本机台账（local-mode）里使用。
 */
@Component
@RequiredArgsConstructor
public class LawFirmBillingCloudClient {

    private final LawFirmWorkflowGateway gateway;

    public Map<String, Object> call(Long userId, String action, Map<String, Object> params) {
        try {
            return gateway.execute(userId, action, params);
        } catch (IllegalArgumentException e) {
            // 旧版云端不认识 billingCloud* 动作时回的是利冲协作的「不支持的操作」，换成律师看得懂的说法
            String msg = e.getMessage() == null ? "" : e.getMessage();
            if (msg.contains("不支持的利冲协作操作") || msg.contains("Unsupported conflict collaboration action")
                    || msg.contains("不支持的云端利冲操作")) {
                throw new IllegalStateException(LangText.of("所连接的协作服务尚未升级到支持云端工时汇总的版本",
                        "The connected collaboration service does not support cloud time collection yet"));
            }
            if (msg.contains("请连接官方账户")) {
                throw new IllegalStateException(LangText.of("请先登录并连接官方账户，才能使用律所云端工时汇总",
                        "Sign in and connect your official account to use cloud time collection"));
            }
            throw new IllegalStateException(msg);
        }
    }

    /** 不抛异常的状态查询：没连账户、云端不可用时返回 available=false 与原因，界面照常显示本机工时。 */
    public Map<String, Object> statusOrUnavailable(Long userId) {
        try {
            Map<String, Object> s = new java.util.LinkedHashMap<>(call(userId, "billingCloudStatus", Map.of()));
            s.put("available", true);
            return s;
        } catch (RuntimeException e) {
            return Map.of("available", false, "reason", e.getMessage() == null ? "" : e.getMessage(),
                    "enabled", false, "matters", List.of());
        }
    }
}
