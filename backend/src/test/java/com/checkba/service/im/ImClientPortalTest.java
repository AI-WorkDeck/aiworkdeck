// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.im;

import com.checkba.exception.RateLimitedException;
import com.checkba.model.entity.Project;
import com.checkba.model.entity.ProjectInvitation;
import com.checkba.model.entity.User;
import com.checkba.repository.*;
import com.checkba.service.ClientInvitationService;
import com.checkba.service.LocalIdentityService;
import com.checkba.service.UserRateLimiter;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.time.LocalDateTime;
import java.util.*;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.mock;

/**
 * B4: a client holding an access code reaches only their project's group, only while the code is live, and sees
 * earlier messages only when the lawyer chose so on the code. Every path goes through {@link ImService}, which is
 * what the portal, the desktop client proxy and direct calls to {@code /api/im/action} all hit.
 */
@DataJpaTest(showSql = false)
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@TestPropertySource(properties = {
        "spring.datasource.url=jdbc:h2:mem:im-client-portal-test;MODE=PostgreSQL;NON_KEYWORDS=VALUE;DB_CLOSE_DELAY=-1;LOCK_TIMEOUT=10000",
        "spring.datasource.driver-class-name=org.h2.Driver", "spring.datasource.username=sa", "spring.datasource.password=",
        "spring.jpa.database-platform=org.hibernate.dialect.H2Dialect", "spring.jpa.hibernate.ddl-auto=create-drop"
})
@Import({ImService.class, com.checkba.service.ProjectMemberService.class, ClientInvitationService.class})
@Transactional(propagation = Propagation.NOT_SUPPORTED)
class ImClientPortalTest {
    @Autowired ImService service;
    @Autowired ClientInvitationService codes;
    @Autowired UserRepository users;
    @Autowired ProjectRepository projects;
    @Autowired ProjectMemberRepository projectMembers;
    @Autowired ProjectInvitationRepository invitationRows;
    @Autowired ImMemberRepository memberRows;
    @MockBean LocalIdentityService localIdentity;

    final List<String> audit = new ArrayList<>();
    Long lawyer, colleague;
    long projectId, otherProjectId;

    @BeforeEach
    void setup() {
        ReflectionTestUtils.setField(service, "agents", mock(ImAgentService.class));
        ReflectionTestUtils.setField(service, "rateLimiter", null);
        audit.clear();
        ReflectionTestUtils.setField(service, "portalAudit", new ClientPortalChatAudit() {
            public void joined(Long clientUserId, Long projectId, String conversationId, String title, boolean shareHistory) {
                audit.add("joined:" + clientUserId + ":" + projectId + ":" + conversationId + ":" + shareHistory);
            }
            public void denied(Long clientUserId, Long projectId, String reason) {
                audit.add("denied:" + clientUserId + ":" + projectId + ":" + reason);
            }
        });
        lawyer = user("合成律师", "USER");
        colleague = user("合成同事", "USER");
        projectId = project("合成项目");
        otherProjectId = project("另一合成项目");
        addMember(projectId, colleague, "PARTICIPANT");
    }

