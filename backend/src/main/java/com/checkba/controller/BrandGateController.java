// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.controller;

import com.checkba.service.account.AccountService;
import com.checkba.service.entitlement.EntitlementService;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 贴牌版本的「付费后可用」闸（白标设计：桌面仓 docs/superpowers/specs/2026-11-23-brand-profile-design.md）。
 *
 * <p>配置 {@code ai.brand.paid-gate.entitlement}（例如 {@code plugin:aifirm-partner}）后，前端在账户连上
 * 且该权益有效之前整屏锁住应用。默认空 = 不设闸，AI WorkDeck 本身不受影响。
 * {@code buy-url} 是锁屏上「購買方案」的去处。
 *
 * <p>判定走 {@link EntitlementService}（与插件的 billing.status 同一份缓存）；{@code refresh=true} 时先同步刷新一次，
 * 给锁屏上的「我已付款，重新檢查」用。
 */
@RestController
@RequestMapping("/api/brand")
public class BrandGateController {

    private final EntitlementService entitlements;
    private final AccountService account;
    private final String entitlement;
    private final String buyUrl;

    public BrandGateController(EntitlementService entitlements, AccountService account,
                               @Value("${ai.brand.paid-gate.entitlement:}") String entitlement,
                               @Value("${ai.brand.paid-gate.buy-url:}") String buyUrl) {
        this.entitlements = entitlements;
        this.account = account;
        this.entitlement = entitlement == null ? "" : entitlement.trim();
        this.buyUrl = buyUrl == null ? "" : buyUrl.trim();
    }

    @GetMapping("/gate")
    public Map<String, Object> gate(@RequestParam(required = false, defaultValue = "false") boolean refresh) {
        Map<String, Object> data = new LinkedHashMap<>();
        boolean required = !entitlement.isEmpty();
        data.put("required", required);
        if (!required) {
            data.put("unlocked", true);
            return Map.of("code", 0, "data", data);
        }
        boolean connected = account.isConnected();
        if (connected && refresh) entitlements.refreshQuietly();
        boolean active = connected && entitlements.isEnabled(entitlement);
        data.put("entitlement", entitlement);
        data.put("accountConnected", connected);
        data.put("active", active);
        data.put("expiresAt", active ? entitlements.expiresAt(entitlement) : null);
        data.put("buyUrl", buyUrl);
        data.put("unlocked", active);
        return Map.of("code", 0, "data", data);
    }
}
