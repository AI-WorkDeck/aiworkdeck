// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.lawfirm;

import com.checkba.model.entity.*;
import com.checkba.repository.*;
import com.checkba.repository.lawfirm.*;
import com.checkba.service.ProjectMemberService;
import com.checkba.service.collab.*;
import com.checkba.service.messagecenter.MessageCenterService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.TestPropertySource;
import org.springframework.transaction.annotation.*;

import java.time.LocalDateTime;
import java.util.*;
import java.util.concurrent.*;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;

/**
 * 客户管理的律所云端部分：两位律师 + 一位主办合伙人 + 律所管理员 + 另一律所的人。
 * 覆盖默认可见范围、编辑权、过期版本拒绝、上传幂等与合并、律所开关对云端利冲的作用，以及经关系链（多层股权）的全所命中。
 */
@DataJpaTest(showSql = false)
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@TestPropertySource(properties = {"spring.datasource.url=jdbc:h2:mem:lawfirm-cloud-clients;MODE=PostgreSQL;NON_KEYWORDS=VALUE;DB_CLOSE_DELAY=-1;LOCK_TIMEOUT=10000",
        "spring.datasource.driver-class-name=org.h2.Driver", "spring.datasource.username=sa", "spring.datasource.password=",
        "spring.jpa.database-platform=org.hibernate.dialect.H2Dialect", "spring.jpa.hibernate.ddl-auto=create-drop"})
@Import({LawFirmCloudClientService.class, LawFirmWorkflowService.class, LawFirmAuthority.class, LawFirmConflictEngine.class,
        MessageCenterService.class, LawFirmMessageAccessPolicy.class, ObjectMapper.class, LawFirmCloudClientTest.Switch.class})
@Transactional(propagation = Propagation.NOT_SUPPORTED)
@SuppressWarnings("unchecked")
class LawFirmCloudClientTest {
    static final Set<String> ENABLED = ConcurrentHashMap.newKeySet();

    @TestConfiguration
    static class Switch {
        @Bean
        LawFirmCloudClientsSwitch clientsSwitch() {
            return ENABLED::contains;
        }
    }

    @Autowired LawFirmCloudClientService clients;
    @Autowired LawFirmWorkflowService workflow;
    @Autowired LawFirmAuthority authority;
    @Autowired AccountBindingRepository bindings;
    @Autowired UserRepository users;
    @Autowired LawFirmWorkflowClearanceRepository clearances;
    @MockBean AccountDirectoryClient directory;
    @MockBean ProjectMemberService projectPermissions;
    final Map<String, OrgMembership> membership = new ConcurrentHashMap<>();
    Long admin, lawyerA, lawyerB, partner, committee, outsider;
    String firm;

    @BeforeEach
    void setUp() {
        firm = "firm-" + UUID.randomUUID();
        admin = user(true, firm);
        lawyerA = user(false, firm);
        lawyerB = user(false, firm);
        partner = user(false, firm);
        committee = user(false, firm);
        outsider = user(true, "other-" + firm);
        ENABLED.add(firm);
        when(directory.configured()).thenReturn(true);
        when(directory.lookupByAccountId(anyString(), anyString())).thenAnswer(call -> {
            String me = call.getArgument(0), candidate = call.getArgument(1);
            return new DirectoryReply(membership.containsKey(candidate), new DirectoryAccount(candidate, candidate, "合成律师 " + candidate, null),
                    membership.getOrDefault(me, OrgMembership.NONE), membership.getOrDefault(candidate, OrgMembership.NONE));
        });
    }

    Long user(boolean manager, String scope) {
        User user = new User();
        user.setUsername("lawfirm-cloud-" + UUID.randomUUID());
        user.setDisplayName("合成律师");
        user.setPassword("synthetic");
        user.setRole("USER");
        user.setSubscriptionType("FREE");
        user.setCreatedAt(LocalDateTime.now());
        user.setUpdatedAt(LocalDateTime.now());
        Long id = users.saveAndFlush(user).getId();
        AccountBinding b = new AccountBinding();
        b.setUserId(id);
        b.setExternalAccountId("account-" + id);
        b.setCreatedAt(LocalDateTime.now());
        bindings.saveAndFlush(b);
        membership.put(b.getExternalAccountId(), new OrgMembership("team-" + scope, scope, manager));
        return id;
    }

