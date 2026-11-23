// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ai;

import com.checkba.service.SystemSettingService;
import com.checkba.service.account.AccountService;
import com.checkba.service.site.SiteProfileService;
import com.checkba.service.site.SiteProperties;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;

/** 站点表 {@code cross-border-consent: false}：该站点不征求跨境单独同意，运行时闸放行；其余站点照旧。 */
class CrossBorderConsentSiteWaiverTest {

    private static SiteProfileService siteService(String current) {
        SiteProperties props = new SiteProperties();
        SiteProperties.Site cn = new SiteProperties.Site();
        cn.setBaseUrl("https://cn.example.test");
        SiteProperties.Site intl = new SiteProperties.Site();
        intl.setBaseUrl("https://intl.example.test");
        intl.setCrossBorderConsent(false);
        props.getSites().put("cn", cn);
        props.getSites().put("intl", intl);
        String base = "cn".equals(current) ? cn.getBaseUrl() : intl.getBaseUrl();
        return new SiteProfileService(true, base, current, System.getProperty("java.io.tmpdir"), props);
    }

    private static CrossBorderConsentService consent(String site) {
        SystemSettingService settings = mock(SystemSettingService.class);
        when(settings.get(anyString(), any())).thenAnswer(inv -> inv.getArgument(1));
        AccountService accounts = mock(AccountService.class);
        when(accounts.currentAccountIdOrNull()).thenReturn("acct-1");
        return new CrossBorderConsentService(settings, accounts, siteService(site));
    }

    @Test
    @DisplayName("关掉同意的站点：不征求、不拦平台通道")
    void waivedSiteNeedsNoConsent() {
        CrossBorderConsentService c = consent("intl");
        assertFalse(c.appliesToCurrentSite());
        assertTrue(c.hasConsent());
        assertFalse(c.isRequired());
        assertDoesNotThrow(c::requireForPlatformCall);
    }

    @Test
    @DisplayName("没关的站点（默认）：没有同意就拦")
    void defaultSiteStillRequiresConsent() {
        CrossBorderConsentService c = consent("cn");
        assertTrue(c.appliesToCurrentSite());
        assertTrue(c.isRequired());
        assertThrows(RuntimeException.class, c::requireForPlatformCall);
    }

    @Test
    @DisplayName("站点表里没有的站点（团队服务器、老配置）：按要征求处理")
    void unknownSiteIsNotWaived() {
        assertFalse(SiteProfileService.pinnedTo("https://team.example.test").crossBorderConsentWaived("intl"));
    }
}
