// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.account;

import com.checkba.controller.AccountController;
import com.checkba.service.LocalIdentityService;
import com.checkba.service.UserService;
import com.checkba.service.ai.PlatformAiChannel;
import com.checkba.service.platform.PlatformGatewayClient;
import com.checkba.service.platform.PlatformGatewayTransport;
import com.checkba.service.site.SiteProfileService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class AccountSessionExpiryTest {
    private static final String KEY = "awdk_synthetic_old";
    private static final String NEW_KEY = "awdk_synthetic_new";
    private static final String ME = "{\"accountId\":\"synthetic-account\",\"displayName\":\"Test\",\"balanceCents\":100}";
    @TempDir Path directory;
    private final SiteProfileService site = SiteProfileService.pinnedTo("https://www.aiworkdeck.com");

    private static class Transport implements AccountTransport {
        Reply reply = new Reply(200, ME);
        @Override public Reply send(String method, String url, String key, String body) { return reply; }
        @Override public Reply sendMultipart(String method, String url, String key, Multipart body) { return reply; }
    }
    private AccountService connected(Transport transport) {
        AccountService service = new AccountService(site, directory.toString(), transport, null);
        service.connect(KEY);
        return service;
    }
    private void assertExpired(AccountService service) {
        assertEquals(false, service.status().get("connected"));
        assertEquals(true, service.status().get("authExpired"));
        assertFalse(service.isConnected());
        assertNull(service.currentKeyOrNull());
        assertNull(service.currentAccountIdOrNull());
        assertNull(service.currentDisplayNameOrNull());
        assertNull(service.accountFingerprintOrNull());
        assertFalse(service.status().containsKey("keyMasked"));
    }

    @Test void statusCannotHideDefinitiveRejectionBehindQuietIdentitySync() {
        Transport transport = new Transport();
        AccountService service = connected(transport);
        LocalIdentityService local = mock(LocalIdentityService.class);
        when(local.isLocalMode()).thenReturn(true);
        AccountIdentitySync sync = new AccountIdentitySync(service, local, mock(UserService.class), event -> {});
        AccountController controller = new AccountController(service, mock(PlatformAiChannel.class), null, null,
                mock(MachineAccountGuard.class), null, null, null, null, sync);
        transport.reply = new AccountTransport.Reply(401, "{\"error\":\"unauthorized\"}");
        Map<?, ?> data = (Map<?, ?>) controller.status(null).get("data");
        assertEquals(false, data.get("connected"));
        assertEquals(true, data.get("authExpired"));
        assertExpired(service);
        assertExpired(new AccountService(site, directory.toString(), transport, null));
    }

    @Test void allCurrentAccountRequestShapesRecordRejection() {
        List<Consumer<AccountService>> requests = List.of(AccountService::fetchProfile, AccountService::fetchAiKey,
                s -> s.updateDisplayName("New"), s -> s.uploadAvatar(new byte[]{1}, "test.png", "image/png"),
                s -> s.uploadTeamUsage("{}"), s -> s.purchaseSku("clipboard.unlimited"),
                s -> s.createRecharge(100, "synthetic-recharge"));
        for (Consumer<AccountService> request : requests) {
            Transport transport = new Transport();
            AccountService service = connected(transport);
            transport.reply = new AccountTransport.Reply(401, "{}");
            assertEquals(AccountException.Kind.UNAUTHORIZED,
                    assertThrows(AccountException.class, () -> request.accept(service)).getKind());
            assertExpired(service);
        }
    }

    @Test void balanceAndTrialNeverReportExpiredCredentialsAsConnected() {
        for (boolean trial : List.of(false, true)) {
            Transport transport = new Transport();
            AccountService service = connected(transport);
            transport.reply = new AccountTransport.Reply(401, "{}");
            Map<String, Object> first = trial ? service.trialSnapshot() : service.balanceSnapshot();
            assertEquals(false, first.get("connected"));
            assertEquals(true, first.get("authExpired"));
            Map<String, Object> again = trial ? service.trialSnapshot() : service.balanceSnapshot();
            assertEquals(false, again.get("connected"));
            assertEquals(true, again.get("authExpired"));
        }
    }

    @Test void networkFailureAndTeamRoleDenialKeepConnectedAccount() {
        Transport transport = new Transport();
        AccountService service = connected(transport);
        for (int code : List.of(AccountTransport.Reply.NETWORK_FAILURE, 503)) {
            transport.reply = new AccountTransport.Reply(code, "{}");
            assertThrows(AccountException.class, service::fetchProfile);
            assertTrue(service.isConnected());
            assertEquals(true, service.balanceSnapshot().get("connected"));
        }
        transport.reply = new AccountTransport.Reply(403, "{\"error\":\"forbidden\"}");
        assertEquals(AccountException.Kind.REJECTED, assertThrows(AccountException.class, service::fetchTeam).getKind());
        assertTrue(service.isConnected());
    }

    @Test void candidateKeysAndPasswordFailuresDoNotExpireExistingAccount() {
        Transport transport = new Transport();
        AccountService service = connected(transport);
        transport.reply = new AccountTransport.Reply(401, "{\"error\":\"unauthorized\"}");
        assertThrows(AccountException.class, () -> service.connect(KEY));
        assertThrows(AccountException.class, () -> service.fetchProfileWith(KEY));
        assertThrows(AccountException.class, () -> service.fetchAiKeyWith(KEY));
        assertThrows(AccountException.class, () -> service.loginWithPassword("test@example.invalid", "wrong"));
        assertTrue(service.isConnected());
    }

    @Test void delayedOldRejectionCannotExpireNewLogin() throws Exception {
        delayedRejectionAfterReconnect(NEW_KEY);
    }

    @Test void delayedRejectionCannotExpireRevalidatedSameKey() throws Exception {
        delayedRejectionAfterReconnect(KEY);
    }

    private void delayedRejectionAfterReconnect(String replacementKey) throws Exception {
        CountDownLatch requested = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        Transport transport = new Transport() {
            @Override public Reply send(String method, String url, String key, String body) {
                if (url.contains("ledger")) {
                    requested.countDown();
                    try { if (!release.await(5, TimeUnit.SECONDS)) throw new AssertionError("request timed out"); }
                    catch (InterruptedException e) { throw new AssertionError(e); }
                    return new Reply(401, "{}");
                }
                return super.send(method, url, key, body);
            }
        };
        AccountService service = connected(transport);
        var pool = Executors.newSingleThreadExecutor();
        try {
            var old = pool.submit(() -> assertThrows(AccountException.class, service::fetchLedger));
            assertTrue(requested.await(5, TimeUnit.SECONDS));
            service.connect(replacementKey);
            release.countDown();
            old.get(5, TimeUnit.SECONDS);
        } finally { release.countDown(); pool.shutdownNow(); }
        assertTrue(service.isConnected());
        assertEquals(replacementKey, service.currentKeyOrNull());
    }

    /** Deterministically interleave a same-key reconnect with a credential snapshot read. */
    private class ReconnectingService extends AccountService {
        boolean reconnectOnRead;
        ReconnectingService() {
            super(site, directory.toString(), new Transport() {
                @Override public Reply send(String method, String url, String key, String body) {
                    return new Reply(url.endsWith("/api/account/me") ? 200 : 401, ME);
                }
                @Override public Reply sendMultipart(String method, String url, String key, Multipart body) {
                    return new Reply(401, "{}");
                }
            }, null);
            connect(KEY);
        }
        @Override synchronized State loadState() {
            State snapshot = super.loadState();
            if (reconnectOnRead) {
                reconnectOnRead = false;
                connect(KEY);
            }
            return snapshot;
        }
    }

    @Test void accountRequestCannotPairOldCredentialSnapshotWithNewConnectionVersion() {
        List<Consumer<AccountService>> requests = List.of(AccountService::fetchLedger, AccountService::fetchAiKey,
                s -> s.updateDisplayName("New"), s -> s.uploadAvatar(new byte[]{1}, "test.png", "image/png"),
                s -> s.uploadTeamUsage("{}"), s -> s.purchaseSku("clipboard.unlimited"),
                s -> s.createRecharge(100, "synthetic-recharge"));
        for (Consumer<AccountService> request : requests) {
            ReconnectingService service = new ReconnectingService();
            service.reconnectOnRead = true;
            assertThrows(AccountException.class, () -> request.accept(service));
            assertTrue(service.isConnected(), "a rejection from the old credential snapshot cannot expire the reconnect");
            assertEquals(KEY, service.currentKeyOrNull());
        }
    }

    @Test void gatewayRequestsCannotPairOldCredentialSnapshotWithNewConnectionVersion() {
        for (boolean get : List.of(false, true)) {
            ReconnectingService service = new ReconnectingService();
            service.reconnectOnRead = true;
            PlatformGatewayClient gateway = new PlatformGatewayClient(
                    (method, url, key, idempotency, body, timeout) -> new PlatformGatewayTransport.Reply(401, "{}"),
                    service, site);
            assertThrows(RuntimeException.class, () -> {
                if (get) gateway.getJson("/api/gateway/pricing", 10);
                else gateway.postJson("/api/gateway/asr/ticket", Map.of(), false, 10);
            });
            assertTrue(service.isConnected());
        }
    }

    @Test void successfulReconnectClearsExpiryAndOldProfileCache() {
        Transport transport = new Transport();
        AccountService service = connected(transport);
        service.profileIdentity();
        transport.reply = new AccountTransport.Reply(401, "{}");
        assertThrows(AccountException.class, service::fetchLedger);
        assertExpired(service);
        transport.reply = new AccountTransport.Reply(200, ME.replace("Test", "Updated"));
        service.connect(KEY);
        assertTrue(service.isConnected());
        assertFalse(Boolean.TRUE.equals(service.status().get("authExpired")));
        assertEquals("Updated", service.profileIdentity().get("displayName"));
        service.disconnect();
        assertFalse(Boolean.TRUE.equals(service.status().get("authExpired")));
    }

    @Test void asynchronousTranscriptionGatewayRejectionPersistsAccountExpiry() {
        Transport transport = new Transport();
        AccountService service = connected(transport);
        PlatformGatewayTransport gateway = (method, url, key, idempotency, body, timeout) ->
                new PlatformGatewayTransport.Reply(401, "{}");
        PlatformGatewayClient client = new PlatformGatewayClient(gateway, service, site);
        assertThrows(RuntimeException.class, () -> client.postJson("/api/gateway/asr/ticket", Map.of(), false, 10));
        assertExpired(service);
    }
}
