// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.lawfirm;

import com.checkba.model.entity.Project;
import com.checkba.model.entity.User;
import com.checkba.model.entity.UserActivityLog;
import com.checkba.model.entity.lawfirm.LawFirmInvoice;
import com.checkba.model.entity.lawfirm.LawFirmMatterIntake;
import com.checkba.model.entity.lawfirm.LawFirmTimeEntry;
import com.checkba.repository.ProjectRepository;
import com.checkba.repository.UserActivityLogRepository;
import com.checkba.repository.UserRepository;
import com.checkba.repository.lawfirm.LawFirmInvoiceRepository;
import com.checkba.repository.lawfirm.LawFirmMatterIntakeRepository;
import com.checkba.repository.lawfirm.LawFirmTimeEntryAuditRepository;
import com.checkba.repository.lawfirm.LawFirmTimeEntryRepository;
import com.checkba.service.ai.PluginService;
import com.checkba.service.im.ImService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentMatchers;
import org.mockito.Mockito;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.TestPropertySource;

import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * 计时收费全链路：工作记录 → 草稿工时 → 律师补录/提交 → 合伙人核减、改描述、不收费、通过（留痕）→
 * 账单（约定费率、折扣、封顶）→ 客户确认生成原台账发票申请 → 原台账核销回款 → 律师实现率。
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@Import({LawFirmManagementService.class, LawFirmBillingService.class, LawFirmConflictEngine.class, ImService.class, ObjectMapper.class})
@TestPropertySource(properties = {
        "spring.datasource.url=jdbc:h2:mem:lawfirm-billing-flow-test;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DEFAULT_NULL_ORDERING=HIGH;NON_KEYWORDS=VALUE;DB_CLOSE_DELAY=-1",
        "spring.datasource.driver-class-name=org.h2.Driver",
        "spring.datasource.username=sa",
        "spring.datasource.password=",
        "spring.jpa.database-platform=org.hibernate.dialect.H2Dialect",
        "spring.jpa.hibernate.ddl-auto=create-drop",
        "security.local-mode=false"
})
class LawFirmBillingFlowTest {

    @Autowired LawFirmBillingService billing;
    @Autowired LawFirmManagementService ledger;
    @Autowired UserRepository users;
    @Autowired ProjectRepository projects;
    @Autowired UserActivityLogRepository activity;
    @Autowired LawFirmMatterIntakeRepository intakes;
    @Autowired LawFirmTimeEntryRepository entries;
    @Autowired LawFirmTimeEntryAuditRepository audits;
    @Autowired LawFirmInvoiceRepository invoices;

    @MockBean PluginService pluginService;
    @MockBean LawFirmAccessPolicy access;

    User partner, associate, senior;
    Project matterProject, otherProject;
    LawFirmMatterIntake intake;
    final LocalDate today = LocalDate.now();

    @BeforeEach
    void setUp() {
        org.springframework.test.util.AopTestUtils.<LawFirmManagementService>getUltimateTargetObject(ledger).ledgerAvailable = true;
        partner = user("bill_partner", "林合伙人");
        associate = user("bill_associate", "陈律师");
        senior = user("bill_senior", "周律师");
        Mockito.when(access.canViewFirmWide(partner.getId())).thenReturn(true);
        Mockito.doThrow(new IllegalArgumentException("not firm admin")).when(access)
                .requireFirmWide(ArgumentMatchers.argThat(id -> !partner.getId().equals(id)));
        matterProject = project("甲公司专项", associate.getId());
        otherProject = project("未立案项目", associate.getId());
        intake = intakes.save(LawFirmMatterIntake.builder().intakeNo("T-" + System.nanoTime()).title("甲公司数据合规专项")
                .projectId(matterProject.getId()).clientName("甲公司（虚构）").clientCreditCode("91110000MA00TEST01")
                .leadLawyerUserId(partner.getId()).leadLawyerName("林合伙人").teamMemberNames("陈律师、周律师").feeMode("HOURLY").status("APPROVED_FILED")
                .createdAt(Instant.now()).updatedAt(Instant.now()).build());
    }

