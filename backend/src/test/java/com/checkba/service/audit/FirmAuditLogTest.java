// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.audit;

import com.checkba.model.entity.AccountBinding;
import com.checkba.model.entity.Project;
import com.checkba.model.entity.User;
import com.checkba.repository.AccountBindingRepository;
import com.checkba.repository.ProjectRepository;
import com.checkba.repository.UserRepository;
import com.checkba.service.UserSessionService;
import com.checkba.service.collab.AccountDirectoryClient;
import com.checkba.service.collab.DirectoryAccount;
import com.checkba.service.collab.DirectoryReply;
import com.checkba.service.collab.OrgMembership;
import com.checkba.service.lawfirm.LawFirmAuthority;
import com.checkba.service.lawfirm.LawFirmCloudService;
import com.checkba.version.cloud.CollabEvent;
import com.checkba.version.cloud.CollabEventService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.TestPropertySource;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.LocalDateTime;
import java.util.*;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;

/**
 * 律所管理员审计日志（S20）端到端：真实的登录签发 / 协作事件 / 律所云端入口 → 异步写入 → 按律所读取。
 * 名录是唯一的替身（官网那一侧），库与服务都是真的。
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@Import({FirmAuditLog.class, LawFirmAuthority.class, LawFirmCloudService.class, UserSessionService.class, CollabEventService.class})
@TestPropertySource(properties = {
        "spring.datasource.url=jdbc:h2:mem:firm-audit;MODE=PostgreSQL;NON_KEYWORDS=VALUE;DB_CLOSE_DELAY=-1",
        "spring.datasource.driver-class-name=org.h2.Driver", "spring.datasource.username=sa", "spring.datasource.password=",
        "spring.jpa.database-platform=org.hibernate.dialect.H2Dialect", "spring.jpa.hibernate.ddl-auto=create-drop",
        "security.local-mode=false"
})
// 事件在事务提交后才入队；测试方法本身不能包在回滚事务里
@Transactional(propagation = Propagation.NOT_SUPPORTED)
class FirmAuditLogTest {

    @Autowired FirmAuditLog audit;
    @Autowired LawFirmCloudService cloud;
    @Autowired UserSessionService sessions;
    @Autowired CollabEventService collab;
    @Autowired UserRepository users;
    @Autowired ProjectRepository projects;
    @Autowired AccountBindingRepository bindings;
    @Autowired JdbcTemplate jdbc;
    @Autowired PlatformTransactionManager tx;
    @MockBean AccountDirectoryClient directory;

    final Map<String, OrgMembership> membership = new HashMap<>();
    String firm, otherFirm;
    Long admin, lawyer, otherAdmin, personal;

    @BeforeEach
    void setUp() {
        firm = "firm-" + UUID.randomUUID();
        otherFirm = "other-" + firm;
        admin = user("管理员", true, firm);
        lawyer = user("律师甲", false, firm);
        otherAdmin = user("别所管理员", true, otherFirm);
        personal = user("个人用户", false, null);
        when(directory.configured()).thenReturn(true);
        when(directory.lookupByAccountId(anyString(), anyString())).thenAnswer(c -> {
            String me = c.getArgument(0), cand = c.getArgument(1);
            return new DirectoryReply(true, new DirectoryAccount(cand, cand, "合成 " + cand, null),
                    membership.getOrDefault(me, OrgMembership.NONE), membership.getOrDefault(cand, OrgMembership.NONE));
        });
    }

    Long user(String name, boolean firmAdmin, String firmId) {
        User u = new User();
        u.setUsername("audit-" + UUID.randomUUID());
        u.setDisplayName(name);
        u.setPassword("synthetic");
        u.setRole("USER");
        u.setSubscriptionType("FREE");
        u.setCreatedAt(LocalDateTime.now());
        u.setUpdatedAt(LocalDateTime.now());
        Long id = users.saveAndFlush(u).getId();
        AccountBinding b = new AccountBinding();
        b.setUserId(id);
        b.setExternalAccountId("account-" + id);
        b.setCreatedAt(LocalDateTime.now());
        bindings.saveAndFlush(b);
        if (firmId != null) membership.put(b.getExternalAccountId(), new OrgMembership("team-" + firmId, firmId, firmAdmin));
        return id;
    }

    Long project(Long owner, String name) {
        Project p = new Project();
        p.setName(name);
        p.setProjectType("LITIGATION");
        p.setListedCompanyName("-");
        p.setTargetCompanyName("-");
        p.setUserId(owner);
        return projects.saveAndFlush(p).getId();
    }

    @SuppressWarnings("unchecked")
    List<Map<String, Object>> events(Long reader, Map<String, Object> filter) {
        audit.flush();
        return (List<Map<String, Object>>) cloud.execute(reader, LawFirmCloudService.AUDIT_LIST, filter).get("events");
    }

    @Test
    void loginIsWrittenAndOnlyThatFirmsAdminCanReadIt() {
        sessions.issue(lawyer);

        List<Map<String, Object>> rows = events(admin, Map.of());
        assertEquals(1, rows.size());
        Map<String, Object> row = rows.get(0);
        assertEquals("LOGIN", row.get("action"));
        assertEquals("AUTH", row.get("category"));
        assertEquals("SUCCESS", row.get("outcome"));
        assertEquals(lawyer.longValue(), ((Number) row.get("actorUserId")).longValue());
        assertEquals("律师甲", row.get("actorName"));

        // 本所普通律师：拒绝（不是空列表）
        IllegalArgumentException denied = assertThrows(IllegalArgumentException.class,
                () -> cloud.execute(lawyer, LawFirmCloudService.AUDIT_LIST, Map.of()));
        assertTrue(denied.getMessage().contains("审计日志") || denied.getMessage().contains("audit log"), denied.getMessage());
        assertThrows(IllegalArgumentException.class, () -> cloud.execute(lawyer, LawFirmCloudService.AUDIT_VERIFY, Map.of()));
        // 别所管理员：看不到本所的行
        assertTrue(events(otherAdmin, Map.of()).isEmpty());
    }

    @Test
    void projectEventsBelongToTheProjectOwnersFirmAndPersonalUsersRecordNothing() {
        Long p = project(lawyer, "甲公司诉乙公司");
        // 别所的人在本所的案卷里加人：归项目所有人的律所
        collab.record(CollabEvent.Kind.MEMBER_ADDED, p, otherAdmin, null, null, null, null, personal, Map.of("role", "READ_ONLY"));
        // 推送不转进律所日志（量大、价值低）
        collab.record(CollabEvent.Kind.PUSH, p, lawyer, null, "a", "b", 1, null, null);
        // 没有律所的个人用户登录：不记
        sessions.issue(personal);
        // 外部客户（无律所）接受了本所律师发的沟通邀请：按邀请人的律所归档
        audit.record(FirmAuditLog.event("CLIENT", "CHAT_INVITE_REDEEMED").actor(personal).firmOf(lawyer));

        List<Map<String, Object>> rows = events(admin, Map.of());
        assertEquals(2, rows.size());
        assertEquals("CHAT_INVITE_REDEEMED", rows.get(0).get("action"));
        assertEquals("个人用户", rows.get(0).get("actorName"));
        Map<String, Object> row = rows.get(1);
        assertEquals("PROJECT_MEMBER_ADDED", row.get("action"));
        assertEquals("甲公司诉乙公司", row.get("projectName"));
        assertEquals("个人用户", row.get("targetLabel"));
        assertEquals(Map.of("role", "READ_ONLY"), row.get("detail"));
        assertTrue(events(otherAdmin, Map.of()).isEmpty(), "the actor's own firm does not get the owner's matter");
    }

    @Test
    void rolledBackActionsLeaveNoTrace() {
        new TransactionTemplate(tx).executeWithoutResult(status -> {
            sessions.issue(lawyer);
            status.setRollbackOnly();
        });
        assertTrue(events(admin, Map.of()).isEmpty());
    }

    @Test
    void aRefusalIsRecordedEvenThoughItsRequestRollsBack() {
        Long p = project(lawyer, "门户客户案卷");
        new TransactionTemplate(tx).executeWithoutResult(status -> {
            audit.recordNow(FirmAuditLog.event("CLIENT", "CLIENT_PORTAL_CHAT_JOINED").failed().actor(personal).project(p)
                    .detail("reason", "CODE_INACTIVE"));
            status.setRollbackOnly();
        });
        List<Map<String, Object>> rows = events(admin, Map.of());
        assertEquals(1, rows.size());
        assertEquals("CLIENT_PORTAL_CHAT_JOINED", rows.get(0).get("action"));
        assertEquals("FAILURE", rows.get(0).get("outcome"));
        assertEquals(Map.of("reason", "CODE_INACTIVE"), rows.get(0).get("detail"));
    }

    @Test
    void anyFailedEventSurvivesItsRollingBackTransactionEvenThroughRecord() {
        // record() 默认等提交；失败/拒绝事件不能依赖提交——被拒的请求往往正是要回滚的那一个
        new TransactionTemplate(tx).executeWithoutResult(status -> {
            audit.record(FirmAuditLog.event("AUTH", "LOGIN_FAILED").failed().actor(lawyer).detail("via", "password"));
            audit.record(FirmAuditLog.event("AUTH", "LOGIN").actor(lawyer));
            status.setRollbackOnly();
        });
        List<Map<String, Object>> rows = events(admin, Map.of());
        assertEquals(List.of("LOGIN_FAILED"), rows.stream().map(r -> r.get("action")).toList(),
                "the refusal is kept, the rolled-back success is not");
    }

    @Test
    void switchChangesAreAuditedAndFiltersApply() {
        sessions.issue(lawyer);
        // 合成一个功能开关不需要：开关读写本身就是 cloud 动作，未登记功能会被拒；这里直接记一次开关事件
        audit.record(FirmAuditLog.event("SETTINGS", "FIRM_CLOUD_SWITCH_CHANGED").actor(admin)
                .target("FIRM_CLOUD_FEATURE", "clients", "clients").detail("enabled", true));

        assertEquals(List.of("FIRM_CLOUD_SWITCH_CHANGED"), events(admin, Map.of("category", "SETTINGS")).stream().map(r -> r.get("action")).toList());
        assertEquals(List.of("LOGIN"), events(admin, Map.of("actor", "律师")).stream().map(r -> r.get("action")).toList());
        assertEquals(2, events(admin, Map.of("from", "2000-01-01", "to", "2999-12-31")).size());
        assertTrue(events(admin, Map.of("to", "2000-01-01")).isEmpty());
        // 分页：limit 1 + beforeId
        @SuppressWarnings("unchecked")
        Map<String, Object> page = cloud.execute(admin, LawFirmCloudService.AUDIT_LIST, Map.of("limit", 1));
        assertEquals(true, page.get("hasMore"));
        assertEquals(1, events(admin, Map.of("beforeId", page.get("nextBeforeId"))).size());
    }

    @Test
    void hashChainVerifiesAndDetectsTampering() {
        sessions.issue(lawyer);
        sessions.issue(admin);
        sessions.issue(lawyer);
        audit.flush();
        Map<String, Object> ok = cloud.execute(admin, LawFirmCloudService.AUDIT_VERIFY, Map.of());
        assertEquals(true, ok.get("ok"));
        assertEquals(3L, ((Number) ok.get("checked")).longValue());

        Long middle = jdbc.queryForObject("select id from firm_audit_event where firm_id = ? order by id offset 1 rows fetch next 1 rows only", Long.class, firm);
        jdbc.update("update firm_audit_event set actor_name = ? where id = ?", "篡改", middle);
        Map<String, Object> broken = cloud.execute(admin, LawFirmCloudService.AUDIT_VERIFY, Map.of());
        assertEquals(false, broken.get("ok"));
        assertEquals(middle.longValue(), ((Number) broken.get("firstBrokenId")).longValue());

        // 删掉一行同样会断链
        jdbc.update("update firm_audit_event set actor_name = ? where id = ?", "管理员", middle);
        assertEquals(true, cloud.execute(admin, LawFirmCloudService.AUDIT_VERIFY, Map.of()).get("ok"));
        jdbc.update("delete from firm_audit_event where id = ?", middle);
        assertEquals(false, cloud.execute(admin, LawFirmCloudService.AUDIT_VERIFY, Map.of()).get("ok"));
    }

    @Test
    void nothingIsRecordedWithoutTheDirectory() {
        when(directory.configured()).thenReturn(false);
        assertFalse(audit.enabled());
        sessions.issue(lawyer);
        audit.flush();
        assertEquals(0, jdbc.queryForObject("select count(*) from firm_audit_event where firm_id = ?", Integer.class, firm));
    }
}
