// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.ai;

import com.checkba.service.account.AccountService;
import com.checkba.service.account.AccountException;
import com.checkba.service.account.AccountTransport;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import java.nio.file.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class BailianPlatformConnectionTest {
    @TempDir Path state;
    private static final String BASE = "https://www.aiworkdeck.com/api/account/ai/v1";
    private AccountService domestic() {
        AccountService account = mock(AccountService.class);
        when(account.domesticAiPlatform()).thenReturn(true);
        when(account.platformAiBaseUrl()).thenReturn(BASE);
        when(account.isConnected()).thenReturn(true);
        when(account.accountFingerprintOrNull()).thenReturn("account-a");
        return account;
    }
    private Map<String, Object> connection(String token) {
        return Map.of("provider", "bailian", "apiKey", token, "baseUrl", BASE, "defaultModel", "qwen3.8-flash");
    }
    @Test void domesticAcceptsOnlyRestrictedTokenAndTrustedOrigin() {
        AccountService account = domestic();
        assertTrue(PlatformAiKeyService.parseConnection(connection("awdai_test-a"), account).bailian());
        for (String key : List.of("awdk_full-account", "sk-shared-upstream", "sk-or-runtime")) {
            assertThrows(AccountException.class, () -> PlatformAiKeyService.parseConnection(connection(key), account));
        }
        Map<String,Object> malicious = new HashMap<>(connection("awdai_test-a"));
        malicious.put("baseUrl", "https://attacker.example/api/account/ai/v1");
        assertThrows(AccountException.class, () -> PlatformAiKeyService.parseConnection(malicious, account));
        assertThrows(AccountException.class, () -> PlatformAiKeyService.parseConnection(Map.of("openrouterKey", "sk-or-legacy"), account));
        assertFalse(PlatformAiKeyService.parseConnection(connection("awdai_test-a"), account).toString().contains("awdai_test-a"));
    }
    @Test void domesticDiscardsLegacyCacheAndReprovisionsAfterAccountSwitch() throws Exception {
        Files.writeString(state.resolve("platform-ai-key.json"), "{\"owner\":\"account-a\",\"openrouterKey\":\"sk-or-old\"}");
        AccountService account = domestic();
        when(account.fetchAiKey()).thenReturn(connection("awdai_a"), connection("awdai_b"));
        PlatformAiChannel channel = new PlatformAiChannel(account, mock(PlatformAiKeyService.class), true, state.toString());
        assertEquals("awdai_a", channel.apiKey());
        assertEquals(BASE, channel.baseUrl("https://openrouter.ai/api/v1"));
        when(account.accountFingerprintOrNull()).thenReturn("account-b");
        assertEquals("awdai_b", channel.apiKey());
        verify(account, times(2)).fetchAiKey();
    }
    @Test void providerCatalogueIsScopedByCredentialAndDoesNotFallBackToOpenRouter() {
        PlatformAiChannel channel = mock(PlatformAiChannel.class);
        when(channel.connection()).thenReturn(new PlatformAiKeyService.Resolved("awdai_a", "a", null, "bailian", BASE, "qwen3.8-flash"));
        List<String> calls = new ArrayList<>();
        AccountTransport transport = (method, url, key, body) -> {
            calls.add(url + ":" + key);
            return new AccountTransport.Reply(200, "{\"currency\":\"CNY\",\"marginMultiplier\":1.2,\"models\":[{\"id\":\"qwen3.8-flash\",\"name\":\"Flash\",\"supportsTools\":true,\"supportsVision\":true,\"contextLength\":100000,\"inputPricePerMillion\":1,\"outputPricePerMillion\":2,\"tiered\":true}]}");
        };
        PlatformModelCatalog catalog = new PlatformModelCatalog(channel, transport, "https://openrouter.ai/api/v1");
        assertEquals("qwen3.8-flash", catalog.resolve("qwen/qwen3.7-flash"));
        assertTrue(catalog.model("qwen3.8-flash").tiered());
        assertThrows(AccountException.class, () -> catalog.resolve("unknown-model"));
        assertEquals(1, calls.size());
        when(channel.connection()).thenReturn(new PlatformAiKeyService.Resolved("awdai_b", "b", null, "bailian", BASE, "qwen3.8-flash"));
        catalog.current();
        assertEquals(List.of(BASE + "/models:awdai_a", BASE + "/models:awdai_b"), calls);
    }
    @Test void internationalFailoverUsesActualCatalogueWithoutNationalityFiltering() {
        PlatformAiChannel channel = mock(PlatformAiChannel.class);
        when(channel.connection()).thenReturn(new PlatformAiKeyService.Resolved("sk-or-test", "intl", null));
        PlatformModelCatalog catalog = new PlatformModelCatalog(channel, (method,url,key,body) ->
                new AccountTransport.Reply(200, "{\"data\":[{\"id\":\"anthropic/claude-sonnet-5\",\"architecture\":{\"input_modalities\":[\"text\",\"image\"],\"output_modalities\":[\"text\"]},\"supported_parameters\":[\"tools\"],\"pricing\":{\"prompt\":\"0.000003\",\"completion\":\"0.000015\"}}]}"),
                "https://openrouter.ai/api/v1");
        assertEquals("anthropic/claude-sonnet-5", catalog.failover(
                List.of("retired/model", "anthropic/claude-sonnet-5"), "qwen/old", Set.of(), true));
        assertNull(catalog.failover(List.of("anthropic/claude-sonnet-5"), "qwen/old", Set.of("anthropic/claude-sonnet-5"), true));
    }

    @Test void unavailableCatalogueCannotBecomeEmptyFreeOrOpenRouterFallback() {
        PlatformAiChannel channel = mock(PlatformAiChannel.class);
        when(channel.connection()).thenReturn(new PlatformAiKeyService.Resolved("awdai_a", "a", null, "bailian", BASE, "qwen3.8-flash"));
        PlatformModelCatalog catalog = new PlatformModelCatalog(channel,
                (method,url,key,body) -> new AccountTransport.Reply(503, "{}"), "https://openrouter.ai/api/v1");
        assertThrows(AccountException.class, catalog::current);
    }
}
