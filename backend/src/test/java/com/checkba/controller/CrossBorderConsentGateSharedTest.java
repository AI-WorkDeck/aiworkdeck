// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.controller;

import com.checkba.service.SystemSettingService;
import com.checkba.service.account.AccountService;
import com.checkba.service.ai.CrossBorderConsentService;
import com.checkba.service.site.SiteProfileService;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * 跨境同意闸门必须**两个入口共用同一处判定**。
 *
 * <p>背景：闸门原先只在 {@code AdminConfigController.updateAdminConfig} 里，而首启向导走的是
 * {@code WizardController.initialize} → 直接调静态的 {@code toSettingsUpdates}，完全绕过闸门。
 * 而向导恰恰是用户选平台通道的主入口（AWD_CLOUD 在向导里恒可选，见 licensing-billing 地雷 15），
 * 于是同意对多数用户形同装饰：勾选框在管理后台，而没人需要经过管理后台。
 *
 * <p>{@code CrossBorderConsentTest} 守的是判定本身（版本作废、文案红线）；
 * 本用例守的是**这道闸没有第二份实现、也没有哪个入口漏掉它**。
 */
class CrossBorderConsentGateSharedTest {

    private static final String KEY_AT = "ai.crossBorder.consentAt";
    private static final String KEY_VERSION = "ai.crossBorder.consentVersion";
    private static final String CURRENT_VERSION = "2026-10-29";

    /** 本机连着账户 acct-1、当前站点 cn；同意判定走真实的 CrossBorderConsentService。 */
    private CrossBorderConsentService settingsWith(Map<String, String> stored) {
        SystemSettingService settings = mock(SystemSettingService.class);
        when(settings.get(anyString(), any()))
                .thenAnswer(inv -> stored.getOrDefault(inv.getArgument(0), inv.getArgument(1)));
        doAnswer(inv -> { stored.putAll(inv.getArgument(0)); return null; }).when(settings).setMany(anyMap());
        AccountService account = mock(AccountService.class);
        when(account.currentAccountIdOrNull()).thenReturn("acct-1");
        SiteProfileService site = mock(SiteProfileService.class);
        when(site.currentSite()).thenReturn("cn");
        return new CrossBorderConsentService(settings, account, site);
    }

    private AdminConfigController.AiConfig ai(String provider, Boolean consent) {
        AdminConfigController.AiConfig ai = new AdminConfigController.AiConfig();
        ai.setActiveProvider(provider);
        ai.setCrossBorderConsent(consent);
        return ai;
    }

    @Test
    @DisplayName("未同意切平台通道：闸门给出拒绝原因（向导与管理后台共用这一处）")
    void blocksPlatformChannelWithoutConsent() {
        String reason = AdminConfigController.crossBorderBlockReason(
                ai("AWD_CLOUD", null), settingsWith(new HashMap<>()));
        assertNotNull(reason, "未同意就切 AWD_CLOUD 必须被拦");
        // 文案红线：命中这三个子串会让前端 api.js 判掉线并清会话
        assertFalse(reason.contains("登录"), "拒绝文案不得含「登录」");
        assertFalse(reason.contains("未授权"), "拒绝文案不得含「未授权」");
        assertFalse(reason.contains("请先"), "拒绝文案不得含「请先」");
    }

    @Test
    @DisplayName("本次请求勾选了同意：放行")
    void allowsWhenConsentedInThisRequest() {
        assertNull(AdminConfigController.crossBorderBlockReason(
                ai("AWD_CLOUD", Boolean.TRUE), settingsWith(new HashMap<>())));
    }

    @Test
    @DisplayName("库里已有同版本同意：放行（切回平台通道不必重新勾一次）")
    void allowsWhenStoredConsentMatchesVersion() {
        Map<String, String> stored = new HashMap<>();
        stored.put(KEY_AT, "2026-08-08T10:00:00Z");
        stored.put(KEY_VERSION, CURRENT_VERSION);
        assertNull(AdminConfigController.crossBorderBlockReason(
                ai("AWD_CLOUD", null), settingsWith(stored)));
    }