    @Test
    void codeClientReachesOnlyItsOwnProjectGroup() {
        Long client = codes.issueClientCode(projectId, lawyer, "合成客户", false).clientUserId();
        String group = id(call(client, "projectGroup", Map.of("projectId", projectId)));
        assertEquals("CLIENT", call(client, "projectGroup", Map.of("projectId", projectId)).get("role"));
        send(client, group, "c1", "合成客户问题");
        assertEquals(1, messages(client, group).size());

        // Another project's group, by project id and by a conversation id the client should never have.
        String otherGroup = id(call(lawyer, "projectGroup", Map.of("projectId", otherProjectId)));
        assertReason(ImService.DENIED_OUT_OF_SCOPE, () -> call(client, "projectGroup", Map.of("projectId", otherProjectId)));
        assertReason(ImService.DENIED_OUT_OF_SCOPE, () -> call(client, "messages", Map.of("conversationId", otherGroup)));
        assertReason(ImService.DENIED_OUT_OF_SCOPE, () -> send(client, otherGroup, "c2", "越界"));

        // Internal spaces: a DM and a non-project group, even with a member row planted for the client.
        String direct = id(call(lawyer, "create", Map.of("type", "DIRECT", "title", "内部私聊")));
        String internal = id(call(lawyer, "create", Map.of("type", "GROUP", "title", "内部讨论组")));
        for (String conversation : List.of(direct, internal)) {
            var row = new com.checkba.model.entity.ImMember();
            row.setConversationId(conversation); row.setUserId(client); row.setRole("CLIENT"); row.setJoinedAt(java.time.Instant.now());
            memberRows.saveAndFlush(row);
            for (String action : List.of("messages", "send", "read", "download", "upload", "members"))
                assertReason(ImService.DENIED_OUT_OF_SCOPE, () -> call(client, action, Map.of("conversationId", conversation, "clientMessageId", "x", "text", "x",
                        "attachmentId", "00000000-0000-0000-0000-000000000000", "name", "a.txt", "base64", "YQ==", "lastReadId", 1)));
        }

        // Actions that are never a client's, on their own group too.
        for (String action : List.of("list", "create", "join", "invite", "removeMember", "leave", "fileAccess",
                "agentScopes", "ensureAgent", "agentInfo", "agentReply"))
            assertReason(ImService.DENIED_ACTION, () -> call(client, action, kv("conversationId", group, "type", "GROUP", "title", "x", "code", "x",
                    "role", "CLIENT", "userId", lawyer, "attachmentId", "x", "clientVisible", true, "scope", "project",
                    "scopeKey", "project:" + projectId, "private", true)));

        // The roster stays hidden; only the head count.
        Map<String, Object> roster = call(client, "members", Map.of("conversationId", group));
        assertEquals(List.of(), roster.get("members"));
        assertEquals(2, roster.get("humanCount"));
        assertTrue(audit.stream().anyMatch(a -> a.endsWith(":" + ImService.DENIED_OUT_OF_SCOPE)));
        assertTrue(audit.stream().anyMatch(a -> a.endsWith(":" + ImService.DENIED_ACTION)));
    }

    @Test
    void clientsWithARealAccountKeepAdHocChatInvites() {
        // A client who uses their own AI WorkDeck account (not an access code) joins an ad-hoc group by chat invite as before.
        Long accountClient = user("账户客户", "USER");
        String adHoc = id(call(lawyer, "create", Map.of("type", "GROUP", "title", "外部沟通组")));
        send(lawyer, adHoc, "early", "早先合成讨论");
        Object code = call(lawyer, "invite", Map.of("conversationId", adHoc, "role", "CLIENT")).get("code");
        assertEquals("CLIENT", call(accountClient, "join", Map.of("code", code)).get("role"));
        send(accountClient, adHoc, "hi", "账户客户合成留言");
        assertEquals(List.of("账户客户合成留言"), texts(messages(accountClient, adHoc)), "joined with the usual after-joining floor");
        assertTrue(((List<?>) call(accountClient, "list", Map.of()).get("conversations")).size() >= 1);
    }

    @Test
    void accessCodeClientsAreToldWhatAChatInviteIsFor() {
        Long portal = codes.issueClientCode(projectId, lawyer, "合成客户", false).clientUserId();
        String adHoc = id(call(lawyer, "create", Map.of("type", "GROUP", "title", "外部沟通组")));
        Object code = call(lawyer, "invite", Map.of("conversationId", adHoc, "role", "CLIENT")).get("code");
        IllegalArgumentException refused = assertThrows(IllegalArgumentException.class, () -> call(portal, "join", Map.of("code", code)));
        assertEquals(ImService.CHAT_INVITE_FOR_ACCOUNTS, refused.getMessage());
        assertTrue(memberRows.findByConversationIdAndUserId(adHoc, portal).isEmpty());
        // Typed into the portal's access-code box, the same code is recognised rather than called invalid.
        assertThrows(ClientInvitationService.ChatInvitationCodeException.class, () -> codes.validateCode(String.valueOf(code)));
    }

