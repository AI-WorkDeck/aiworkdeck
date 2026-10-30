// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ai;

import com.checkba.service.account.AccountService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

/**
 * 机器级平台密钥缓存的<b>归属</b>判据。
 *
 * <p>缓存文件是机器级的，而 key 是账户级的。少了这道判断，在同一台机器上换成另一个账号
 * 就会接着用上一个账号的 OpenRouter key——一个没充值的新账号照样能花钱。
 * 而「换账号时记得清缓存」是靠调用方自觉的，历史上解锁页那条路就漏了整整一套作废动作
 * （见 {@code AccountSwitchCleanup}）。所以除了把清理收成一处，缓存自己也要认归属。
 */
class PlatformAiKeyOwnershipTest {

    @TempDir
    Path stateDir;

    private AccountService accountService;
    private PlatformAiKeyService perUser;

    @BeforeEach
    void setUp() {
        accountService = mock(AccountService.class);
        perUser = mock(PlatformAiKeyService.class);
        when(accountService.isConnected()).thenReturn(true);
    }

    private PlatformAiChannel channel() {
        return new PlatformAiChannel(accountService, perUser, true, stateDir.toString());
    }

    private void connectedAs(String fingerprint) {
        when(accountService.accountFingerprintOrNull()).thenReturn(fingerprint);
    }

    private void websiteIssues(String key) {
        when(accountService.fetchAiKey()).thenReturn(Map.of("openrouterKey", key, "limitUsd", 10.0));
    }

    @Test
    void delayedProvisionCannotBelongToTheNewAccount() throws Exception {
        assertDelayedProvisionRejected("awdk_synthetic_b");
    }

    @Test
    void delayedProvisionCannotSurviveSameKeyReconnection() throws Exception {
        assertDelayedProvisionRejected("awdk_synthetic_a");
    }

    private void assertDelayedProvisionRejected(String replacementKey) throws Exception {
        var requested = new java.util.concurrent.CountDownLatch(1);
        var release = new java.util.concurrent.CountDownLatch(1);
        var requests = new java.util.concurrent.atomic.AtomicInteger();
        String base = "https://www.aiworkdeck.com";
        com.checkba.service.account.AccountTransport transport = (method,url,key,body) -> {
            if (url.endsWith("/api/account/me")) {
                return new com.checkba.service.account.AccountTransport.Reply(200,
                        "{\"accountId\":\"" + key + "\",\"username\":\"test\"}");
            }
            requests.incrementAndGet(); requested.countDown();
            try { if (!release.await(5, java.util.concurrent.TimeUnit.SECONDS)) throw new AssertionError("request blocked"); }
            catch (InterruptedException e) { throw new AssertionError(e); }
            return new com.checkba.service.account.AccountTransport.Reply(200,
                    "{\"provider\":\"bailian\",\"apiKey\":\"awdai_synthetic_old\",\"baseUrl\":\"" + base + "/api/account/ai/v1\"}");
        };
        AccountService account = new AccountService(com.checkba.service.site.SiteProfileService.pinnedTo(base),
                stateDir.toString(), transport, null);
        account.connect("awdk_synthetic_a");
        PlatformAiChannel channel = new PlatformAiChannel(account, perUser, true, stateDir.toString());
        var executor = java.util.concurrent.Executors.newSingleThreadExecutor();
        try {
            var old = executor.submit(() -> assertThrows(com.checkba.service.account.AccountException.class, channel::connection));
            assertTrue(requested.await(5, java.util.concurrent.TimeUnit.SECONDS));
            account.connect(replacementKey);
            release.countDown(); old.get(5, java.util.concurrent.TimeUnit.SECONDS);
            assertEquals(1, requests.get(), "A stale request must not automatically reprovision");
            assertFalse(Files.exists(stateDir.resolve("platform-ai-key.json")));
        } finally { release.countDown(); executor.shutdownNow(); }
    }