    @Test
    void workRecordsToBillToInvoiceToRealization() {
        // 工作记录：同项目同日两段文件会话 25+20 分钟 → 45 分钟 → 48 分钟；AI 工具耗时与无项目记录不算；30 秒的不生成
        log(associate, matterProject, "OPEN_FILE", "尽调清单.xlsx", 25 * 60_000L);
        log(associate, matterProject, "OPEN_FILE", "数据处理协议.docx", 20 * 60_000L);
        log(associate, matterProject, "ai_tool", "doc_edit", 10 * 60_000L);
        log(associate, null, "OPEN_URL", "https://example.test", 30 * 60_000L);
        log(associate, otherProject, "OPEN_FILE", "便签.txt", 30_000L);

        Map<String, Object> imported = act(associate, "timeImport", Map.of());
        assertEquals(1, imported.get("created"));
        assertEquals(1, imported.get("tooShort"));
        final Long wrId = entries.findAll().get(0).getId();
        LawFirmTimeEntry wr = entries.findById(wrId).orElseThrow();
        assertEquals(48, wr.getMinutes());
        assertEquals(48, wr.getCapturedMinutes());
        assertTrue(wr.getDescription().contains("尽调清单.xlsx") && wr.getDescription().contains("数据处理协议.docx"));
        assertEquals("DRAFT", wr.getStatus());
        assertEquals(0, act(associate, "timeImport", Map.of()).get("created"), "re-import does not duplicate");

        // 律师改为 1 小时并改描述；再次生成不覆盖律师的修改
        act(associate, "timeSave", Map.of("id", wrId, "hours", "1", "description", "审阅数据处理协议并整理尽调清单"));
        log(associate, matterProject, "OPEN_FILE", "尽调清单.xlsx", 20 * 60_000L);
        act(associate, "timeImport", Map.of());
        wr = entries.findById(wrId).orElseThrow();
        assertEquals(60, wr.getMinutes());
        assertEquals(66, wr.getCapturedMinutes(), "45+20=65 min -> 66; captured time is refreshed for reference");
        assertEquals("审阅数据处理协议并整理尽调清单", wr.getDescription());

        // 补录：律师按事项补录 2 小时；另一位律师 3 小时；一条落在未立案项目上
        Long manual = id(act(associate, "timeSave", Map.of("target", "i:" + intake.getId(), "workDate", today.toString(),
                "hours", "2", "description", "内部讨论（申报可收费）")));
        Long other = id(act(associate, "timeSave", Map.of("target", "p:" + otherProject.getId(), "workDate", today.toString(),
                "hours", "1", "description", "未立案项目的工作")));
        Long seniorEntry = id(act(senior, "timeSave", Map.of("target", "i:" + intake.getId(), "workDate", today.toString(),
                "hours", "3", "description", "起草隐私政策")));
        assertThrows(IllegalArgumentException.class, () -> act(associate, "timeSave", Map.of("target", "i:" + intake.getId(),
                "workDate", today.plusDays(1).toString(), "hours", "1", "description", "x")), "future date rejected");
        assertThrows(IllegalArgumentException.class, () -> act(senior, "timeDelete", Map.of("id", wrId)), "cannot touch others' entries");

        act(associate, "timeSubmit", Map.of("ids", List.of(wrId, manual, other)));
        act(senior, "timeSubmit", Map.of("ids", List.of(seniorEntry)));
        assertThrows(IllegalStateException.class, () -> act(associate, "timeSave", Map.of("id", wrId, "hours", "5")));

        // 律师本人不是主办也不是管理员：看不到审核队列、不能审核、不能设费率
        assertTrue(((List<?>) act(associate, "timeReviewList", Map.of()).get("entries")).isEmpty());
        assertThrows(IllegalArgumentException.class, () -> act(associate, "timeReview", Map.of("id", seniorEntry, "op", "APPROVE")));
        assertThrows(IllegalArgumentException.class, () -> act(associate, "billingSaveTimekeeper",
                Map.of("userId", associate.getId(), "level", "ASSOCIATE", "standardRateYuan", "99999")));

        // 未设费率不能通过
        assertThrows(IllegalStateException.class, () -> act(partner, "timeReview", Map.of("id", seniorEntry, "op", "APPROVE")));
        act(partner, "billingSaveTimekeeper", Map.of("userId", associate.getId(), "level", "ASSOCIATE", "standardRateYuan", "1000"));
        act(partner, "billingSaveTimekeeper", Map.of("userId", senior.getId(), "level", "SENIOR_ASSOCIATE", "standardRateYuan", "2,000"));
        act(partner, "billingSaveTerms", Map.of("intakeId", intake.getId(), "discountPercent", "10", "capYuan", "9000",
                "levelRates", Map.of("SENIOR_ASSOCIATE", "1800", "BOGUS", "1")));

        // 合伙人审核：核减须写理由；不收费须写理由；改描述
        assertThrows(IllegalArgumentException.class, () -> act(partner, "timeReview", Map.of("id", wrId, "op", "ADJUST", "billedHours", "0.5")));
        assertThrows(IllegalArgumentException.class, () -> act(partner, "timeReview", Map.of("id", wrId, "op", "ADJUST", "billedHours", "1.5", "reason", "x")),
                "cannot bill more than recorded");
        act(partner, "timeReview", Map.of("id", wrId, "op", "ADJUST", "billedHours", "0.5", "reason", "整理清单属行政性工作"));
        assertThrows(IllegalArgumentException.class, () -> act(partner, "timeReview", Map.of("id", manual, "op", "NO_CHARGE")));
        act(partner, "timeReview", Map.of("id", manual, "op", "NO_CHARGE", "reason", "内部讨论不向客户收费"));
        act(partner, "timeReview", Map.of("id", seniorEntry, "op", "ADJUST", "description", "起草个人信息处理规则与隐私政策"));
        Map<String, Object> approved = act(partner, "timeApproveAll", Map.of("ids", List.of(wrId, manual, other, seniorEntry)));
        assertEquals(3, approved.get("approved"));
        assertEquals(1, ((List<?>) approved.get("failed")).size(), "entry on a project without a matter cannot be approved");

        List<String> trail = audits.findByEntryIdInOrderByIdAsc(List.of(wrId)).stream().map(a -> a.getAction()).toList();
        assertEquals(List.of("SUBMIT", "WRITE_DOWN", "APPROVE"), trail);
        assertEquals("整理清单属行政性工作", audits.findByEntryIdInOrderByIdAsc(List.of(wrId)).get(1).getReason());
        assertTrue(audits.findByEntryIdInOrderByIdAsc(List.of(seniorEntry)).get(1).getDetail().contains("起草隐私政策"), "old description kept in the trail");

        // 账单：陈 0.5h × ¥1,000 = 500；周 3h × 约定 ¥1,800 = 5,400；小计 5,900，九折 590，合计 5,310（未触封顶 9,000）
        Map<String, Object> preview = act(partner, "billPreview", Map.of("intakeId", intake.getId()));
        assertEquals(590_000L, preview.get("subtotalCents"));
        assertEquals(59_000L, preview.get("discountCents"));
        assertEquals(531_000L, preview.get("totalCents"));
        assertEquals(700_000L, preview.get("standardAmountCents"), "standard value uses recorded hours × standard rates");
        assertEquals(1, preview.get("noChargeCount"));
        Map<String, Object> bill = bill(act(partner, "billCreate", Map.of("intakeId", intake.getId())));
        Long billId = ((Number) bill.get("id")).longValue();
        assertEquals("DRAFT", bill.get("status"));
        assertEquals("BILLED", entries.findById(wrId).orElseThrow().getStatus());
        assertThrows(IllegalStateException.class, () -> act(partner, "billCreate", Map.of("intakeId", intake.getId())), "entries are not billed twice");
        assertThrows(IllegalStateException.class, () -> act(partner, "timeReview", Map.of("id", wrId, "op", "NO_CHARGE", "reason", "x")));

        // 客户确认 → 原台账发票申请
        assertThrows(IllegalStateException.class, () -> act(partner, "billConfirm", Map.of("id", billId, "confirmedBy", "王总")));
        act(partner, "billSend", Map.of("id", billId));
        assertThrows(IllegalArgumentException.class, () -> act(partner, "billConfirm", Map.of("id", billId)));
        bill = bill(act(partner, "billConfirm", Map.of("id", billId, "confirmedBy", "王总（甲公司法务）", "invoiceType", "DIGITAL_SPECIAL")));
        assertEquals("CONFIRMED", bill.get("status"));
        LawFirmInvoice invoice = invoices.findById(((Number) bill.get("invoiceId")).longValue()).orElseThrow();
        assertEquals(531_000L, invoice.getAmountCents());
        assertEquals("PENDING_APPROVAL", invoice.getStatus());
        assertEquals("91110000MA00TEST01", invoice.getBuyerTaxId(), "special invoice falls back to the matter's credit code");
        assertTrue(invoice.getRemark().contains((String) bill.get("billNo")));
        assertThrows(IllegalStateException.class, () -> act(partner, "billCancel", Map.of("id", billId)));

        // 原台账核销 ¥3,000
        ledger.execute(partner.getId(), null, "recordCollection", Map.of("invoiceId", invoice.getId(), "amountCents", 300_000L));

        // 实现率：陈 标准价值 = 1h×1000（已确认账单）+ 2h×1000（不收费）= 3,000；实收按 500:5400 分摊 3,000
        //   → 陈 254.237… / 周 2745.762…，最大余数法 → 陈 254.24、周 2745.76
        Map<String, Object> metrics = act(partner, "billingMetrics", Map.of());
        Map<String, Object> chen = lawyer(metrics, associate);
        assertEquals(240L, chen.get("recordedMinutes"), "60 + 120 + 60 (still pending)");
        assertEquals(90L, chen.get("billableMinutes"));
        assertEquals(150L, chen.get("writtenDownMinutes"));
        assertEquals(300_000L, chen.get("standardValueCents"));
        assertEquals(45_000L, chen.get("billedAmountCents"));
        assertEquals(25_424L, chen.get("collectedCents"));
        assertEquals("8.5", chen.get("realizationPercent"));
        Map<String, Object> zhou = lawyer(metrics, senior);
        assertEquals(600_000L, zhou.get("standardValueCents"));
        assertEquals(274_576L, zhou.get("collectedCents"));
        assertEquals("45.8", zhou.get("realizationPercent"));
        Map<?, ?> total = (Map<?, ?>) metrics.get("total");
        assertEquals(300_000L, total.get("collectedCents"));
        assertEquals("33.3", total.get("realizationPercent"));
        assertThrows(IllegalArgumentException.class, () -> act(associate, "billingMetrics", Map.of()));
    }

