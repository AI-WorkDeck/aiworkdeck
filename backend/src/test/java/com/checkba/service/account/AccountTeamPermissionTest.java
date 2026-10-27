// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.account;

import com.checkba.controller.AccountController;
import com.checkba.service.site.SiteProfileService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.Map;
import java.util.function.Consumer;

import static org.junit.jupiter.api.Assertions.*;

/** Synthetic transport regression for an administrator demoted on another device. */
class AccountTeamPermissionTest {
    private static final String KEY = "awdk_qa-test-credential-only-not-a-real-key";
    private static final String ME = "{\"accountId\":\"qa-b\",\"username\":\"qa-b\",\"displayName\":\"QA B\"}";

    @TempDir Path directory;
    private final Deque<AccountTransport.Reply> replies = new ArrayDeque<>();

    private AccountService connected() {
        replies.add(new AccountTransport.Reply(200, ME));
        AccountService service = new AccountService(
                SiteProfileService.pinnedTo("https://www.aiworkdeck.com"), directory.toString(),
                (method, url, bearer, body) -> {
                    assertEquals(KEY, bearer);
                    assertFalse(replies.isEmpty(), "Unexpected request: " + method + " " + url);
                    return replies.removeFirst();
                }, null);
        service.connect(KEY);
        return service;
    }

    @Test
    void staleAdministratorSaveIsPermissionDenialAndPreservesConnectedAccount() throws Exception {
        AccountService service = connected();
        byte[] before = Files.readAllBytes(directory.resolve("account.json"));
        replies.add(new AccountTransport.Reply(403, "{\"error\":\"forbidden\"}"));

        AccountException denied = assertThrows(AccountException.class,
                () -> service.updateTeam(Map.of("name", "Existing QA team name")));

        assertEquals(AccountException.Kind.REJECTED, denied.getKind());
        assertEquals("forbidden", denied.getReason());
        assertTrue(denied.getMessage().contains("权限"), denied.getMessage());
        assertFalse(denied.getMessage().contains("Key"), denied.getMessage());
        for (String authMarker : new String[] {"登录", "未授权", "请先"}) {
            assertFalse(denied.getMessage().contains(authMarker), denied.getMessage());
        }
        assertArrayEquals(before, Files.readAllBytes(directory.resolve("account.json")));
        Map<String, Object> envelope = new AccountController(service, null, null, null, null,
                null, null, null, null, null).handleAccountException(denied).getBody();
        assertNotNull(envelope);
        assertEquals(1, envelope.get("code"));
        assertEquals("REJECTED", envelope.get("kind"));
        assertEquals("forbidden", envelope.get("reason"));
        replies.add(new AccountTransport.Reply(200, "{\"myRole\":\"MEMBER\"}"));
        assertEquals("MEMBER", service.fetchTeam().get("myRole"));
        assertEquals(KEY, service.currentKeyOrNull());
    }

    @Test
    void teamReadFirmAndUsagePermissionDenialsUseTheSameBusinessClassification() {
        AccountService service = connected();
        for (Consumer<AccountService> action : java.util.List.<Consumer<AccountService>>of(
                s -> s.fetchTeamSummary(7, "firm"),
                s -> s.updateFirm("QA firm"),
                s -> s.updateTeamMember("qa-c", "ADMIN"),
                s -> s.uploadTeamUsage("{}"))) {
            replies.add(new AccountTransport.Reply(403, "{\"error\":\"forbidden\"}"));
            AccountException denied = assertThrows(AccountException.class, () -> action.accept(service));
            assertEquals(AccountException.Kind.REJECTED, denied.getKind());
            assertEquals("forbidden", denied.getReason());
        }
    }

    @Test
    void genuineTeamCredentialFailuresRemainUnauthorized() {
        AccountService service = connected();
        for (String body : new String[] {"{\"error\":\"unauthorized\"}",
                "{\"error\":\"invalid_key\"}", "{\"error\":\"key_revoked\"}", "<html>Forbidden</html>"}) {
            replies.add(new AccountTransport.Reply(403, body));
            AccountException denied = assertThrows(AccountException.class,
                    () -> service.updateTeam(Map.of("name", "QA team")));
            assertEquals(AccountException.Kind.UNAUTHORIZED, denied.getKind(), body);
        }
        replies.add(new AccountTransport.Reply(401, "{\"error\":\"forbidden\"}"));
        assertEquals(AccountException.Kind.UNAUTHORIZED,
                assertThrows(AccountException.class, service::fetchTeam).getKind());
    }

    @Test
    void unrelatedAccountForbiddenResponseKeepsItsExistingAuthenticationMeaning() {
        AccountService service = connected();
        replies.add(new AccountTransport.Reply(403, "{\"error\":\"forbidden\"}"));
        assertEquals(AccountException.Kind.UNAUTHORIZED,
                assertThrows(AccountException.class, service::fetchProfile).getKind());
    }
}