    /** 与律所云端通道一致：先按名录确认身份，再交给处理器。 */
    Map<String, Object> call(Long user, String action, Map<String, Object> p) {
        return clients.execute(authority.current(user), action, p);
    }

    Map<String, Object> client(Map<String, Object> r) {
        return (Map<String, Object>) r.get("client");
    }

    long id(Map<String, Object> m) {
        return ((Number) m.get("id")).longValue();
    }

    long version(Map<String, Object> m) {
        return ((Number) m.get("version")).longValue();
    }

    Map<String, Object> createClient(Long by, String name) {
        Map<String, Object> p = new HashMap<>();
        p.put("name", name);
        p.put("partnerUserId", partner);
        p.put("contacts", List.of(Map.of("name", "王敏", "title", "法务总监", "phone", "010-62000000")));
        p.put("notes", "仅维护人可见的备注");
        return client(call(by, "clients.save", p));
    }

    @Test
    void defaultVisibilityOwnerPartnerAndAdminSeeEverythingOtherLawyersOnlySeeWhoToAsk() {
        Map<String, Object> c = createClient(lawyerA, "星河医疗器械有限公司");
        assertEquals(lawyerA, ((Number) c.get("ownerUserId")).longValue(), "建档人默认是维护人");
        assertEquals(1, ((List<?>) c.get("contacts")).size());

        Map<String, Object> seenByB = client(call(lawyerB, "clients.get", Map.of("partyId", id(c))));
        assertEquals(Boolean.TRUE, seenByB.get("restricted"));
        assertEquals("星河医疗器械有限公司", seenByB.get("name"));
        assertEquals("合成律师 account-" + lawyerA, seenByB.get("ownerName"), "其他律师知道该找谁");
        assertFalse(seenByB.containsKey("contacts"));
        assertFalse(seenByB.containsKey("notes"));
        assertFalse(seenByB.containsKey("relations"));
        assertFalse(seenByB.containsKey("creditCode"));
        Map<String, Object> rowForB = ((List<Map<String, Object>>) call(lawyerB, "clients.list", Map.of()).get("clients")).get(0);
        assertEquals(Boolean.TRUE, rowForB.get("restricted"));
        assertEquals(Boolean.FALSE, rowForB.get("canEdit"));

        for (Long full : List.of(lawyerA, partner, admin)) {
            Map<String, Object> v = client(call(full, "clients.get", Map.of("partyId", id(c))));
            assertEquals(Boolean.FALSE, v.get("restricted"), "维护人、主办合伙人、管理员看完整档案");
            assertEquals("仅维护人可见的备注", v.get("notes"));
        }
        Map<String, Object> edit = new HashMap<>(Map.of("partyId", id(c), "name", "星河医疗器械有限公司", "expectedVersion", version(c)));
        assertThrows(IllegalArgumentException.class, () -> call(lawyerB, "clients.save", edit), "其他律师不能改");
        assertThrows(IllegalArgumentException.class, () -> call(lawyerB, "clients.saveRelation", Map.of("clientId", id(c), "relationType", "AFFILIATE", "partyName", "某公司")));

        assertTrue(((List<?>) call(outsider, "clients.list", Map.of()).get("clients")).isEmpty(), "他所看不到");
        assertThrows(IllegalArgumentException.class, () -> call(outsider, "clients.get", Map.of("partyId", id(c))));
        assertThrows(IllegalArgumentException.class, () -> call(lawyerA, "clients.save",
                new HashMap<>(Map.of("partyId", id(c), "name", "星河医疗器械有限公司", "expectedVersion", version(c), "ownerUserId", outsider))),
                "维护人必须是同所成员");
    }