    @Test
    @DisplayName("库里同意的是旧版告知：按未同意处理，重新征求")
    void blocksWhenStoredConsentIsStaleVersion() {
        Map<String, String> stored = new HashMap<>();
        stored.put(KEY_AT, "2026-01-01T10:00:00Z");
        stored.put(KEY_VERSION, "2026-01-01");
        assertNotNull(AdminConfigController.crossBorderBlockReason(
                ai("AWD_CLOUD", null), settingsWith(stored)));
    }

    @Test
    @DisplayName("非平台通道不涉及跨境：不拦，也不要求同意")
    void doesNotGateOtherProviders() {
        Map<String, String> empty = new HashMap<>();
        assertNull(AdminConfigController.crossBorderBlockReason(ai("OPENROUTER", null), settingsWith(empty)));
        assertNull(AdminConfigController.crossBorderBlockReason(ai("OLLAMA", null), settingsWith(empty)));
        // 本次未改供应商（activeProvider 为空）也不该被这道闸拦住
        assertNull(AdminConfigController.crossBorderBlockReason(ai(null, null), settingsWith(empty)));
        assertNull(AdminConfigController.crossBorderBlockReason(null, settingsWith(empty)));
    }

    @Test
    @DisplayName("显式撤回同意后再切平台通道：拦住（个保法第十五条的撤回权不能被忽略）")
    void blocksAfterExplicitWithdrawal() {
        Map<String, String> stored = new HashMap<>();
        stored.put(KEY_AT, "2026-08-08T10:00:00Z");
        stored.put(KEY_VERSION, CURRENT_VERSION);
        assertNotNull(AdminConfigController.crossBorderBlockReason(
                ai("AWD_CLOUD", Boolean.FALSE), settingsWith(stored)),
                "同一请求里撤回同意又要切平台通道，必须以撤回为准");
    }

    @Test
    @DisplayName("库里的同意属于另一个账户：拦住（换账户要重新征求，问题 130）")
    void blocksWhenStoredConsentBelongsToAnotherAccount() {
        Map<String, String> stored = new HashMap<>();
        stored.put(KEY_AT, "2026-11-01T10:00:00Z");
        stored.put(KEY_VERSION, CURRENT_VERSION);
        stored.put("ai.crossBorder.consentAccount", "acct-other");
        stored.put("ai.crossBorder.consentSite", "cn");
        assertNotNull(AdminConfigController.crossBorderBlockReason(
                ai("AWD_CLOUD", null), settingsWith(stored)));
    }

    @Test
    @DisplayName("库里的同意是在另一个站点给的：拦住（切站要重新征求，问题 130）")
    void blocksWhenStoredConsentBelongsToAnotherSite() {
        Map<String, String> stored = new HashMap<>();
        stored.put(KEY_AT, "2026-11-01T10:00:00Z");
        stored.put(KEY_VERSION, CURRENT_VERSION);
        stored.put("ai.crossBorder.consentAccount", "acct-1");
        stored.put("ai.crossBorder.consentSite", "intl");
        assertNotNull(AdminConfigController.crossBorderBlockReason(
                ai("AWD_CLOUD", null), settingsWith(stored)));
    }

    @Test
    @DisplayName("升级前的机器级同意：视为当前账户、当前站点的同意并补写，老用户不被突然拦住")
    void legacyMachineConsentMigratesToCurrentAccountAndSite() {
        Map<String, String> stored = new HashMap<>();
        stored.put(KEY_AT, "2026-08-08T10:00:00Z");
        stored.put(KEY_VERSION, CURRENT_VERSION);
        assertNull(AdminConfigController.crossBorderBlockReason(
                ai("AWD_CLOUD", null), settingsWith(stored)));
        assertEquals("acct-1", stored.get("ai.crossBorder.consentAccount"));
        assertEquals("cn", stored.get("ai.crossBorder.consentSite"));
    }
}