    @Test
    void expiredRevokedOrRemovedCodeEndsChatOnTheNextRequest() {
        var issued = codes.issueClientCode(projectId, lawyer, "合成客户", false);
        Long client = issued.clientUserId();
        String group = id(call(client, "projectGroup", Map.of("projectId", projectId)));
        ProjectInvitation code = invitationRows.findByAccessCode(issued.code()).orElseThrow();

        code.setExpiresAt(LocalDateTime.now().minusMinutes(1));
        invitationRows.saveAndFlush(code);
        for (String action : List.of("self", "projectGroup", "messages", "send", "read", "members"))
            assertCodeInactive(() -> call(client, action, Map.of("projectId", projectId, "conversationId", group, "clientMessageId", "x", "text", "x", "lastReadId", 1)));

        code.setExpiresAt(LocalDateTime.now().plusDays(1)); code.setRevokedAt(LocalDateTime.now());
        invitationRows.saveAndFlush(code);
        assertCodeInactive(() -> messages(client, group));

        code.setRevokedAt(null);
        invitationRows.saveAndFlush(code);
        assertEquals(0, messages(client, group).size(), "live again once the lawyer reissues");

        projectMembers.findByProjectIdAndUserId(projectId, client).ifPresent(projectMembers::delete);
        projectMembers.flush();
        assertCodeInactive(() -> messages(client, group));
        assertEquals(1, audit.stream().filter(a -> a.startsWith("denied:" + client + ":") && a.endsWith(ImService.DENIED_CODE_INACTIVE)).count(),
                "a polling client produces one denial record per window, not one per poll");
    }

    @Test
    void sharedGenericCodesCannotChat() {
        // A generic code is one identity for everyone holding it, and a typed name selects anyone's login: no chat.
        var issued = codes.issueClientCode(projectId, lawyer, null, false);
        assertReason(ImService.DENIED_GENERIC_CODE, () -> call(issued.clientUserId(), "projectGroup", Map.of("projectId", projectId)));
        ProjectInvitation code = invitationRows.findByAccessCode(issued.code()).orElseThrow();
        User person = codes.createClientUser(code, "合成联系人");
        assertReason(ImService.DENIED_GENERIC_CODE, () -> call(person.getId(), "projectGroup", Map.of("projectId", projectId)));
        assertReason(ImService.DENIED_GENERIC_CODE, () -> call(person.getId(), "self", Map.of()));
    }

    @Test
    void earlierMessagesFollowTheLawyersChoiceOnTheCode() {
        String group = id(call(lawyer, "projectGroup", Map.of("projectId", projectId)));
        send(lawyer, group, "before-1", "入群前合成消息一");
        String earlierFile = id(call(lawyer, "upload", Map.of("conversationId", group, "name", "before.txt", "base64", b64("before"), "clientMessageId", "f0")));
        call(lawyer, "send", Map.of("conversationId", group, "clientMessageId", "f0", "attachmentId", earlierFile, "text", ""));
        call(lawyer, "fileAccess", Map.of("conversationId", group, "attachmentId", earlierFile, "clientVisible", true));

        Long afterOnly = codes.issueClientCode(projectId, lawyer, "默认客户", false).clientUserId();
        Long sharing = codes.issueClientCode(projectId, lawyer, "开放历史客户", true).clientUserId();
        call(afterOnly, "projectGroup", Map.of("projectId", projectId));
        call(sharing, "projectGroup", Map.of("projectId", projectId));
        send(lawyer, group, "after-1", "入群后合成消息");

        assertEquals(List.of("入群后合成消息"), texts(messages(afterOnly, group)));
        assertDenied(() -> call(afterOnly, "download", Map.of("conversationId", group, "attachmentId", earlierFile)));
        assertEquals(List.of("入群前合成消息一", "", "入群后合成消息"), texts(messages(sharing, group)));
        assertNotNull(call(sharing, "download", Map.of("conversationId", group, "attachmentId", earlierFile)).get("base64"));
        assertTrue(audit.contains("joined:" + afterOnly + ":" + projectId + ":" + group + ":false"));
        assertTrue(audit.contains("joined:" + sharing + ":" + projectId + ":" + group + ":true"));
    }

