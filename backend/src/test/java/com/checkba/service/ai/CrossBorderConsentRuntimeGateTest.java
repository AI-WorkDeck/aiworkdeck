// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ai;

import com.checkba.config.AiModelProperties;
import com.checkba.service.SystemSettingService;
import com.checkba.service.account.AccountException;
import com.checkba.service.account.AccountService;
import com.checkba.service.site.SiteProfileService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.HashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;

/**
 * 撤回同意必须当场让平台 AI 停用（问题 130，dev-board#1713）。
 *
 * <p>告知文案写的是「撤回后平台 AI 通道停用」，而门禁原先只在保存配置那一刻检查；
 * DataInitializer 首启把通道默认成平台通道也不经过门禁。运行时闸放在
 * {@link ChatModelFactory} 取平台密钥之前，所有平台消费方（对话、流式、写作、辅助、显式平台）共用。
 */
class CrossBorderConsentRuntimeGateTest {

    private final Map<String, String> stored = new HashMap<>();
    private SystemSettingService settings;
    private AccountService accountService;
    private PlatformAiChannel platformAiChannel;
    private ChatModelFactory factory;

    @BeforeEach
    void setUp() {
        AiModelProperties properties = new AiModelProperties();
        properties.getOpenRouter().setApiKey("sk-or-static-key");
        settings = mock(SystemSettingService.class);
        when(settings.get(anyString(), any()))
                .thenAnswer(inv -> stored.getOrDefault(inv.getArgument(0), inv.getArgument(1)));
        platformAiChannel = mock(PlatformAiChannel.class);
        when(platformAiChannel.usesMachineKey(any())).thenReturn(true);
        when(platformAiChannel.connection()).thenReturn(
                new PlatformAiKeyService.Resolved("sk-or-platform", "fp", null));
        when(platformAiChannel.baseUrl(anyString())).thenReturn("https://openrouter.ai/api/v1");
        accountService = mock(AccountService.class);
        when(accountService.currentAccountIdOrNull()).thenReturn("acct-1");
        SiteProfileService site = mock(SiteProfileService.class);
        when(site.currentSite()).thenReturn("cn");
        factory = new ChatModelFactory(properties, settings, platformAiChannel,
                mock(PlatformCreditsGate.class), mock(PlatformUsageAccountant.class),
                new AuxModelResolver(settings, AllowedModels.QWEN_3_7_FLASH.getModelId()),
                new com.checkba.service.telemetry.TelemetryService(
                        mock(com.checkba.repository.TelemetryEventRepository.class),
                        new com.checkba.service.telemetry.InstallIdentityService(
                                System.getProperty("java.io.tmpdir")),
                        "test"));
        ReflectionTestUtils.setField(factory, "crossBorderConsent",
                new CrossBorderConsentService(settings, accountService, site));
    }

    private void consentFor(String account, String site) {
        stored.put(CrossBorderConsentService.KEY_AT, "2026-11-01T10:00:00Z");
        stored.put(CrossBorderConsentService.KEY_VERSION, CrossBorderConsentService.NOTICE_VERSION);
        stored.put(CrossBorderConsentService.KEY_ACCOUNT, account);
        stored.put(CrossBorderConsentService.KEY_SITE, site);
    }

    @Test
    @DisplayName("平台通道 + 已撤回同意：流式、同步、显式平台调用都被拒，且密钥都没取")
    void withdrawnConsentBlocksEveryPlatformConsumer() {
        stored.put("ai.activeProvider", "AWD_CLOUD");
        // 单机桌面形态：显式平台调用在这里才走机器级账户（团队服务器上它另有「未绑定额度」的拒绝）
        ReflectionTestUtils.setField(factory, "localMode", true);
        for (Runnable call : new Runnable[] {
                () -> factory.getStreamingChatModel("anthropic/claude-sonnet-5"),
                () -> factory.getChatModel("anthropic/claude-sonnet-5"),
                () -> PlatformAiUserScope.call(7L, () -> factory.getPlatformChatModel(java.time.Duration.ofSeconds(3), 10)),
        }) {
            AccountException e = assertThrows(AccountException.class, call::run);
            assertEquals(CrossBorderConsentService.REASON, e.getReason());
            for (String marker : new String[] {"登录", "未授权", "请先"}) {
                assertFalse(e.getMessage().contains(marker), "文案不得含「" + marker + "」");
            }
        }
        verify(platformAiChannel, never()).connection();
    }

    @Test
    @DisplayName("同意属于另一个账户或另一个站点：同样拒绝")
    void consentOfOtherAccountOrSiteDoesNotCount() {
        stored.put("ai.activeProvider", "AWD_CLOUD");
        consentFor("acct-other", "cn");
        assertThrows(AccountException.class, () -> factory.getStreamingChatModel("anthropic/claude-sonnet-5"));
        consentFor("acct-1", "intl");
        assertThrows(AccountException.class, () -> factory.getStreamingChatModel("anthropic/claude-sonnet-5"));
        verify(platformAiChannel, never()).connection();
    }

    @Test
    @DisplayName("当前账户、当前站点、当前版本的同意：放行")
    void matchingConsentAllowsPlatform() {
        stored.put("ai.activeProvider", "AWD_CLOUD");
        consentFor("acct-1", "cn");
        assertNotNull(factory.getStreamingChatModel("anthropic/claude-sonnet-5"));
        verify(platformAiChannel).connection();
    }

    @Test
    @DisplayName("未连接账户：不抢 4011 的活，交给下游的登录弹层（它本身就征求同意）")
    void disconnectedAccountFallsThroughToAccountRequired() {
        stored.put("ai.activeProvider", "AWD_CLOUD");
        when(accountService.currentAccountIdOrNull()).thenReturn(null);
        when(accountService.accountFingerprintOrNull()).thenReturn(null);
        assertNotNull(factory.getStreamingChatModel("anthropic/claude-sonnet-5"));
    }

    @Test
    @DisplayName("本机模型与自备 Key 不需要同意：不拦")
    void localAndByokChannelsAreNotGated() {
        stored.put("ai.activeProvider", "OLLAMA");
        assertNotNull(factory.getStreamingChatModel("qwen3:8b"));
        stored.put("ai.activeProvider", "OPENROUTER");
        assertNotNull(factory.getStreamingChatModel("anthropic/claude-sonnet-5"));
        verify(platformAiChannel, never()).connection();
    }
}
