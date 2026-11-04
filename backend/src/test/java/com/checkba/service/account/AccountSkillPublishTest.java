// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.account;

import com.checkba.service.site.SiteProfileService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;
import java.util.ArrayList;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/** Skill 发布端点与团队成员 title 补丁的出站请求形状，以及 /api/skills/ 下 403 forbidden 的分类。 */
class AccountSkillPublishTest {
    private static final String BASE = "https://www.aiworkdeck.com";
    private static final String KEY = "awdk_qa-test-credential-only-not-a-real-key";
    private static final String ME = "{\"accountId\":\"qa-b\",\"username\":\"qa-b\",\"displayName\":\"QA B\"}";

    @TempDir Path directory;
    private final Deque<AccountTransport.Reply> replies = new ArrayDeque<>();
    private final List<String[]> requests = new ArrayList<>();
    private final ObjectMapper json = new ObjectMapper();

    private AccountService connected() {
        replies.add(new AccountTransport.Reply(200, ME));
        AccountService service = new AccountService(
                SiteProfileService.pinnedTo(BASE), directory.toString(),
                (method, url, bearer, body) -> {
                    requests.add(new String[]{method, url, bearer, body});
                    assertFalse(replies.isEmpty(), "Unexpected request: " + method + " " + url);
                    return replies.removeFirst();
                }, null);
        service.connect(KEY);
        requests.clear();
        return service;
    }

    @Test
    void submitSkillPostsJsonWithBearer() throws Exception {
        AccountService service = connected();
        replies.add(new AccountTransport.Reply(200, "{\"skill\":{\"version\":\"1.0.0\"}}"));

        Map<String, Object> reply = service.submitSkill(Map.of("id", "my-skill", "name", "技能"));

        String[] r = requests.get(0);
        assertEquals("POST", r[0]);
        assertEquals(BASE + "/api/skills", r[1]);
        assertEquals(KEY, r[2]);
        assertEquals(Map.of("id", "my-skill", "name", "技能"), json.readValue(r[3], Map.class));
        assertEquals(Map.of("version", "1.0.0"), reply.get("skill"));
    }

    @Test
    void updatePublishedSkillPutsToEncodedId() {
        AccountService service = connected();
        replies.add(new AccountTransport.Reply(200, "{\"skill\":{}}"));

        service.updatePublishedSkill("a b/c", Map.of("name", "n"));

        assertEquals("PUT", requests.get(0)[0]);
        assertEquals(BASE + "/api/skills/a+b%2Fc", requests.get(0)[1]);
    }

    @Test
    void forbiddenOnSkillPathIsRejectedAndKeepsConnection() {
        AccountService service = connected();
        replies.add(new AccountTransport.Reply(403, "{\"error\":\"forbidden\"}"));

        AccountException e = assertThrows(AccountException.class,
                () -> service.updatePublishedSkill("x", Map.of("name", "n")));

        assertEquals(AccountException.Kind.REJECTED, e.getKind());
        assertEquals("forbidden", e.getReason());
        assertTrue(service.isConnected());
    }

    @Test
    void unauthorizedOnSkillSubmitDoesNotDisconnectAccount() {
        // 官网还没部署「Bearer 投稿」时投稿端点一律 401：不能据此把一把好 Key 标成失效
        AccountService service = connected();
        replies.add(new AccountTransport.Reply(401, "{\"error\":\"unauthorized\"}"));

        AccountException e = assertThrows(AccountException.class, () -> service.submitSkill(Map.of("id", "x")));

        assertEquals(AccountException.Kind.REJECTED, e.getKind());
        assertEquals("publish_unauthorized", e.getReason());
        assertTrue(service.isConnected());
    }

    @Test
    void idTakenOnSubmitIsRejected() {
        AccountService service = connected();
        replies.add(new AccountTransport.Reply(400, "{\"error\":\"id_taken\"}"));

        AccountException e = assertThrows(AccountException.class, () -> service.submitSkill(Map.of("id", "x")));

        assertEquals(AccountException.Kind.REJECTED, e.getKind());
        assertEquals("id_taken", e.getReason());
        assertTrue(service.isConnected());
    }

    @Test
    void forbiddenOnNonSkillAccountPathStillUnauthorized() {
        AccountService service = connected();
        replies.add(new AccountTransport.Reply(403, "{\"error\":\"forbidden\"}"));
        assertEquals(AccountException.Kind.UNAUTHORIZED,
                assertThrows(AccountException.class, service::fetchProfile).getKind());
    }

    @Test
    void updateTeamMemberPatchesTitle() throws Exception {
        AccountService service = connected();
        replies.add(new AccountTransport.Reply(200, "{}"));

        service.updateTeamMember("acc-1", Map.of("title", "合伙人"));

        String[] r = requests.get(0);
        assertEquals("PATCH", r[0]);
        assertEquals(BASE + "/api/account/team/members/acc-1", r[1]);
        assertEquals(Map.of("title", "合伙人"), json.readValue(r[3], Map.class));
    }
}