    @Test
    void cancellingABillReleasesEntriesAndCapIsCumulative() {
        act(partner, "billingSaveTimekeeper", Map.of("userId", senior.getId(), "level", "SENIOR_ASSOCIATE", "standardRateYuan", "2000"));
        act(partner, "billingSaveTerms", Map.of("intakeId", intake.getId(), "discountPercent", "", "capYuan", "5000"));
        Long a = id(act(senior, "timeSave", Map.of("target", "i:" + intake.getId(), "workDate", today.toString(), "hours", "2", "description", "a")));
        act(senior, "timeSubmit", Map.of("ids", List.of(a)));
        act(partner, "timeReview", Map.of("id", a, "op", "APPROVE"));

        Map<String, Object> first = bill(act(partner, "billCreate", Map.of("intakeId", intake.getId())));
        assertEquals(400_000L, first.get("totalCents"));
        act(partner, "billCancel", Map.of("id", first.get("id"), "reason", "客户要求合并到下月"));
        LawFirmTimeEntry e = entries.findById(a).orElseThrow();
        assertEquals("APPROVED", e.getStatus());
        assertNull(e.getBillId());
        assertEquals("UNBILL", audits.findByEntryIdInOrderByIdAsc(List.of(a)).stream().reduce((x, y) -> y).orElseThrow().getAction());

        // 作废的账单不占封顶；重开一张 4,000 后，再来 2h 只剩 1,000 额度
        Map<String, Object> second = bill(act(partner, "billCreate", Map.of("intakeId", intake.getId())));
        assertEquals(400_000L, second.get("totalCents"));
        Long b = id(act(senior, "timeSave", Map.of("target", "i:" + intake.getId(), "workDate", today.toString(), "hours", "2", "description", "b")));
        act(senior, "timeSubmit", Map.of("ids", List.of(b)));
        act(partner, "timeReview", Map.of("id", b, "op", "APPROVE"));
        Map<String, Object> third = bill(act(partner, "billCreate", Map.of("intakeId", intake.getId())));
        assertEquals(400_000L, third.get("subtotalCents"));
        assertEquals(300_000L, third.get("capReductionCents"));
        assertEquals(100_000L, third.get("totalCents"));

        // 封顶用完的账单合计为 0：客户确认时不生成 0 元发票申请
        Long c = id(act(senior, "timeSave", Map.of("target", "i:" + intake.getId(), "workDate", today.toString(), "hours", "1", "description", "c")));
        act(senior, "timeSubmit", Map.of("ids", List.of(c)));
        act(partner, "timeReview", Map.of("id", c, "op", "APPROVE"));
        Map<String, Object> fourth = bill(act(partner, "billCreate", Map.of("intakeId", intake.getId())));
        assertEquals(0L, fourth.get("totalCents"));
        act(partner, "billSend", Map.of("id", fourth.get("id")));
        long before = invoices.count();
        assertNull(bill(act(partner, "billConfirm", Map.of("id", fourth.get("id"), "confirmedBy", "王总"))).get("invoiceId"));
        assertEquals(before, invoices.count());
    }