    @Test
    void staleEditFromAnotherDesktopIsRejectedWithClearMessage() {
        Map<String, Object> c = createClient(lawyerA, "东方航运有限公司");
        long readByA = version(c);
        Map<String, Object> byPartner = client(call(partner, "clients.save",
                new HashMap<>(Map.of("partyId", id(c), "name", "东方航运有限公司", "industry", "航运", "expectedVersion", readByA))));
        assertEquals(readByA + 1, version(byPartner));
        IllegalStateException stale = assertThrows(IllegalStateException.class, () -> call(lawyerA, "clients.save",
                new HashMap<>(Map.of("partyId", id(c), "name", "东方航运有限公司", "industry", "物流", "expectedVersion", readByA))));
        assertEquals(LawFirmCloudClientService.STALE, stale.getMessage());
        assertThrows(IllegalStateException.class, () -> call(lawyerA, "clients.save",
                new HashMap<>(Map.of("partyId", id(c), "name", "东方航运有限公司"))), "不带版本号的修改同样拒绝");
        assertEquals("航运", client(call(lawyerA, "clients.get", Map.of("partyId", id(c)))).get("industry"), "被拒的修改没有写进去");

        Map<String, Object> withRel = client(call(lawyerA, "clients.saveRelation", Map.of("clientId", id(c), "relationType", "SHAREHOLDER",
                "direction", "IN", "partyName", "东方控股有限公司", "sharePercent", "70")));
        Map<String, Object> rel = ((List<Map<String, Object>>) withRel.get("relations")).get(0);
        call(partner, "clients.deleteRelation", Map.of("clientId", id(c), "relationId", rel.get("id"), "expectedVersion", rel.get("version")));
        assertThrows(IllegalArgumentException.class, () -> call(lawyerA, "clients.deleteRelation",
                Map.of("clientId", id(c), "relationId", rel.get("id"), "expectedVersion", rel.get("version"))), "已被同事删掉的关系");
    }

    @Test
    void importIsIdempotentMergesSamePartyAndKeepsExistingOwnership() {
        Map<String, Object> payload = Map.of(
                "parties", List.of(
                        Map.of("localId", "2", "client", true, "name", "华星半导体股份有限公司", "creditCode", "91110108MA001111XX",
                                "contacts", List.of(Map.of("name", "刘一舟"))),
                        Map.of("localId", "8", "client", false, "name", "华星控股集团有限公司"),
                        Map.of("localId", "9", "client", false, "name", "赵立新", "partyType", "INDIVIDUAL")),
                "relations", List.of(
                        Map.of("fromLocalId", "8", "toLocalId", "2", "relationType", "SHAREHOLDER", "shareBps", 6200),
                        Map.of("fromLocalId", "9", "toLocalId", "8", "relationType", "ACTUAL_CONTROLLER")));
        Map<String, Object> first = call(lawyerA, "clients.import", payload);
        assertEquals(3, first.get("created"));
        assertEquals(2, first.get("relationsCreated"));
        Map<String, Object> again = call(lawyerA, "clients.import", payload);
        assertEquals(first.get("mapping"), again.get("mapping"), "重复上传得到同一对应");
        assertEquals(0, again.get("created"));
        assertEquals(0, again.get("relationsCreated"));

        // 另一位律师本机也有这位客户（同信用代码）：并到同一云端客户，维护人不变
        Map<String, Object> fromB = call(lawyerB, "clients.import", Map.of("parties",
                List.of(Map.of("localId", "5", "client", true, "name", "华星半导体（北京）", "creditCode", "91110108ma001111xx"),
                        Map.of("localId", "6", "client", false, "name", "赵立新", "partyType", "INDIVIDUAL"))));
        assertNotEquals(((Map<String, Object>) first.get("mapping")).get("9"), ((Map<String, Object>) fromB.get("mapping")).get("6"),
                "另一位律师登记的同名自然人不并为一人");
        long cloudId = ((Number) ((Map<String, Object>) first.get("mapping")).get("2")).longValue();
        assertEquals(cloudId, ((Number) ((Map<String, Object>) fromB.get("mapping")).get("5")).longValue());
        Map<String, Object> c = client(call(lawyerA, "clients.get", Map.of("partyId", cloudId)));
        assertEquals(lawyerA, ((Number) c.get("ownerUserId")).longValue());
        List<Map<String, Object>> up = (List<Map<String, Object>>) c.get("indirectShareholders");
        assertEquals("赵立新是华星控股集团有限公司的实际控制人；华星控股集团有限公司持有华星半导体股份有限公司 62% 股权", up.get(0).get("path"));
    }

