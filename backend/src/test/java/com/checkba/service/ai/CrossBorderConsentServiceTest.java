// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ai;

import com.checkba.service.SystemSettingService;
import com.checkba.service.account.AccountService;
import com.checkba.service.site.SiteProfileService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;

/**
 * 同意按「账户 + 站点」记录：登录页那条路径（先记同意、再连账户）必须写出属于新账户的记录（问题 130）。
 */
class CrossBorderConsentServiceTest {

    private final Map<String, String> stored = new HashMap<>();
    private AccountService account;
    private SiteProfileService site;
    private CrossBorderConsentService consent;

    @BeforeEach
    void setUp() {
        SystemSettingService settings = mock(SystemSettingService.class);
        when(settings.get(anyString(), any()))
                .thenAnswer(inv -> stored.getOrDefault(inv.getArgument(0), inv.getArgument(1)));
        doAnswer(inv -> { stored.putAll(inv.getArgument(0)); return null; }).when(settings).setMany(anyMap());
        account = mock(AccountService.class);
        site = mock(SiteProfileService.class);
        when(site.currentSite()).thenReturn("cn");
        consent = new CrossBorderConsentService(settings, account, site);
    }

    /** 模拟设置页 / accountConsent.js 的保存：toSettingsUpdates 写时间与版本，再补账户与站点。 */
    private void recordConsent() {
        Map<String, String> updates = new LinkedHashMap<>();
        updates.put(CrossBorderConsentService.KEY_AT, Instant.now().toString());
        updates.put(CrossBorderConsentService.KEY_VERSION, CrossBorderConsentService.NOTICE_VERSION);
        consent.stampIdentity(updates);
        stored.putAll(updates);
    }

    @Test
    @DisplayName("登录页路径：未连接时记同意 → 连上 B → 同意绑给 B，B 可用")
    void consentRecordedBeforeLoginBindsToNewAccount() {
        recordConsent();
        assertEquals("", stored.get(CrossBorderConsentService.KEY_ACCOUNT));
        when(account.currentAccountIdOrNull()).thenReturn("acct-b");
        consent.bindPendingToCurrentAccount();
        assertEquals("acct-b", stored.get(CrossBorderConsentService.KEY_ACCOUNT));
        assertEquals("cn", stored.get(CrossBorderConsentService.KEY_SITE));
        assertTrue(consent.hasConsent());
    }

    @Test
    @DisplayName("连着 A 时在登录弹层/粘 Key 处勾选并换成 B：同意归 B，A 的旧同意不再适用")
    void consentRecordedWhileConnectedAsAThenSwitchToB() {
        when(account.currentAccountIdOrNull()).thenReturn("acct-a");
        recordConsent();
        when(account.currentAccountIdOrNull()).thenReturn("acct-b");
        assertFalse(consent.hasConsent(), "绑定前 B 不能沿用 A 的同意");
        consent.bindPendingToCurrentAccount();
        assertTrue(consent.hasConsent());
        when(account.currentAccountIdOrNull()).thenReturn("acct-a");
        assertFalse(consent.hasConsent());
    }

    @Test
    @DisplayName("换账户但没经过同意（无 pending）：不绑，B 没有同意")
    void connectWithoutFreshConsentDoesNotInherit() {
        when(account.currentAccountIdOrNull()).thenReturn("acct-a");
        recordConsent();
        consent.bindPendingToCurrentAccount(); // A 连上，pending 用掉
        when(account.currentAccountIdOrNull()).thenReturn("acct-b");
        consent.bindPendingToCurrentAccount();
        assertFalse(consent.hasConsent());
    }

    @Test
    @DisplayName("过期的 pending 不绑")
    void stalePendingIsNotBound() {
        recordConsent();
        stored.put(CrossBorderConsentService.KEY_PENDING_AT, Instant.now().minusSeconds(3600 * 2).toString());
        when(account.currentAccountIdOrNull()).thenReturn("acct-b");
        consent.bindPendingToCurrentAccount();
        assertFalse(consent.hasConsent());
        assertEquals("", stored.get(CrossBorderConsentService.KEY_PENDING_AT));
    }

    @Test
    @DisplayName("切站后：同一账户的旧站同意不算；在新站登录时重新勾选即恢复")
    void siteSwitchRequiresNewConsent() {
        when(account.currentAccountIdOrNull()).thenReturn("acct-a");
        recordConsent();
        consent.bindPendingToCurrentAccount();
        assertTrue(consent.hasConsent());
        when(site.currentSite()).thenReturn("intl");
        assertFalse(consent.hasConsent());
        assertEquals("", consent.consentAtForDisplay(), "设置页要显示为未同意，引导重新勾选");
        when(account.currentAccountIdOrNull()).thenReturn(null);
        recordConsent();
        when(account.currentAccountIdOrNull()).thenReturn("acct-a");
        consent.bindPendingToCurrentAccount();
        assertTrue(consent.hasConsent());
    }

    @Test
    @DisplayName("撤回：账户、站点、pending 一并清空，运行时闸拒绝")
    void withdrawalClearsIdentityAndBlocksRuntime() {
        when(account.currentAccountIdOrNull()).thenReturn("acct-a");
        recordConsent();
        Map<String, String> updates = new LinkedHashMap<>();
        updates.put(CrossBorderConsentService.KEY_AT, "");
        updates.put(CrossBorderConsentService.KEY_VERSION, "");
        consent.stampIdentity(updates);
        stored.putAll(updates);
        assertEquals("", stored.get(CrossBorderConsentService.KEY_ACCOUNT));
        assertEquals("", stored.get(CrossBorderConsentService.KEY_SITE));
        assertFalse(consent.hasConsent());
        assertThrows(com.checkba.service.account.AccountException.class, consent::requireForPlatformCall);
    }

    @Test
    @DisplayName("没动同意的保存：不碰同意记录")
    void unrelatedSaveLeavesConsentAlone() {
        Map<String, String> updates = new LinkedHashMap<>();
        updates.put("ai.defaultModel", "x");
        consent.stampIdentity(updates);
        assertEquals(1, updates.size());
    }
}