    @Test
    void nullOwnerCannotReadOwnerlessCacheOrProvisionNewCredentials() throws Exception {
        Files.writeString(stateDir.resolve("platform-ai-key.json"), "{\"openrouterKey\":\"sk-or-ownerless\",\"limitUsd\":10}");
        assertNull(channel().limitUsd());
        assertThrows(com.checkba.service.account.AccountException.class, () -> channel().apiKey());
        verify(accountService, never()).fetchAiKey();
    }

    @Test
    void resolvedKeyAndFingerprintComeFromOneCacheSnapshot() throws Exception {
        Files.writeString(stateDir.resolve("platform-ai-key.json"),
                "{\"openrouterKey\":\"sk-or-a\",\"owner\":\"acct-a\"}");
        when(accountService.accountFingerprintOrNull()).thenReturn("acct-a", "acct-b");
        var resolved = channel().connection();
        assertEquals("sk-or-a", resolved.apiKey());
        assertEquals(PlatformAiKeyCipher.fingerprint("sk-or-a"), resolved.fingerprint());
        verify(accountService, times(1)).accountFingerprintOrNull();
    }

    @Test
    void delayedOldRejectionCannotDeleteRotatedMachineRuntime() {
        connectedAs("acct-a"); websiteIssues("sk-or-a");
        PlatformAiChannel channel = channel();
        var previous = channel.connection();
        channel.clearCache(); websiteIssues("sk-or-new");
        var current = channel.connection();
        channel.onKeyRejected(1L, previous.fingerprint());
        assertEquals(current.apiKey(), channel.apiKey());
        verify(accountService, times(2)).fetchAiKey();
        channel.onKeyRejected(1L, current.fingerprint());
        assertFalse(Files.exists(stateDir.resolve("platform-ai-key.json")));
    }

    @Test
    @DisplayName("同一账户：缓存命中，不重复向官网取 key")
    void sameAccountReusesCachedKey() {
        connectedAs("acct-a");
        websiteIssues("sk-or-a");
        PlatformAiChannel channel = channel();

        assertEquals("sk-or-a", channel.apiKey());
        assertEquals("sk-or-a", channel.apiKey());

        verify(accountService, times(1)).fetchAiKey();
    }

    @Test
    @DisplayName("换账号：不认上一个账户的 key，重新取一把")
    void switchedAccountDoesNotInheritPreviousKey() {
        connectedAs("acct-a");
        websiteIssues("sk-or-a");
        PlatformAiChannel channel = channel();
        assertEquals("sk-or-a", channel.apiKey());

        connectedAs("acct-b");
        websiteIssues("sk-or-b");

        assertEquals("sk-or-b", channel.apiKey());
        verify(accountService, times(2)).fetchAiKey();
    }

    @Test
    @DisplayName("换账号后官网拒发（新账号没充值）：报错，绝不回落到上一个账户那把 key")
    void switchedAccountWithoutCreditsGetsNoKey() {
        connectedAs("acct-a");
        websiteIssues("sk-or-a");
        PlatformAiChannel channel = channel();
        assertEquals("sk-or-a", channel.apiKey());

        connectedAs("acct-b");
        when(accountService.fetchAiKey()).thenThrow(new com.checkba.service.account.AccountException(
                com.checkba.service.account.AccountException.Kind.CONFLICT,
                "Credits 余额为空，充值后即可使用平台 AI"));

        assertThrows(com.checkba.service.account.AccountException.class, channel::apiKey);
    }

    @Test
    @DisplayName("存量缓存文件没有归属字段：不信任，丢弃重取并重新绑定")
    void legacyCacheWithoutOwnerIsRefetched() throws Exception {
        Files.writeString(stateDir.resolve("platform-ai-key.json"),
                "{\"openrouterKey\":\"sk-or-legacy\",\"limitUsd\":10.0}");
        connectedAs("acct-a");
        websiteIssues("sk-or-a");

        PlatformAiChannel channel = channel();

        assertEquals("sk-or-a", channel.apiKey());
        assertTrue(Files.readString(stateDir.resolve("platform-ai-key.json")).contains("acct-a"),
                "重取之后必须把归属写进文件，否则每次调用都要重取一遍");
    }
}