    @Test
    void reissuingTheSameCodeNeverWidensHistory() {
        // The reissued code goes back to everyone who already has it; turning history on would reach them too.
        var first = codes.issueClientCode(projectId, lawyer, null, false);
        var again = codes.issueClientCode(projectId, lawyer, null, true);
        assertEquals(first.code(), again.code());
        assertFalse(again.shareHistory(), "the echo says what the code now does");
        assertEquals(Boolean.FALSE, invitationRows.findByAccessCode(first.code()).orElseThrow().getImShareHistory());
        // A named code is issued per client, so the lawyer's choice is taken as asked.
        assertTrue(codes.issueClientCode(projectId, lawyer, "开放历史客户", true).shareHistory());
    }

    @Test
    void floorHoldsForFirstPagePollingFromZeroAndUnreadCounts() {
        String group = id(call(lawyer, "projectGroup", Map.of("projectId", projectId)));
        for (int i = 0; i < 3; i++) send(lawyer, group, "pre-" + i, "入群前" + i);
        Long client = codes.issueClientCode(projectId, lawyer, "合成客户", false).clientUserId();
        Map<String, Object> view = call(client, "projectGroup", Map.of("projectId", projectId));
        assertEquals(0L, ((Number) view.get("unreadCount")).longValue());
        send(lawyer, group, "post", "入群后");
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> fromZero = (List<Map<String, Object>>) call(client, "messages", Map.of("conversationId", group, "afterId", 0)).get("messages");
        assertEquals(List.of("入群后"), texts(fromZero));
        assertEquals(1L, ((Number) call(client, "projectGroup", Map.of("projectId", projectId)).get("unreadCount")).longValue());
    }

    @Test
    void lawyersEndAClientsChatByRevokingTheCodeNotByRemovingTheMember() {
        Long client = codes.issueClientCode(projectId, lawyer, "合成客户", false).clientUserId();
        String group = id(call(client, "projectGroup", Map.of("projectId", projectId)));
        IllegalArgumentException refused = assertThrows(IllegalArgumentException.class,
                () -> call(lawyer, "removeMember", Map.of("conversationId", group, "userId", client)));
        assertTrue(refused.getMessage().contains("撤销"), refused.getMessage());
        assertTrue(memberRows.findByConversationIdAndUserId(group, client).isPresent());
    }

    @Test
    void internalMembersAreUnaffectedAndSeeTheClientMarked() {
        String group = id(call(lawyer, "projectGroup", Map.of("projectId", projectId)));
        send(lawyer, group, "early", "早期合成消息");
        call(colleague, "projectGroup", Map.of("projectId", projectId));
        assertEquals(List.of("早期合成消息"), texts(messages(colleague, group)), "internal members keep full history");

        Long client = codes.issueClientCode(projectId, lawyer, "合成客户", false).clientUserId();
        call(client, "projectGroup", Map.of("projectId", projectId));
        send(client, group, "q", "合成客户问题");
        List<Map<String, Object>> seen = messages(lawyer, group);
        assertEquals(Boolean.TRUE, seen.get(1).get("fromClient"));
        assertNull(seen.get(0).get("fromClient"));
        assertEquals("合成客户", seen.get(1).get("senderName"));
    }

    @Test
    void attachmentsFollowTheExistingClientFileRule() {
        Long client = codes.issueClientCode(projectId, lawyer, "合成客户", false).clientUserId();
        String group = id(call(client, "projectGroup", Map.of("projectId", projectId)));
        String lawyerFile = id(call(lawyer, "upload", Map.of("conversationId", group, "name", "memo.txt", "base64", b64("internal memo"), "clientMessageId", "m1")));
        call(lawyer, "send", Map.of("conversationId", group, "clientMessageId", "m1", "attachmentId", lawyerFile, "text", "备忘"));
        Map<?, ?> shown = (Map<?, ?>) messages(client, group).get(0).get("attachment");
        assertEquals(false, shown.get("available"));
        assertDenied(() -> call(client, "download", Map.of("conversationId", group, "attachmentId", lawyerFile)));

        call(lawyer, "fileAccess", Map.of("conversationId", group, "attachmentId", lawyerFile, "clientVisible", true));
        assertEquals(b64("internal memo"), call(client, "download", Map.of("conversationId", group, "attachmentId", lawyerFile)).get("base64"));

        String own = id(call(client, "upload", Map.of("conversationId", group, "name", "scan.pdf", "base64", b64("client scan"), "clientMessageId", "u1")));
        call(client, "send", Map.of("conversationId", group, "clientMessageId", "u1", "attachmentId", own, "text", ""));
        assertEquals(b64("client scan"), call(client, "download", Map.of("conversationId", group, "attachmentId", own)).get("base64"));
        assertEquals(b64("client scan"), call(lawyer, "download", Map.of("conversationId", group, "attachmentId", own)).get("base64"));
    }

