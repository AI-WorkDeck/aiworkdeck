// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.controller;

import com.checkba.service.account.AccountService;
import com.checkba.service.entitlement.EntitlementService;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

/** 贴牌付费闸：默认不设闸；设了之后未登录、未付费都锁，付费才放行。 */
class BrandGateControllerTest {

    @SuppressWarnings("unchecked")
    private static Map<String, Object> data(Map<String, Object> res) {
        return (Map<String, Object>) res.get("data");
    }

    @Test
    @DisplayName("未配置权益：不设闸（AI WorkDeck 本身）")
    void noGateByDefault() {
        BrandGateController c = new BrandGateController(mock(EntitlementService.class), mock(AccountService.class), "", "");
        Map<String, Object> d = data(c.gate(false));
        assertEquals(false, d.get("required"));
        assertEquals(true, d.get("unlocked"));
    }

    @Test
    @DisplayName("未登录：锁住")
    void lockedWhenSignedOut() {
        AccountService account = mock(AccountService.class);
        when(account.isConnected()).thenReturn(false);
        BrandGateController c = new BrandGateController(mock(EntitlementService.class), account, "plugin:aifirm-partner", "https://example.test/buy");
        Map<String, Object> d = data(c.gate(true));
        assertEquals(true, d.get("required"));
        assertEquals(false, d.get("unlocked"));
        assertEquals(false, d.get("accountConnected"));
        assertEquals("https://example.test/buy", d.get("buyUrl"));
    }

    @Test
    @DisplayName("已登录：权益无效锁住，有效放行；refresh 时先同步刷新")
    void unlocksOnlyWithEntitlement() {
        AccountService account = mock(AccountService.class);
        when(account.isConnected()).thenReturn(true);
        EntitlementService ent = mock(EntitlementService.class);
        BrandGateController c = new BrandGateController(ent, account, "plugin:aifirm-partner", "");
        when(ent.isEnabled("plugin:aifirm-partner")).thenReturn(false);
        assertEquals(false, data(c.gate(false)).get("unlocked"));
        verify(ent, never()).refreshQuietly();
        when(ent.isEnabled("plugin:aifirm-partner")).thenReturn(true);
        when(ent.expiresAt("plugin:aifirm-partner")).thenReturn("2027-01-01T00:00:00Z");
        Map<String, Object> d = data(c.gate(true));
        verify(ent).refreshQuietly();
        assertEquals(true, d.get("unlocked"));
        assertEquals("2027-01-01T00:00:00Z", d.get("expiresAt"));
    }
}