    @Test
    void cloudConflictUsesFirmWidePartiesThroughIndirectShareholdingOnlyWhenEnabled() {
        // 律师甲维护客户「星河医疗」；林海 80% 持股星河控股，星河控股 55% 持股星河医疗
        Map<String, Object> c = createClient(lawyerA, "星河医疗器械有限公司");
        call(lawyerA, "clients.saveRelation", Map.of("clientId", id(c), "relationType", "SHAREHOLDER", "direction", "IN",
                "partyName", "星河控股集团有限公司", "sharePercent", "55"));
        long holdco = ((Number) ((List<Map<String, Object>>) client(call(lawyerA, "clients.get", Map.of("partyId", id(c)))).get("network")).get(0).get("id")).longValue();
        call(lawyerA, "clients.saveRelation", Map.of("clientId", id(c), "subjectPartyId", holdco, "relationType", "SHAREHOLDER",
                "direction", "IN", "partyName", "林海", "partyType", "INDIVIDUAL", "sharePercent", "80"));

        // 律师乙看不到这位客户的档案，但收案预检命中，知道去找谁
        Map<String, Object> pre = call(lawyerB, "clients.conflictSearch", Map.of("clientName", "另一委托人有限公司", "counterpartyName", "林海"));
        assertEquals("YELLOW", pre.get("riskLevel"));
        Map<String, Object> hit = ((List<Map<String, Object>>) pre.get("hits")).get(0);
        assertEquals("Y6_RELATED_TO_FIRM_CLIENT", hit.get("ruleCode"));
        assertEquals("星河医疗器械有限公司", hit.get("clientName"));
        assertEquals("合成律师 account-" + lawyerA, hit.get("ownerName"));
        assertEquals("林海持有星河控股集团有限公司 80% 股权；星河控股集团有限公司持有星河医疗器械有限公司 55% 股权", hit.get("relationPath"));

        // 正式云端提交：开关开着 → 征询发给客户维护人，关系链只在其本人私密摘要里
        var a = workflow.execute(admin, "workflowAppoint", Map.of("userId", committee));
        workflow.execute(committee, "workflowAppointmentDecision", Map.of("recordId", a.get("id"), "expectedVersion", a.get("version"), "decision", "ACCEPTED"));
        Map<String, Object> on = workflow.execute(lawyerB, "workflowSubmit", submission("对抗林海的股权纠纷"));
        assertEquals("PENDING_LAWYER_CLEARANCE", on.get("status"));
        var cl = clearances.findByWorkflowId((String) on.get("id"));
        assertEquals(1, cl.size());
        assertEquals(lawyerA, cl.get(0).getTargetId());
        assertTrue(cl.get(0).getPrivateSummary().contains("关系链：林海持有星河控股集团有限公司 80% 股权"));
        Map<String, Object> applicantView = (Map<String, Object>) ((List<?>) on.get("clearances")).get(0);
        assertFalse(String.valueOf(applicantView.get("summary")).contains("星河"), "申请人看不到客户名与关系链");

        // 律所管理员关掉开关：云端利冲不再使用主体数据
        ENABLED.remove(firm);
        Map<String, Object> off = workflow.execute(lawyerB, "workflowSubmit", submission("开关关闭后的同类新案"));
        assertEquals("PENDING_COMMITTEE_REVIEW", off.get("status"));
    }

    Map<String, Object> submission(String title) {
        return new HashMap<>(Map.of("requestId", UUID.randomUUID().toString(), "title", title, "clientName", "另一委托人有限公司",
                "counterpartyName", "林海", "leadId", lawyerB, "committeeId", committee));
    }
}