    @Test
    void clientUploadsHaveTheirOwnQuotaAndCannotPoseAsProjectFiles() {
        Long client = codes.issueClientCode(projectId, lawyer, "合成客户", false).clientUserId();
        String group = id(call(client, "projectGroup", Map.of("projectId", projectId)));
        Map<String, Object> cited = call(client, "upload", kv("conversationId", group, "name", "x.txt", "base64", b64("x"),
                "source", Map.of("projectUid", "00000000-0000-0000-0000-000000000001", "fileUid", "00000000-0000-0000-0000-000000000002")));
        assertNull(cited.get("source"), "a client upload never cites a project file");
        String eight = Base64.getEncoder().encodeToString(new byte[ImService.MAX_FILE_BYTES]);
        for (int i = 0; i < 3; i++) call(client, "upload", Map.of("conversationId", group, "name", "big" + i + ".bin", "base64", eight));
        IllegalArgumentException full = assertThrows(IllegalArgumentException.class,
                () -> call(client, "upload", Map.of("conversationId", group, "name", "big3.bin", "base64", eight)));
        assertTrue(full.getMessage().contains("32MiB"), full.getMessage());
        call(lawyer, "upload", Map.of("conversationId", group, "name", "lawyer.bin", "base64", eight));
    }

    @Test
    void sendsAreLimitedPerSenderAndServerPostersAreNotCounted() {
        UserRateLimiter limiter = new UserRateLimiter(false, 30, 300, 20, 120, 30, 120);
        @SuppressWarnings("unchecked")
        Map<UserRateLimiter.Kind, Integer> perMinute = (Map<UserRateLimiter.Kind, Integer>) ReflectionTestUtils.getField(limiter, "perMinute");
        perMinute.put(UserRateLimiter.Kind.IM_SEND, 2);
        perMinute.put(UserRateLimiter.Kind.IM_READ, 3);
        ReflectionTestUtils.setField(service, "rateLimiter", limiter);
        Long client = codes.issueClientCode(projectId, lawyer, "合成客户", false).clientUserId();
        String group = id(call(client, "projectGroup", Map.of("projectId", projectId)));

        request(client, "send", Map.of("conversationId", group, "clientMessageId", "r1", "text", "一"));
        request(client, "send", Map.of("conversationId", group, "clientMessageId", "r2", "text", "二"));
        RateLimitedException tooFast = assertThrows(RateLimitedException.class,
                () -> request(client, "send", Map.of("conversationId", group, "clientMessageId", "r3", "text", "三")));
        assertTrue(tooFast.getMessage().contains("发送太快"), tooFast.getMessage());
        assertTrue(tooFast.getRetryAfterSeconds() > 0);

        // Another sender has their own bucket; a server-side poster (direct execute) is not counted at all.
        request(lawyer, "send", Map.of("conversationId", group, "clientMessageId", "l1", "text", "律师一"));
        for (int i = 0; i < 5; i++) send(lawyer, group, "internal-" + i, "系统合成通知" + i);

        // A client's polling has its own, larger bucket; staff polling is not limited.
        for (int i = 0; i < 3; i++) request(client, "messages", Map.of("conversationId", group));
        assertThrows(RateLimitedException.class, () -> request(client, "messages", Map.of("conversationId", group)));
        for (int i = 0; i < 10; i++) request(lawyer, "messages", Map.of("conversationId", group));
        // A file is one message: staff uploads take nothing from the send bucket.
        for (int i = 0; i < 3; i++) request(lawyer, "upload", Map.of("conversationId", group, "name", "f" + i + ".txt", "base64", b64("f")));
    }