    @Test
    void returnedEntryGoesBackToTheLawyerAndWorkRecordDeletionIsRemembered() {
        log(associate, matterProject, "OPEN_FILE", "a.docx", 7 * 60_000L);
        act(associate, "timeImport", Map.of());
        LawFirmTimeEntry wr = entries.findAll().get(0);
        assertEquals(12, wr.getMinutes(), "7 minutes round up to two 6-minute units");
        act(associate, "timeDelete", Map.of("id", wr.getId()));
        assertEquals("DISMISSED", entries.findById(wr.getId()).orElseThrow().getStatus());
        assertEquals(0, act(associate, "timeImport", Map.of()).get("created"), "dismissed work-record day does not come back");
        assertTrue(((List<?>) act(associate, "timeMine", Map.of()).get("entries")).isEmpty());

        Long m = id(act(associate, "timeSave", Map.of("target", "p:" + matterProject.getId(), "workDate", today.toString(), "hours", "1", "description", "x")));
        act(associate, "timeSubmit", Map.of("ids", List.of(m)));
        assertThrows(IllegalArgumentException.class, () -> act(partner, "timeReview", Map.of("id", m, "op", "RETURN")));
        act(partner, "timeReview", Map.of("id", m, "op", "RETURN", "reason", "描述过于笼统"));
        assertEquals("RETURNED", entries.findById(m).orElseThrow().getStatus());
        act(associate, "timeSave", Map.of("id", m, "description", "审阅并修改股权转让协议第 3–7 条"));
        act(associate, "timeSubmit", Map.of("ids", List.of(m)));
        assertEquals("SUBMITTED", entries.findById(m).orElseThrow().getStatus());
    }

