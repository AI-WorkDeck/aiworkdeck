// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.lawfirm;

import com.checkba.model.entity.ImConversation;
import com.checkba.model.entity.Project;
import com.checkba.model.entity.ProjectTask;
import com.checkba.model.entity.User;
import com.checkba.model.entity.UserActivityLog;
import com.checkba.model.entity.lawfirm.LawFirmParty;
import com.checkba.model.entity.lawfirm.LawFirmCollection;
import com.checkba.model.entity.lawfirm.LawFirmInvoice;
import com.checkba.model.entity.lawfirm.LawFirmMatterIntake;
import com.checkba.repository.ImConversationRepository;
import com.checkba.repository.ProjectRepository;
import com.checkba.repository.ProjectTaskRepository;
import com.checkba.repository.UserActivityLogRepository;
import com.checkba.repository.UserRepository;
import com.checkba.repository.lawfirm.LawFirmPartyRelationRepository;
import com.checkba.repository.lawfirm.LawFirmPartyRepository;
import com.checkba.repository.lawfirm.LawFirmCollectionRepository;
import com.checkba.repository.lawfirm.LawFirmInvoiceRepository;
import com.checkba.repository.lawfirm.LawFirmMatterIntakeRepository;
import com.checkba.service.ai.PluginService;
import com.checkba.service.im.ImService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.TestPropertySource;

import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;