    @Test
    void tooFastIsTheStandard429WithTheChatMessage() {
        var response = new com.checkba.config.GlobalExceptionHandler().handleRateLimited(new RateLimitedException(7,
                com.checkba.service.LangText.of("发送太快，请 7 秒后再发", "You're sending too fast; please wait 7 seconds")));
        assertEquals(429, response.getStatusCode().value());
        assertEquals("7", response.getHeaders().getFirst("Retry-After"));
        assertEquals(4290, response.getBody().get("code"));
        assertEquals("RATE_LIMITED", response.getBody().get("reason"));
        assertEquals(7L, response.getBody().get("retryAfterSeconds"));
        assertTrue(String.valueOf(response.getBody().get("message")).contains("7"));
    }

    @Test
    void auditRecordsCarryNoMessageTextCodesOrTokens() {
        var issued = codes.issueClientCode(projectId, lawyer, "合成客户", false);
        Long client = issued.clientUserId();
        String group = id(call(client, "projectGroup", Map.of("projectId", projectId)));
        send(client, group, "secret", "合成机密正文");
        assertDenied(() -> call(client, "list", Map.of()));
        assertFalse(audit.isEmpty());
        for (String record : audit) {
            assertFalse(record.contains("合成机密正文"), record);
            assertFalse(record.contains(issued.code()), record);
        }
    }

    // ---- helpers ----

    @SuppressWarnings("unchecked")
    Map<String, Object> call(Long user, String action, Map<String, Object> p) { return (Map<String, Object>) service.execute(user, action, p); }

    Object request(Long user, String action, Map<String, Object> p) { return service.executeRequest(user, action, p); }

    void send(Long user, String conversation, String key, String text) {
        call(user, "send", Map.of("conversationId", conversation, "clientMessageId", key, "text", text));
    }

    @SuppressWarnings("unchecked")
    List<Map<String, Object>> messages(Long user, String conversation) {
        return (List<Map<String, Object>>) call(user, "messages", Map.of("conversationId", conversation)).get("messages");
    }

    static Map<String, Object> kv(Object... pairs) {
        Map<String, Object> m = new LinkedHashMap<>();
        for (int i = 0; i < pairs.length; i += 2) m.put((String) pairs[i], pairs[i + 1]);
        return m;
    }

    static List<Object> texts(List<Map<String, Object>> rows) { return rows.stream().map(m -> m.get("text")).toList(); }

    static String id(Map<String, Object> view) { return String.valueOf(view.get("id")); }

    static String b64(String s) { return Base64.getEncoder().encodeToString(s.getBytes(StandardCharsets.UTF_8)); }

    static void assertDenied(org.junit.jupiter.api.function.Executable call) { assertThrows(IllegalArgumentException.class, call); }

    static void assertReason(String reason, org.junit.jupiter.api.function.Executable call) {
        ImAccessDeniedException e = assertThrows(ImAccessDeniedException.class, call);
        assertEquals(reason, e.getReason(), e.getMessage());
    }

    static void assertCodeInactive(org.junit.jupiter.api.function.Executable call) {
        IllegalArgumentException e = assertThrows(IllegalArgumentException.class, call);
        assertTrue(e.getMessage().contains("访问码已失效"), e.getMessage());
    }

    Long user(String name, String role) {
        User u = new User(); u.setUsername("portal-test-" + UUID.randomUUID()); u.setPassword("not-a-credential");
        u.setDisplayName(name); u.setRole(role); u.setSubscriptionType("FREE");
        u.setCreatedAt(LocalDateTime.now()); u.setUpdatedAt(LocalDateTime.now());
        return users.saveAndFlush(u).getId();
    }

    long project(String name) {
        Project p = new Project(); p.setName(name); p.setProjectType("TEST"); p.setListedCompanyName("合成公司");
        p.setTargetCompanyName("合成标的"); p.setUserId(lawyer);
        return projects.saveAndFlush(p).getId();
    }

    void addMember(long project, Long user, String role) {
        var m = new com.checkba.model.entity.ProjectMember(); m.setProjectId(project); m.setUserId(user); m.setRole(role);
        projectMembers.saveAndFlush(m);
    }
}