    @Test
    void reviewFixesFromCodeReview() {
        act(partner, "billingSaveTimekeeper", Map.of("userId", senior.getId(), "level", "SENIOR_ASSOCIATE", "standardRateYuan", "2000"));

        // 核减后退回、律师改申报再提交：按新申报计，不沿用上一轮核定时长
        Long e = id(act(senior, "timeSave", Map.of("target", "i:" + intake.getId(), "workDate", today.toString(), "hours", "5", "description", "a")));
        act(senior, "timeSubmit", Map.of("ids", List.of(e)));
        act(partner, "timeReview", Map.of("id", e, "op", "ADJUST", "billedHours", "4", "reason", "部分重复"));
        act(partner, "timeReview", Map.of("id", e, "op", "RETURN", "reason", "请拆分"));
        assertNull(entries.findById(e).orElseThrow().getBilledMinutes());
        act(senior, "timeSave", Map.of("id", e, "hours", "3"));
        act(senior, "timeSubmit", Map.of("ids", List.of(e)));
        act(partner, "timeReview", Map.of("id", e, "op", "APPROVE"));
        assertEquals(180, entries.findById(e).orElseThrow().getBilledMinutes());

        // 预览之后内容变了：按旧预览出单被拒
        assertThrows(IllegalStateException.class, () -> act(partner, "billCreate",
                Map.of("intakeId", intake.getId(), "expectedTotalCents", 1L, "expectedEntryCount", 1L)));

        // 客户已确认的账单：发票未作废不能撤销；作废后可撤销，工时退回、封顶额度释放
        act(partner, "billingSaveTerms", Map.of("intakeId", intake.getId(), "capYuan", "8000"));
        Map<String, Object> first = bill(act(partner, "billCreate", Map.of("intakeId", intake.getId(), "expectedTotalCents", 600_000L, "expectedEntryCount", 1L)));
        Long f = id(act(senior, "timeSave", Map.of("target", "i:" + intake.getId(), "workDate", today.toString(), "hours", "2", "description", "b")));
        act(senior, "timeSubmit", Map.of("ids", List.of(f)));
        act(partner, "timeReview", Map.of("id", f, "op", "APPROVE"));
        Map<String, Object> second = bill(act(partner, "billCreate", Map.of("intakeId", intake.getId())));
        assertEquals(200_000L, second.get("totalCents"), "cap 8000 - 6000 already billed");
        act(partner, "billSend", Map.of("id", first.get("id")));
        act(partner, "billConfirm", Map.of("id", first.get("id"), "confirmedBy", "王总"));
        assertThrows(IllegalStateException.class, () -> act(partner, "billCancel", Map.of("id", first.get("id"))));
        Long invoiceId = ((Number) bills(first.get("id")).get("invoiceId")).longValue();
        ledger.execute(partner.getId(), null, "voidInvoice", Map.of("invoiceId", invoiceId));
        Map<String, Object> cancelled = act(partner, "billCancel", Map.of("id", first.get("id"), "reason", "发票开错，重新出单"));
        assertEquals("CANCELLED", bill(cancelled).get("status"));
        assertEquals("APPROVED", entries.findById(e).orElseThrow().getStatus());
        // 草稿账单按释放后的额度重算：2h × 2000 = 4000，不再被封顶压到 2000
        assertEquals(400_000L, ((Number) bills(second.get("id")).get("totalCents")).longValue());
        assertEquals(List.of(), cancelled.get("recalculated"), "draft bills are not reported as needing a resend");
    }