/** 客户档案：与收案、利冲共用主体数据；旧收案归集；按客户统计收入/应收；「最近往来」取真实信号。 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@Import({LawFirmManagementService.class, LawFirmClientService.class, LawFirmConflictEngine.class, ImService.class, ObjectMapper.class})
@TestPropertySource(properties = {
        "spring.datasource.url=jdbc:h2:mem:lawfirm-client-test;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DEFAULT_NULL_ORDERING=HIGH;NON_KEYWORDS=VALUE;DB_CLOSE_DELAY=-1",
        "spring.datasource.driver-class-name=org.h2.Driver",
        "spring.datasource.username=sa",
        "spring.datasource.password=",
        "spring.jpa.database-platform=org.hibernate.dialect.H2Dialect",
        "spring.jpa.hibernate.ddl-auto=create-drop",
        "security.local-mode=false"
})
@SuppressWarnings("unchecked")
class LawFirmClientTest {

    @Autowired private LawFirmManagementService service;
    @Autowired private LawFirmPartyRepository parties;
    @Autowired private LawFirmPartyRelationRepository relations;
    @Autowired private LawFirmMatterIntakeRepository intakes;
    @Autowired private LawFirmInvoiceRepository invoices;
    @Autowired private LawFirmCollectionRepository collections;
    @Autowired private ProjectRepository projects;
    @Autowired private UserRepository users;
    @Autowired private UserActivityLogRepository activity;
    @Autowired private ImConversationRepository conversations;
    @Autowired private ProjectTaskRepository tasks;

    @MockBean private PluginService pluginService;
    @MockBean private LawFirmAccessPolicy accessPolicy;

    private User partner;
    private User associate;

    @BeforeEach
    void setUp() {
        org.springframework.test.util.AopTestUtils.<LawFirmManagementService>getUltimateTargetObject(service).ledgerAvailable = true;
        when(accessPolicy.canViewFirmWide(any())).thenReturn(true);
        partner = user("client_partner", "陈思远");
        associate = user("client_associate", "许嘉宁");
    }

    private User user(String username, String name) {
        User u = new User();
        u.setUsername(username + UUID.randomUUID().toString().substring(0, 6));
        u.setDisplayName(name);
        u.setPassword("{noop}pw123456");
        u.setRole("USER");
        u.setSubscriptionType("PAID");
        u.setCreatedAt(LocalDateTime.now());
        u.setUpdatedAt(LocalDateTime.now());
        return users.saveAndFlush(u);
    }

    private LawFirmMatterIntake legacyIntake(String no, String client, String code, String counterparty, String status, Long lead) {
        Instant now = Instant.now();
        return intakes.saveAndFlush(LawFirmMatterIntake.builder()
                .intakeNo(no).title(client + "专项").clientName(client).clientCreditCode(code)
                .counterpartyName(counterparty).relatedPartiesJson("[]").status(status)
                .applicantUserId(lead).leadLawyerUserId(lead).leadLawyerName("陈思远")
                .contractAmountCents(1_000_000L).practiceArea("COMMERCIAL_LITIGATION").feeMode("FIXED")
                .submittedAt(now).createdAt(now).updatedAt(now).build());
    }

    private Map<String, Object> run(Long userId, String action, Map<String, Object> params) {
        return service.execute(userId, null, action, params);
    }

    private List<Map<String, Object>> listRows(Long userId) {
        return (List<Map<String, Object>>) run(userId, "listClients", Map.of()).get("clients");
    }

    @Test
    @DisplayName("旧收案归集为客户档案：同一信用代码或同一规范化全称合并，不留孤儿，可重复执行")
    void backfillLegacyIntakes() {
        LawFirmMatterIntake a = legacyIntake("LF-T-1", "华星半导体（集团）有限公司", "", "甲公司", "APPROVED_FILED", partner.getId());
        LawFirmMatterIntake b = legacyIntake("LF-T-2", "华星半导体 (集团)有限公司", "", "乙公司", "CLOSED", partner.getId());
        LawFirmMatterIntake c = legacyIntake("LF-T-3", "蓝海光电科技有限公司", "91320500MA002222YY", "丙公司", "APPROVED_FILED", partner.getId());
        LawFirmMatterIntake d = legacyIntake("LF-T-4", "蓝海光电（苏州）科技有限公司", "91320500ma002222yy", "丁公司", "APPROVED_FILED", partner.getId());

        run(partner.getId(), "listClients", Map.of());
        assertEquals(2, parties.countByClientTrue(), "同名（括号/空白不同）与同信用代码各归一个客户");
        Long huaxing = intakes.findById(a.getId()).orElseThrow().getClientId();
        assertNotNull(huaxing);
        assertEquals(huaxing, intakes.findById(b.getId()).orElseThrow().getClientId());
        assertEquals(intakes.findById(c.getId()).orElseThrow().getClientId(), intakes.findById(d.getId()).orElseThrow().getClientId());
        LawFirmParty hx = parties.findById(huaxing).orElseThrow();
        assertEquals("INTAKE", hx.getSource());
        assertEquals(partner.getId(), hx.getOwnerUserId(), "旧收案归集的客户由主办律师维护");
        assertTrue(hx.getClientNo().startsWith("KH-"));

        run(partner.getId(), "listClients", Map.of());
        assertEquals(2, parties.countByClientTrue(), "再次执行不重复建档");

        Map<String, Object> overview = run(partner.getId(), "overview", Map.of());
        List<Map<String, Object>> rows = (List<Map<String, Object>>) overview.get("intakes");
        assertTrue(rows.stream().allMatch(r -> r.get("clientId") != null), "收案视图带 clientId，供按客户查账");
        Map<String, Object> byIntake = (Map<String, Object>) run(partner.getId(), "getClient", Map.of("intakeId", a.getId())).get("client");
        assertEquals(huaxing, byIntake.get("id"), "可按收案反查客户");
    }

    @Test
    @DisplayName("收案选已有客户：名称与信用代码以档案为准，不新建客户；只填名称也挂到已有客户；新名称才建档")
    void intakePicksExistingClient() {
        Map<String, Object> saved = (Map<String, Object>) run(partner.getId(), "saveClient", Map.of(
                "name", "北辰新材料股份有限公司", "creditCode", "91110000MA00ABCD12",
                "ownerUserId", associate.getId(), "partnerUserId", partner.getId())).get("client");
        Long clientId = ((Number) saved.get("id")).longValue();
        assertEquals("许嘉宁", saved.get("ownerName"));
        assertEquals("陈思远", saved.get("partnerName"));

        Map<String, Object> res = run(partner.getId(), "submitIntake", Map.of(
                "clientId", clientId, "clientName", "表单上残留的旧名称", "counterpartyName", "无关公司甲", "title", "北辰并购"));
        Map<String, Object> intake = (Map<String, Object>) res.get("intake");
        assertEquals(clientId, ((Number) intake.get("clientId")).longValue());
        assertEquals("北辰新材料股份有限公司", intake.get("clientName"));
        assertEquals("91110000MA00ABCD12", intake.get("clientCreditCode"));

        Map<String, Object> res2 = run(partner.getId(), "submitIntake", Map.of(
                "clientName", " 北辰新材料股份有限公司 ", "counterpartyName", "无关公司乙", "title", "北辰诉讼"));
        assertEquals(clientId, ((Number) ((Map<String, Object>) res2.get("intake")).get("clientId")).longValue());
        assertEquals(1, parties.countByClientTrue());

        run(partner.getId(), "submitIntake", Map.of("clientName", "全新客户有限公司", "counterpartyName", "无关公司丙", "title", "新案"));
        assertEquals(2, parties.countByClientTrue());

        IllegalArgumentException dup = assertThrows(IllegalArgumentException.class, () ->
                run(partner.getId(), "saveClient", Map.of("name", "北辰新材料股份有限公司")));
        assertTrue(dup.getMessage().contains("KH-"));
    }

    @Test
    @DisplayName("利冲共用客户主体：对方是登记客户的实际控制人命中 Y6（带关系链），对方就是客户命中 Y5，交客户维护人放行")
    void conflictHitsRegisteredClientController() {
        Long clientId = ((Number) ((Map<String, Object>) run(partner.getId(), "saveClient", Map.of(
                "name", "远航物流有限公司", "ownerUserId", associate.getId())).get("client")).get("id")).longValue();
        run(partner.getId(), "saveRelation", Map.of("clientId", clientId, "relationType", "ACTUAL_CONTROLLER",
                "direction", "IN", "partyName", "周启明", "partyType", "INDIVIDUAL"));

        Map<String, Object> pre = run(partner.getId(), "precheckConflict", Map.of(
                "clientName", "某贸易有限公司", "counterpartyName", "周启明", "title", "合同纠纷"));
        assertEquals("YELLOW", pre.get("riskLevel"));
        List<LawFirmConflictEngine.ConflictHit> hits = (List<LawFirmConflictEngine.ConflictHit>) pre.get("hits");
        LawFirmConflictEngine.ConflictHit hit = hits.get(0);
        assertEquals("Y6_RELATED_TO_FIRM_CLIENT", hit.getRuleCode());
        assertEquals(clientId, hit.getMatchedClientId());
        assertEquals(associate.getId(), hit.getHandlerUserId());
        assertEquals("周启明是远航物流有限公司的实际控制人", hit.getRelationPath());

        // 正式提交：征询发给客户维护人；客户档案的利冲记录能看到这笔对抗收案
        Map<String, Object> sub = run(partner.getId(), "submitIntake", Map.of(
                "clientName", "某贸易有限公司", "counterpartyName", "远航物流有限公司", "title", "对抗远航"));
        assertEquals("PENDING_LAWYER_CLEARANCE", ((Map<String, Object>) sub.get("intake")).get("status"));
        assertEquals("Y5_REGISTERED_CLIENT_ADVERSE", ((List<LawFirmConflictEngine.ConflictHit>) sub.get("hits")).get(0).getRuleCode());
        Map<String, Object> profile = (Map<String, Object>) run(partner.getId(), "getClient", Map.of("clientId", clientId)).get("client");
        List<Map<String, Object>> conflicts = (List<Map<String, Object>>) profile.get("conflicts");
        assertTrue(conflicts.stream().anyMatch(c -> "AGAINST".equals(c.get("kind")) && "对抗远航".equals(c.get("title"))));
    }

    @Test
    @DisplayName("多层股权：对方当事人是客户的间接股东，命中 Y6 并给出股权链；收案登记的控股股东转为关系")
    void conflictThroughIndirectShareholder() {
        LawFirmMatterIntake ex = intakes.saveAndFlush(LawFirmMatterIntake.builder()
                .intakeNo("LF-T-9").title("星河医疗专项").clientName("星河医疗器械有限公司").counterpartyName("某医院")
                .relatedPartiesJson("[{\"role\":\"CONTROLLING_SHAREHOLDER\",\"name\":\"星河控股集团有限公司\"}]")
                .status("APPROVED_FILED").applicantUserId(partner.getId()).leadLawyerUserId(partner.getId())
                .createdAt(Instant.now()).submittedAt(Instant.now()).build());
        run(partner.getId(), "listClients", Map.of());
        Long clientId = intakes.findById(ex.getId()).orElseThrow().getClientId();
        assertEquals(1, relations.count(), "收案上的控股股东转成主体关系");
        Map<String, Object> profile = (Map<String, Object>) run(partner.getId(), "getClient", Map.of("clientId", clientId)).get("client");
        Long holdco = ((Number) ((List<Map<String, Object>>) profile.get("relations")).get(0).get("partyId")).longValue();
        assertEquals("IN", ((List<Map<String, Object>>) profile.get("relations")).get(0).get("direction"));

        // 在星河医疗的档案里直接给关系网中的星河控股补上层股东（不必把星河控股升为客户）
        run(partner.getId(), "saveRelation", Map.of("clientId", clientId, "subjectPartyId", holdco, "relationType", "SHAREHOLDER",
                "direction", "IN", "partyName", "林海", "partyType", "INDIVIDUAL", "sharePercent", "80"));
        assertEquals(1, parties.countByClientTrue());
        Long stranger = ((Number) ((Map<String, Object>) run(partner.getId(), "saveClient", Map.of("name", "无关客户有限公司")).get("client")).get("id")).longValue();
        assertThrows(IllegalArgumentException.class, () -> run(partner.getId(), "saveRelation", Map.of("clientId", clientId,
                "subjectPartyId", stranger, "relationType", "AFFILIATE", "partyName", "某公司")), "关系网之外的主体不能借本客户档案登记");
        run(partner.getId(), "saveRelation", Map.of("clientId", clientId, "relationType", "SHAREHOLDER", "direction", "IN",
                "partyId", holdco, "sharePercent", "55"));

        profile = (Map<String, Object>) run(partner.getId(), "getClient", Map.of("clientId", clientId)).get("client");
        List<Map<String, Object>> indirect = (List<Map<String, Object>>) profile.get("indirectShareholders");
        assertEquals(1, indirect.size());
        assertEquals("林海", indirect.get(0).get("partyName"));
        assertEquals(4400, indirect.get(0).get("effectiveBps"), "80% × 55% = 44%");
        List<Map<String, Object>> rels = (List<Map<String, Object>>) profile.get("relations");
        assertEquals(1, rels.stream().filter(r -> !"NETWORK".equals(r.get("direction"))).count(), "同一对主体同类型关系更新而不是重复");
        assertEquals("林海持有星河控股集团有限公司 80% 股权",
                rels.stream().filter(r -> "NETWORK".equals(r.get("direction"))).findFirst().orElseThrow().get("description"),
                "关系网内补登的上层关系也列在档案里");

        Map<String, Object> pre = run(associate.getId(), "precheckConflict", Map.of(
                "clientName", "另一委托人有限公司", "counterpartyName", "林海"));
        List<LawFirmConflictEngine.ConflictHit> hits = (List<LawFirmConflictEngine.ConflictHit>) pre.get("hits");
        LawFirmConflictEngine.ConflictHit viaChain = hits.stream().filter(h -> clientId.equals(h.getMatchedClientId())).findFirst().orElseThrow();
        assertEquals("Y6_RELATED_TO_FIRM_CLIENT", viaChain.getRuleCode());
        assertEquals("林海持有星河控股集团有限公司 80% 股权；星河控股集团有限公司持有星河医疗器械有限公司 55% 股权", viaChain.getRelationPath());
    }

    @Test
    @DisplayName("委托人一侧：新委托人的子公司是在办案件对方当事人，命中 Y7 并交该案主办律师")
    void newClientRelatedToAdverseParty() {
        legacyIntake("LF-T-7", "甲方客户有限公司", "", "乙子公司有限公司", "APPROVED_FILED", associate.getId());
        Long newClient = ((Number) ((Map<String, Object>) run(partner.getId(), "saveClient", Map.of("name", "乙集团有限公司")).get("client")).get("id")).longValue();
        run(partner.getId(), "saveRelation", Map.of("clientId", newClient, "relationType", "SHAREHOLDER", "direction", "OUT",
                "partyName", "乙子公司有限公司", "sharePercent", "100"));

        Map<String, Object> pre = run(partner.getId(), "precheckConflict", Map.of(
                "clientId", newClient, "counterpartyName", "无关第三方有限公司", "title", "乙集团常年顾问"));
        List<LawFirmConflictEngine.ConflictHit> hits = (List<LawFirmConflictEngine.ConflictHit>) pre.get("hits");
        assertEquals(1, hits.size());
        assertEquals("Y7_CLIENT_RELATED_TO_ADVERSE_PARTY", hits.get(0).getRuleCode());
        assertEquals(associate.getId(), hits.get(0).getHandlerUserId());
        assertEquals("乙集团有限公司持有乙子公司有限公司 100% 股权", hits.get(0).getRelationPath());

        IllegalArgumentException self = assertThrows(IllegalArgumentException.class, () -> run(partner.getId(), "saveRelation",
                Map.of("clientId", newClient, "relationType", "AFFILIATE", "partyId", newClient)));
        assertNotNull(self.getMessage());
        assertThrows(IllegalArgumentException.class, () -> run(partner.getId(), "saveRelation", Map.of(
                "clientId", newClient, "relationType", "SHAREHOLDER", "partyName", "某股东", "sharePercent", "120")));
    }

    @Test
    @DisplayName("按客户统计：今年实收、应收（已开票-已收，作废与待审不计）、在办项目")
    void revenueAndReceivablesByClient() {
        LawFirmMatterIntake m1 = legacyIntake("LF-R-1", "东方航运有限公司", "", "X", "APPROVED_FILED", partner.getId());
        LawFirmMatterIntake m2 = legacyIntake("LF-R-2", "东方航运有限公司", "", "Y", "CLOSED", partner.getId());
        Instant now = Instant.now();
        LawFirmInvoice inv = invoices.saveAndFlush(LawFirmInvoice.builder().invoiceAppNo("INV-R-1").intakeId(m1.getId())
                .amountCents(500_000L).collectedAmountCents(200_000L).status("ISSUED").issuedAt(now).createdAt(now).build());
        invoices.saveAndFlush(LawFirmInvoice.builder().invoiceAppNo("INV-R-2").intakeId(m2.getId())
                .amountCents(900_000L).status("VOIDED").createdAt(now).build());
        invoices.saveAndFlush(LawFirmInvoice.builder().invoiceAppNo("INV-R-3").intakeId(m2.getId())
                .amountCents(300_000L).status("PENDING_APPROVAL").createdAt(now).build());
        collections.saveAndFlush(LawFirmCollection.builder().collectionNo("COL-R-1").invoiceId(inv.getId())
                .amountCents(200_000L).receivedDate(LocalDate.now().toString()).createdAt(now).build());
        collections.saveAndFlush(LawFirmCollection.builder().collectionNo("COL-R-2").intakeId(m2.getId())
                .amountCents(70_000L).receivedDate(LocalDate.now().getYear() - 1 + "-12-30").createdAt(now).build());

        Map<String, Object> row = listRows(partner.getId()).get(0);
        assertEquals("东方航运有限公司", row.get("name"));
        assertEquals(2L, row.get("matterCount"));
        assertEquals(1L, row.get("activeMatterCount"));
        assertEquals(500_000L, row.get("billedCents"));
        assertEquals(270_000L, row.get("collectedCents"));
        assertEquals(200_000L, row.get("collectedThisYearCents"), "去年到账不计入今年");
        assertEquals(230_000L, row.get("arCents"));
    }

    @Test
    @DisplayName("最近往来取真实信号：工作记录、项目群消息、会议日程、手动登记，取最新并标来源")
    void lastInteractionFromRealSignals() {
        Project p = new Project();
        p.setName("南湖地产债务重组");
        p.setProjectType("GENERAL");
        p.setListedCompanyName("南湖地产有限公司");
        p.setTargetCompanyName("-");
        p.setUserId(partner.getId());
        p = projects.saveAndFlush(p);
        LawFirmMatterIntake m = legacyIntake("LF-S-1", "南湖地产有限公司", "", "Z", "APPROVED_FILED", partner.getId());
        m.setProjectId(p.getId());
        m.setSubmittedAt(Instant.now().minus(200, ChronoUnit.DAYS));
        intakes.saveAndFlush(m);

        Map<String, Object> row = listRows(partner.getId()).get(0);
        assertEquals("INTAKE", row.get("lastInteractionSource"));
        assertEquals(200, row.get("lastInteractionDays"));

        UserActivityLog log = new UserActivityLog();
        log.setUserId(partner.getId());
        log.setActionType("OPEN_FILE");
        log.setProjectId(p.getId());
        activity.saveAndFlush(log);
        log.setTimestamp(LocalDateTime.now().minusDays(40));
        activity.saveAndFlush(log);
        row = listRows(partner.getId()).get(0);
        assertEquals("WORK_LOG", row.get("lastInteractionSource"));
        assertEquals(40, row.get("lastInteractionDays"));

        ImConversation conv = new ImConversation();
        conv.setId(UUID.randomUUID().toString());
        conv.setTitle("项目群");
        conv.setType("PROJECT");
        conv.setOwnerId(partner.getId());
        conv.setCreatedAt(Instant.now().minus(60, ChronoUnit.DAYS));
        conv.setLastMessageAt(Instant.now().minus(20, ChronoUnit.DAYS));
        conv.setProjectId(p.getId());
        conversations.saveAndFlush(conv);

        ProjectTask meeting = new ProjectTask();
        meeting.setUid(UUID.randomUUID().toString());
        meeting.setProjectId(p.getId());
        meeting.setTitle("与客户财务总监会谈");
        meeting.setDueDate(LocalDate.now().minusDays(10));
        meeting.setStatus("DONE");
        meeting.setSource("USER");
        meeting.setType("MEETING");
        meeting.setUserId(partner.getId());
        tasks.saveAndFlush(meeting);
        ProjectTask future = new ProjectTask();
        future.setUid(UUID.randomUUID().toString());
        future.setProjectId(p.getId());
        future.setTitle("下月开庭");
        future.setDueDate(LocalDate.now().plusDays(30));
        future.setStatus("OPEN");
        future.setSource("USER");
        future.setType("HEARING");
        future.setUserId(partner.getId());
        tasks.saveAndFlush(future);

        row = listRows(partner.getId()).get(0);
        assertEquals("CALENDAR", row.get("lastInteractionSource"), "未来日程不算往来");
        assertEquals(10, row.get("lastInteractionDays"));

        Long clientId = ((Number) row.get("id")).longValue();
        Map<String, Object> profile = (Map<String, Object>) run(associate.getId(), "logClientContact", Map.of(
                "clientId", clientId, "date", LocalDate.now().minusDays(2).toString(), "channel", "CALL", "note", "沟通回款安排")).get("client");
        assertEquals("MANUAL", profile.get("lastInteractionSource"));
        assertEquals(2, profile.get("lastInteractionDays"));
        List<Map<String, Object>> signals = (List<Map<String, Object>>) profile.get("signals");
        assertEquals(List.of("MANUAL", "CALENDAR", "IM", "WORK_LOG", "INTAKE"), signals.stream().map(s -> s.get("source")).toList());

        assertThrows(IllegalArgumentException.class, () -> run(partner.getId(), "logClientContact", Map.of(
                "clientId", clientId, "date", LocalDate.now().plusDays(1).toString())));

        Map<String, Object> stale = run(partner.getId(), "listClients", Map.of("staleDays", 30));
        assertTrue(((List<?>) stale.get("clients")).isEmpty(), "2 天前联系过，不在「超过 30 天无往来」里");
    }

    @Test
    @DisplayName("无全所资格：只看到自己维护/主办/经手的客户；看不到别人的客户档案，也不能改")
    void restrictedUsersSeeOnlyTheirClients() {
        when(accessPolicy.canViewFirmWide(eq(associate.getId()))).thenReturn(false);
        Long mine = ((Number) ((Map<String, Object>) run(partner.getId(), "saveClient", Map.of(
                "name", "维护人是许律师的客户有限公司", "ownerUserId", associate.getId())).get("client")).get("id")).longValue();
        Long other = ((Number) ((Map<String, Object>) run(partner.getId(), "saveClient", Map.of(
                "name", "别人的客户有限公司", "ownerUserId", partner.getId())).get("client")).get("id")).longValue();

        Map<String, Object> list = run(associate.getId(), "listClients", Map.of());
        assertEquals(Boolean.TRUE, list.get("restricted"));
        List<Map<String, Object>> rows = (List<Map<String, Object>>) list.get("clients");
        assertEquals(List.of(mine), rows.stream().map(r -> ((Number) r.get("id")).longValue()).toList());
        assertThrows(IllegalArgumentException.class, () -> run(associate.getId(), "getClient", Map.of("clientId", other)));
        assertThrows(IllegalArgumentException.class, () -> run(associate.getId(), "logClientContact", Map.of("clientId", other)));
        assertThrows(IllegalStateException.class, () -> run(associate.getId(), "saveClient", Map.of("clientId", other, "name", "改名")));
        assertThrows(IllegalArgumentException.class, () -> run(associate.getId(), "submitIntake", Map.of(
                "clientId", other, "title", "借别人客户收案", "counterpartyName", "某方")));
    }

    @Test
    @DisplayName("复核修正：同名自然人不合并；被驳回的潜在客户不算本所客户；按名称关联到看不到的客户被拒；升为客户时建档人改为升级者")
    void reviewFixes() {
        Long a = ((Number) ((Map<String, Object>) run(partner.getId(), "saveClient", Map.of("name", "甲客户有限公司")).get("client")).get("id")).longValue();
        run(partner.getId(), "saveRelation", Map.of("clientId", a, "relationType", "SPOUSE", "partyName", "张伟", "partyType", "INDIVIDUAL"));
        Long b = ((Number) ((Map<String, Object>) run(partner.getId(), "saveClient", Map.of("name", "乙客户有限公司")).get("client")).get("id")).longValue();
        run(partner.getId(), "saveRelation", Map.of("clientId", b, "relationType", "FAMILY", "partyName", "张伟", "partyType", "INDIVIDUAL"));
        assertEquals(2, parties.findAllByOrderByIdAsc().stream().filter(p -> "张伟".equals(p.getName())).count(), "同名自然人各自成档");

        LawFirmMatterIntake declined = legacyIntake("LF-D-1", "被拒潜在客户有限公司", "", "某方", "REJECTED_CONFLICT", partner.getId());
        run(partner.getId(), "listClients", Map.of());
        assertNotNull(intakes.findById(declined.getId()).orElseThrow().getClientId());
        Map<String, Object> pre = run(partner.getId(), "precheckConflict", Map.of("clientName", "新委托人有限公司", "counterpartyName", "被拒潜在客户有限公司"));
        assertEquals("GREEN", pre.get("riskLevel"), "名下收案全部被驳回的潜在客户不触发 Y5");

        when(accessPolicy.canViewFirmWide(eq(associate.getId()))).thenReturn(false);
        Long mine = ((Number) ((Map<String, Object>) run(associate.getId(), "saveClient", Map.of("name", "许律师的客户有限公司", "ownerUserId", associate.getId())).get("client")).get("id")).longValue();
        IllegalArgumentException hidden = assertThrows(IllegalArgumentException.class, () -> run(associate.getId(), "saveRelation",
                Map.of("clientId", mine, "relationType", "AFFILIATE", "partyName", "甲客户有限公司")));
        assertFalse(hidden.getMessage().contains("KH-"));
        IllegalArgumentException dup = assertThrows(IllegalArgumentException.class, () -> run(associate.getId(), "saveClient", Map.of("name", "乙客户有限公司")));
        assertFalse(dup.getMessage().contains("乙客户"), "看不到的客户不在重名提示里露出");

        // 许律师把「丙公司」登记为自己客户的关联方；之后由陈律师建为客户，许律师不因此取得该客户
        run(associate.getId(), "saveRelation", Map.of("clientId", mine, "relationType", "AFFILIATE", "partyName", "丙公司有限公司"));
        Long c = ((Number) ((Map<String, Object>) run(partner.getId(), "saveClient", Map.of("name", "丙公司有限公司", "ownerUserId", partner.getId())).get("client")).get("id")).longValue();
        assertEquals(partner.getId(), parties.findById(c).orElseThrow().getCreatedByUserId());
        assertThrows(IllegalStateException.class, () -> run(associate.getId(), "saveClient", Map.of("clientId", c, "name", "丙公司有限公司")));
    }
}