    @Test
    void leadLawyerWithoutFirmWideRightsCannotReviewOwnTimeOrUseOthersMatters() {
        LawFirmMatterIntake own = intakes.save(LawFirmMatterIntake.builder().intakeNo("T2-" + System.nanoTime()).title("周律师主办事项")
                .leadLawyerUserId(senior.getId()).clientName("乙公司（虚构）").feeMode("HOURLY").status("APPROVED_FILED")
                .createdAt(Instant.now()).updatedAt(Instant.now()).build());
        act(partner, "billingSaveTimekeeper", Map.of("userId", senior.getId(), "level", "SENIOR_ASSOCIATE", "standardRateYuan", "2000"));
        Long e = id(act(senior, "timeSave", Map.of("target", "i:" + own.getId(), "workDate", today.toString(), "hours", "1", "description", "x")));
        act(senior, "timeSubmit", Map.of("ids", List.of(e)));
        assertThrows(IllegalArgumentException.class, () -> act(senior, "timeReview", Map.of("id", e, "op", "APPROVE")));
        // 陈律师与乙公司事项无关：看不到也记不上
        assertThrows(IllegalArgumentException.class, () -> act(associate, "timeSave", Map.of("target", "i:" + own.getId(),
                "workDate", today.toString(), "hours", "1", "description", "x")));
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> targets = (List<Map<String, Object>>) act(associate, "timeMine", Map.of()).get("targets");
        assertTrue(targets.stream().noneMatch(t -> own.getId().equals(t.get("intakeId"))));
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> bills(Object id) {
        return ((List<Map<String, Object>>) act(partner, "billList", Map.of()).get("bills")).stream()
                .filter(b -> id.equals(b.get("id"))).findFirst().orElseThrow();
    }

    // ── helpers ──

    private Map<String, Object> act(User u, String action, Map<String, Object> params) {
        return billing.execute(u.getId(), null, action, params);
    }

    private static Long id(Map<String, Object> res) {
        return ((Number) ((Map<?, ?>) res.get("entry")).get("id")).longValue();
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> bill(Map<String, Object> res) {
        return (Map<String, Object>) res.get("bill");
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> lawyer(Map<String, Object> metrics, User u) {
        return ((List<Map<String, Object>>) metrics.get("lawyers")).stream()
                .filter(m -> u.getId().equals(m.get("userId"))).findFirst().orElseThrow();
    }

    private void log(User u, Project p, String type, String target, long durationMs) {
        UserActivityLog l = new UserActivityLog();
        l.setUserId(u.getId());
        l.setActionType(type);
        l.setTargetName(target);
        l.setDuration(durationMs);
        l.setProjectId(p == null ? null : p.getId());
        activity.saveAndFlush(l);
    }

    private User user(String username, String name) {
        User u = new User();
        u.setUsername(username + System.nanoTime());
        u.setDisplayName(name);
        u.setPassword("{noop}pw123456");
        u.setRole("USER");
        u.setCreatedAt(LocalDateTime.now());
        u.setUpdatedAt(LocalDateTime.now());
        return users.save(u);
    }

    private Project project(String name, Long owner) {
        Project p = new Project();
        p.setName(name);
        p.setUserId(owner);
        p.setProjectType("BLANK");
        p.setListedCompanyName("");
        p.setTargetCompanyName("");
        p.setCreatedAt(LocalDateTime.now());
        p.setUpdatedAt(p.getCreatedAt());
        return projects.save(p);
    }
}
