// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.lawfirm;

import com.checkba.model.entity.ImMessage;
import com.checkba.model.entity.Project;
import com.checkba.model.entity.User;
import com.checkba.model.entity.lawfirm.LawFirmConflictClearance;
import com.checkba.model.entity.lawfirm.LawFirmInvoice;
import com.checkba.repository.ImMessageRepository;
import com.checkba.repository.ProjectRepository;
import com.checkba.repository.UserRepository;
import com.checkba.repository.lawfirm.LawFirmCollectionRepository;
import com.checkba.repository.lawfirm.LawFirmConflictClearanceRepository;
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
import java.time.LocalDateTime;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;

/**
 * 律所业务管理与决策引擎全链路端到端 JUnit 走查测试（覆盖 5 条核心业务链路）。
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@Import({LawFirmManagementService.class, LawFirmConflictEngine.class, ImService.class, ObjectMapper.class})
@TestPropertySource(properties = {
        "spring.datasource.url=jdbc:h2:mem:lawfirm-walkthrough-test;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DEFAULT_NULL_ORDERING=HIGH;NON_KEYWORDS=VALUE;DB_CLOSE_DELAY=-1",
        "spring.datasource.driver-class-name=org.h2.Driver",
        "spring.datasource.username=sa",
        "spring.datasource.password=",
        "spring.jpa.database-platform=org.hibernate.dialect.H2Dialect",
        "spring.jpa.hibernate.ddl-auto=create-drop",
        "security.local-mode=false"
})
class LawFirmWalkthroughTest {

    @Autowired
    private LawFirmManagementService lawFirmService;

    @Autowired
    private LawFirmConflictEngine conflictEngine;

    @Autowired
    private LawFirmMatterIntakeRepository intakeRepository;

    @Autowired
    private LawFirmConflictClearanceRepository clearanceRepository;

    @Autowired
    private LawFirmInvoiceRepository invoiceRepository;

    @Autowired
    private LawFirmCollectionRepository collectionRepository;

    @Autowired
    private ProjectRepository projectRepository;

    @Autowired
    private UserRepository userRepository;

    @Autowired
    private ImMessageRepository imMessageRepository;

    @MockBean
    private PluginService pluginService;

    private User userA;
    private User userB;
    private User userCommittee;

    @BeforeEach
    void setUpUsers() {
        lawFirmService.localMode = false;
        userA = createUser("lawyer_a", "苏婉清（合伙人）");
        userB = createUser("lawyer_b", "周铭泽（主办律师）");
        userCommittee = createUser("lawyer_committee", "林正源（利冲主任委员）");
    }

    private User createUser(String username, String displayName) {
        User u = new User();
        u.setUsername(username);
        u.setDisplayName(displayName);
        u.setPassword("{noop}pw123456");
        u.setRole("USER");
        u.setSubscriptionType("PAID");
        u.setCreatedAt(LocalDateTime.now());
        u.setUpdatedAt(LocalDateTime.now());
        return userRepository.saveAndFlush(u);
    }

    @Test
    @DisplayName("Walkthrough 1: 绿色无冲突收案 -> 利冲委员终审 -> 正式立案与工作台自动建项")
    @SuppressWarnings("unchecked")
    void walkthrough1_greenIntakeToCommitteeApprovalAndWorkbenchProjectCreation() {
        Map<String, Object> submitRes = lawFirmService.execute(userA.getId(), null, "submitIntake", Map.of(
                "title", "芯源微电子科创板 IPO 专项法律服务",
                "practiceArea", "IPO_CAPITAL",
                "departmentName", "资本市场与证券部",
                "clientName", "芯源微电子股份有限公司",
                "counterpartyName", "无",
                "feeMode", "FIXED",
                "contractAmountCents", 300_000_000L
        ));

        assertEquals("GREEN", submitRes.get("conflictRiskLevel"));
        Map<String, Object> intakeView = (Map<String, Object>) submitRes.get("intake");
        assertNotNull(intakeView);
        Long intakeId = ((Number) intakeView.get("id")).longValue();
        assertEquals("GREEN", intakeView.get("conflictRiskLevel"));
        assertEquals("PENDING_COMMITTEE_REVIEW", intakeView.get("status"));

        List<Map<String, Object>> stepsBefore = (List<Map<String, Object>>) intakeView.get("progressSteps");
        assertEquals(5, stepsBefore.size());
        assertEquals("done", stepsBefore.get(0).get("status"));
        assertEquals("done", stepsBefore.get(1).get("status"));
        assertEquals("done", stepsBefore.get(2).get("status"));
        assertEquals("active", stepsBefore.get(3).get("status"));
        assertEquals("pending", stepsBefore.get(4).get("status"));

        // 申请人本人不能在团队服务器模式下终审自己的申请
        assertThrows(IllegalStateException.class, () ->
                lawFirmService.execute(userA.getId(), null, "committeeReview", Map.of(
                        "intakeId", intakeId,
                        "decision", "APPROVE_AND_FILE"
                )));

        // 独立利冲委员终审通过并自动创建工作台项目
        Map<String, Object> reviewRes = lawFirmService.execute(userCommittee.getId(), null, "committeeReview", Map.of(
                "intakeId", intakeId,
                "decision", "APPROVE_AND_FILE",
                "createWorkbenchProject", true,
                "comment", "核查无利益冲突，准予立项建档"
        ));

        Map<String, Object> filedIntake = (Map<String, Object>) reviewRes.get("intake");
        assertEquals("APPROVED_FILED", filedIntake.get("status"));
        assertNotNull(filedIntake.get("projectId"));
        Long projectId = ((Number) filedIntake.get("projectId")).longValue();

        Project createdProject = projectRepository.findById(projectId).orElseThrow();
        assertTrue(createdProject.getName().contains("芯源微电子科创板 IPO 专项法律服务"));
        assertEquals("芯源微电子股份有限公司", createdProject.getListedCompanyName());
        assertEquals(userA.getId(), createdProject.getUserId());

        List<Map<String, Object>> stepsAfter = (List<Map<String, Object>>) filedIntake.get("progressSteps");
        assertEquals(5, stepsAfter.size());
        for (int i = 0; i < 5; i++) {
            assertEquals("done", stepsAfter.get(i).get("status"), "Step " + (i + 1) + " should be done");
        }
    }

    @Test
    @DisplayName("Walkthrough 2: 黄色潜在冲突 -> 自动建站内信会话与征询单 -> 承办律师隔离墙放行 -> 委员会终审立案")
    @SuppressWarnings("unchecked")
    void walkthrough2_yellowConflictToImStationMessageLawyerClearanceAndCommitteeFiling() {
        // 1. 律师 A 先有一宗在办已立案案件，委托人为「华星半导体股份有限公司」
        Map<String, Object> caseARes = lawFirmService.execute(userA.getId(), null, "submitIntake", Map.of(
                "title", "华星半导体科创板上市常年及专项辅导",
                "practiceArea", "IPO_CAPITAL",
                "departmentName", "资本市场与证券部",
                "clientName", "华星半导体股份有限公司",
                "counterpartyName", "上海证券交易所科创板审核中心",
                "contractAmountCents", 380_000_000L
        ));
        Long caseAId = ((Number) ((Map<String, Object>) caseARes.get("intake")).get("id")).longValue();
        lawFirmService.execute(userCommittee.getId(), null, "committeeReview", Map.of(
                "intakeId", caseAId,
                "decision", "APPROVE_AND_FILE"
        ));

        // 2. 律师 B 预检并提交新商事诉讼：对方当事人为「华星半导体（集团）有限公司」（商号核心词干归一化为「华星半导体」）
        Map<String, Object> precheck = lawFirmService.execute(userB.getId(), null, "precheckConflict", Map.of(
                "practiceArea", "LITIGATION",
                "clientName", "苏州东海精密装备股份有限公司",
                "counterpartyName", "华星半导体（集团）有限公司"
        ));
        assertEquals("YELLOW", precheck.get("conflictRiskLevel"));
        assertEquals("Y1_EXISTING_CLIENT_OTHER_MATTER", precheck.get("primaryRuleCode"));

        Map<String, Object> submitBRes = lawFirmService.execute(userB.getId(), null, "submitIntake", Map.of(
                "title", "东海精密诉华星半导体（集团）晶圆设备采购合同纠纷案",
                "practiceArea", "LITIGATION",
                "departmentName", "民商事争议解决部",
                "clientName", "苏州东海精密装备股份有限公司",
                "counterpartyName", "华星半导体（集团）有限公司",
                "feeMode", "PROPORTIONAL",
                "contractAmountCents", 150_000_000L
        ));
        assertEquals("YELLOW", submitBRes.get("conflictRiskLevel"));

        Map<String, Object> intakeB = (Map<String, Object>) submitBRes.get("intake");
        Long intakeBId = ((Number) intakeB.get("id")).longValue();
        assertEquals("PENDING_LAWYER_CLEARANCE", intakeB.get("status"));
        String imConversationId = (String) intakeB.get("imConversationId");
        assertNotNull(imConversationId);
        assertFalse(imConversationId.isBlank());

        // 验证站内信消息已真实落库
        List<ImMessage> messagesBeforeClearance = imMessageRepository.findAll().stream()
                .filter(m -> imConversationId.equals(m.getConversationId()))
                .toList();
        assertFalse(messagesBeforeClearance.isEmpty(), "应当自动向站内信会话发送利冲核查征询通知");
        assertTrue(messagesBeforeClearance.get(0).getText().contains("Y1_EXISTING_CLIENT_OTHER_MATTER"));

        // 验证生成了针对 userA 的利冲征询记录
        List<LawFirmConflictClearance> clearances = clearanceRepository.findByIntakeIdOrderByIdAsc(intakeBId);
        assertEquals(1, clearances.size());
        LawFirmConflictClearance clearance = clearances.get(0);
        assertEquals(userA.getId(), clearance.getTargetUserId());
        assertEquals("PENDING", clearance.getDecision());

        // 征询未完成前，委员会不能越过承办律师直接终审通过
        assertThrows(IllegalStateException.class, () ->
                lawFirmService.execute(userCommittee.getId(), null, "committeeReview", Map.of(
                        "intakeId", intakeBId,
                        "decision", "APPROVE_AND_FILE"
                )));

        // 非被征询律师本人（如申请人 userB）不能越权替 userA 点同意放行
        assertThrows(IllegalStateException.class, () ->
                lawFirmService.execute(userB.getId(), null, "respondClearance", Map.of(
                        "clearanceId", clearance.getId(),
                        "decision", "APPROVED_WITH_WALL"
                )));

        // 3. 被征询律师 userA 本人附条件放行并启用信息隔离墙
        Map<String, Object> clearRes = lawFirmService.execute(userA.getId(), null, "respondClearance", Map.of(
                "clearanceId", clearance.getId(),
                "decision", "APPROVED_WITH_WALL",
                "ethicalWallApplied", true,
                "comment", "非同一业务领域且不涉及IPO机密，同意放行并启用信息隔离墙"
        ));
        Map<String, Object> intakeAfterClear = (Map<String, Object>) clearRes.get("intake");
        assertEquals("PENDING_COMMITTEE_REVIEW", intakeAfterClear.get("status"));
        assertEquals(Boolean.TRUE, intakeAfterClear.get("ethicalWallApplied"));

        // 验证站内信回执消息已追加
        List<ImMessage> messagesAfterClearance = imMessageRepository.findAll().stream()
                .filter(m -> imConversationId.equals(m.getConversationId()))
                .toList();
        assertTrue(messagesAfterClearance.size() >= 2, "放行后应在站内信会话中追加放行回执");
        assertTrue(messagesAfterClearance.stream().anyMatch(m -> m.getText().contains("【利冲放行回执】")));

        // 4. 利冲委员终审通过并自动创建工作台 Project
        Map<String, Object> finalRes = lawFirmService.execute(userCommittee.getId(), null, "committeeReview", Map.of(
                "intakeId", intakeBId,
                "decision", "APPROVE_AND_FILE",
                "createWorkbenchProject", true
        ));
        Map<String, Object> filedIntakeB = (Map<String, Object>) finalRes.get("intake");
        assertEquals("APPROVED_FILED", filedIntakeB.get("status"));
        Long projectBId = ((Number) filedIntakeB.get("projectId")).longValue();
        assertTrue(projectRepository.findById(projectBId).isPresent());
    }

    @Test
    @DisplayName("Walkthrough 3: 红色常顾/直接对抗冲突阻断校验 + 风险代理法定禁区与30%上限合规预警")
    @SuppressWarnings("unchecked")
    void walkthrough3_redRetainerConflictBlockAndStatutoryFeeCompliance() {
        // 1. 律师 A 有一宗在办常年法律顾问项目（RETAINER），客户为「北京云杉数智科技有限公司」
        Map<String, Object> retainerRes = lawFirmService.execute(userA.getId(), null, "submitIntake", Map.of(
                "title", "北京云杉数智科技有限公司2026年度常年法律顾问",
                "practiceArea", "RETAINER",
                "departmentName", "公司并购与投融资部",
                "clientName", "北京云杉数智科技有限公司",
                "counterpartyName", "无",
                "feeMode", "RETAINER",
                "contractAmountCents", 80_000_000L
        ));
        Long retainerId = ((Number) ((Map<String, Object>) retainerRes.get("intake")).get("id")).longValue();
        lawFirmService.execute(userCommittee.getId(), null, "committeeReview", Map.of(
                "intakeId", retainerId,
                "decision", "APPROVE_AND_FILE"
        ));

        // 2. 律师 B 提交以「北京云杉数智科技有限公司」为对方当事人的诉讼案件
        Map<String, Object> redSubmitRes = lawFirmService.execute(userB.getId(), null, "submitIntake", Map.of(
                "title", "远洋软件诉北京云杉数智科技有限公司技术开发合同纠纷",
                "practiceArea", "LITIGATION",
                "departmentName", "知识产权与合规部",
                "clientName", "深圳远洋云创软件有限公司",
                "counterpartyName", "北京云杉数智科技有限公司",
                "feeMode", "FIXED",
                "contractAmountCents", 60_000_000L
        ));
        assertEquals("RED", redSubmitRes.get("conflictRiskLevel"));
        LawFirmConflictEngine.ConflictCheckResult conflictCheck =
                (LawFirmConflictEngine.ConflictCheckResult) redSubmitRes.get("conflictResult");
        assertEquals("R2_RETAINER_ADVERSARY", conflictCheck.getPrimaryRuleCode());

        Map<String, Object> redIntake = (Map<String, Object>) redSubmitRes.get("intake");
        Long redIntakeId = ((Number) redIntake.get("id")).longValue();

        // 即使承办律师 userA 放行，若未上传双方客户书面豁免函（clientWaiverUploaded=false），利冲委员终审也必须抛异常阻断立案
        List<LawFirmConflictClearance> redClearances = clearanceRepository.findByIntakeIdOrderByIdAsc(redIntakeId);
        assertEquals(1, redClearances.size());
        lawFirmService.execute(userA.getId(), null, "respondClearance", Map.of(
                "clearanceId", redClearances.get(0).getId(),
                "decision", "APPROVED_WITH_WALL",
                "ethicalWallApplied", true
        ));

        IllegalStateException redBlockEx = assertThrows(IllegalStateException.class, () ->
                lawFirmService.execute(userCommittee.getId(), null, "committeeReview", Map.of(
                        "intakeId", redIntakeId,
                        "decision", "APPROVE_AND_FILE",
                        "clientWaiverUploaded", false
                )));
        assertTrue(redBlockEx.getMessage().contains("书面豁免函"));

        // 3. 校验法定风险代理收费禁区（刑事/婚姻家事）与 30% 法定上限
        Map<String, Object> criminalContingency = lawFirmService.execute(userB.getId(), null, "submitIntake", Map.of(
                "title", "某职务侵占案刑事辩护",
                "practiceArea", "CRIMINAL",
                "clientName", "张某",
                "counterpartyName", "无",
                "feeMode", "CONTINGENCY",
                "contingencyRateBps", 1500
        ));
        String criminalWarning = (String) criminalContingency.get("feeComplianceWarning");
        assertNotNull(criminalWarning);
        assertTrue(criminalWarning.contains("《律师服务收费管理办法》第十一条、第十二条"));

        Map<String, Object> marriageContingency = lawFirmService.execute(userB.getId(), null, "precheckConflict", Map.of(
                "practiceArea", "MARRIAGE_FAMILY",
                "clientName", "李某",
                "counterpartyName", "王某",
                "feeMode", "CONTINGENCY",
                "contingencyRateBps", 1000
        ));
        String marriageWarning = (String) marriageContingency.get("feeComplianceWarning");
        assertNotNull(marriageWarning);
        assertTrue(marriageWarning.contains("《律师服务收费管理办法》第十一条、第十二条"));

        Map<String, Object> overCapContingency = lawFirmService.execute(userB.getId(), null, "submitIntake", Map.of(
                "title", "某建设工程施工合同纠纷风险代理",
                "practiceArea", "LITIGATION",
                "clientName", "宏远建设集团股份有限公司",
                "counterpartyName", "某置业发展有限公司",
                "feeMode", "CONTINGENCY",
                "contingencyRateBps", 3500,
                "disputeTargetCents", 2000_000_000L
        ));
        String capWarning = (String) overCapContingency.get("feeComplianceWarning");
        assertNotNull(capWarning);
        assertTrue(capWarning.contains("30%"), "超过 30% 应触发法定上限提示");
    }

    @Test
    @DisplayName("Walkthrough 4: 数电专票价税分离 -> 开票赋码 -> 分期核销与超额拦截 -> ERP 导出与回执对账 -> CSV 公式注入防护")
    @SuppressWarnings("unchecked")
    void walkthrough4_invoicingCollectionReconciliationErpSyncAndCsvFormulaProtection() {
        // 1. 提交 106 万元（106_000_000 分，6% 税率）数电专票申请，验证价税分离：不含税 100 万，税额 6 万
        Map<String, Object> invRes = lawFirmService.execute(userA.getId(), null, "submitInvoice", Map.of(
                "matterTitle", "=cmd|' /C calc'!A0 芯源微电子IPO专项服务",
                "departmentName", "资本市场与证券部",
                "invoiceType", "DIGITAL_SPECIAL",
                "amountCents", 106_000_000L,
                "taxRateBps", 600,
                "buyerName", "+芯源微电子股份有限公司",
                "buyerTaxId", "91110108MA01XXXX1X"
        ));
        Map<String, Object> invoiceView = (Map<String, Object>) invRes.get("invoice");
        Long invoiceId = ((Number) invoiceView.get("id")).longValue();
        String invoiceAppNo = (String) invoiceView.get("invoiceAppNo");
        assertEquals(106_000_000L, ((Number) invoiceView.get("amountCents")).longValue());
        assertEquals(100_000_000L, ((Number) invoiceView.get("netAmountCents")).longValue());
        assertEquals(6_000_000L, ((Number) invoiceView.get("taxAmountCents")).longValue());
        assertEquals("PENDING_APPROVAL", invoiceView.get("status"));

        // 未填发票号码时禁止开具
        assertThrows(IllegalArgumentException.class, () ->
                lawFirmService.execute(userCommittee.getId(), null, "issueInvoice", Map.of(
                        "invoiceId", invoiceId,
                        "invoiceNumber", "   "
                )));

        // 2. 登记开具发票（20位数电票号）
        Map<String, Object> issuedRes = lawFirmService.execute(userCommittee.getId(), null, "issueInvoice", Map.of(
                "invoiceId", invoiceId,
                "invoiceNumber", "26112000000088990011"
        ));
        Map<String, Object> issuedView = (Map<String, Object>) issuedRes.get("invoice");
        assertEquals("ISSUED", issuedView.get("status"));
        assertEquals("26112000000088990011", issuedView.get("invoiceNumber"));

        // 3. 第一笔部分回款 60 万元 -> 状态变为 PARTIALLY_PAID
        Map<String, Object> col1Res = lawFirmService.execute(userA.getId(), null, "recordCollection", Map.of(
                "invoiceId", invoiceId,
                "amountCents", 60_000_000L,
                "paymentMethod", "BANK_TRANSFER",
                "bankVoucherNo", "CMB-20261015-001"
        ));
        Map<String, Object> invAfterCol1 = (Map<String, Object>) col1Res.get("invoice");
        Map<String, Object> col1View = (Map<String, Object>) col1Res.get("collection");
        String col1No = (String) col1View.get("collectionNo");
        assertEquals("PARTIALLY_PAID", invAfterCol1.get("status"));
        assertEquals(60_000_000L, ((Number) invAfterCol1.get("collectedAmountCents")).longValue());

        // 4. 超额回款拦截：剩余待收 46 万元，尝试核销 50 万元应抛 IllegalArgumentException
        assertThrows(IllegalArgumentException.class, () ->
                lawFirmService.execute(userA.getId(), null, "recordCollection", Map.of(
                        "invoiceId", invoiceId,
                        "amountCents", 50_000_000L
                )));

        // 5. 核销剩余 46 万元 -> 状态变为 PAID
        Map<String, Object> col2Res = lawFirmService.execute(userA.getId(), null, "recordCollection", Map.of(
                "invoiceId", invoiceId,
                "amountCents", 46_000_000L,
                "paymentMethod", "BANK_TRANSFER",
                "bankVoucherNo", "CMB-20261015-002"
        ));
        Map<String, Object> invAfterCol2 = (Map<String, Object>) col2Res.get("invoice");
        assertEquals("PAID", invAfterCol2.get("status"));
        assertEquals(106_000_000L, ((Number) invAfterCol2.get("collectedAmountCents")).longValue());

        // 6. 导出 ERP 批次（syncErp）：MANUAL 发票转为 EXPORTED，CSV 包含 UTF-8 BOM、表头与公式转义前缀
        Map<String, Object> erpExportRes = lawFirmService.execute(userA.getId(), null, "syncErp", Map.of(
                "erpSystem", "KINGDEE_YONYOU_CSV"
        ));
        assertEquals(1, ((Number) erpExportRes.get("exportedInvoiceCount")).intValue());
        String csv = (String) erpExportRes.get("csv");
        assertNotNull(csv);
        assertTrue(csv.startsWith("\uFEFF单据类型,单据编号,关联立项号"), "CSV 必须以 UTF-8 BOM 及标准表头开头");
        assertTrue(csv.contains("'=cmd|"), "以 = 开头的单元格必须前置单引号防止 CSV 公式注入");
        assertTrue(csv.contains("'+芯源微电子股份有限公司"), "以 + 开头的单元格必须前置单引号防止 CSV 公式注入");

        LawFirmInvoice exportedInv = invoiceRepository.findById(invoiceId).orElseThrow();
        assertEquals("EXPORTED", exportedInv.getExternalSyncStatus());

        // 7. 确认 ERP 入账回执（confirmErpSync）：状态转为 SYNCED / EXTERNAL_SYNCED 并写回凭证号
        Map<String, Object> confirmRes = lawFirmService.execute(userA.getId(), null, "confirmErpSync", Map.of(
                "records", List.of(
                        Map.of("type", "INVOICE", "no", invoiceAppNo, "erpRef", "KD-GL-2026-0088"),
                        Map.of("type", "COLLECTION", "no", col1No, "erpRef", "KD-RCV-2026-0102")
                )
        ));
        assertEquals(1, ((Number) confirmRes.get("invoicesConfirmed")).intValue());
        assertEquals(1, ((Number) confirmRes.get("collectionsConfirmed")).intValue());

        LawFirmInvoice syncedInv = invoiceRepository.findById(invoiceId).orElseThrow();
        assertEquals("SYNCED", syncedInv.getExternalSyncStatus());
        assertEquals("KD-GL-2026-0088", syncedInv.getExternalErpRef());
    }

    @Test
    @DisplayName("Walkthrough 5: 律所决策者四级穿透看板（个体 Unit -> 团队 Team Lead -> 部门 Department -> 全所 KPI 与 AR 账龄）")
    @SuppressWarnings("unchecked")
    void walkthrough5_decisionMakerDashboardRollupAndArAging() {
        // 录入两宗不同部门的案件
        Map<String, Object> intake1Res = lawFirmService.execute(userA.getId(), null, "submitIntake", Map.of(
                "title", "华芯科技科创板IPO项目",
                "practiceArea", "IPO_CAPITAL",
                "departmentName", "资本市场与证券部",
                "clientName", "华芯科技股份有限公司",
                "counterpartyName", "无",
                "contractAmountCents", 200_000_000L
        ));
        Long intake1Id = ((Number) ((Map<String, Object>) intake1Res.get("intake")).get("id")).longValue();
        lawFirmService.execute(userCommittee.getId(), null, "committeeReview", Map.of(
                "intakeId", intake1Id,
                "decision", "APPROVE_AND_FILE"
        ));

        Map<String, Object> intake2Res = lawFirmService.execute(userB.getId(), null, "submitIntake", Map.of(
                "title", "博远集团股权并购专项",
                "practiceArea", "CORPORATE_MA",
                "departmentName", "公司并购与投融资部",
                "clientName", "博远控股集团有限公司",
                "counterpartyName", "目标标的公司",
                "contractAmountCents", 100_000_000L
        ));
        Long intake2Id = ((Number) ((Map<String, Object>) intake2Res.get("intake")).get("id")).longValue();
        lawFirmService.execute(userCommittee.getId(), null, "committeeReview", Map.of(
                "intakeId", intake2Id,
                "decision", "APPROVE_AND_FILE"
        ));

        // 开具两张发票：一张近期开具（<30天，开票 100 万，回款 60 万，未收 40 万），一张超 90 天（开票 50 万，未收 50 万）
        Map<String, Object> inv1Res = lawFirmService.execute(userA.getId(), null, "submitInvoice", Map.of(
                "intakeId", intake1Id,
                "departmentName", "资本市场与证券部",
                "invoiceType", "DIGITAL_SPECIAL",
                "amountCents", 100_000_000L,
                "buyerName", "华芯科技股份有限公司",
                "buyerTaxId", "91110108MA01AAAA11",
                "invoiceNumber", "26112000000099000001",
                "issueImmediately", true
        ));
        Long inv1Id = ((Number) ((Map<String, Object>) inv1Res.get("invoice")).get("id")).longValue();

        lawFirmService.execute(userA.getId(), null, "recordCollection", Map.of(
                "invoiceId", inv1Id,
                "amountCents", 60_000_000L
        ));

        Instant hundredDaysAgo = Instant.now().minus(100, ChronoUnit.DAYS);
        Map<String, Object> inv2Res = lawFirmService.execute(userB.getId(), null, "submitInvoice", Map.of(
                "intakeId", intake2Id,
                "departmentName", "公司并购与投融资部",
                "invoiceType", "DIGITAL_NORMAL",
                "amountCents", 50_000_000L,
                "buyerName", "博远控股集团有限公司"
        ));
        Long inv2Id = ((Number) ((Map<String, Object>) inv2Res.get("invoice")).get("id")).longValue();
        lawFirmService.execute(userCommittee.getId(), null, "issueInvoice", Map.of(
                "invoiceId", inv2Id,
                "invoiceNumber", "26112000000099000002",
                "issuedAt", hundredDaysAgo.toString()
        ));

        // 获取全所决策总览
        Map<String, Object> overview = lawFirmService.execute(userA.getId(), null, "overview", Map.of("scope", "all"));
        Map<String, Object> dashboard = (Map<String, Object>) overview.get("dashboard");
        assertNotNull(dashboard);

        Map<String, Object> kpi = (Map<String, Object>) dashboard.get("kpi");
        List<Map<String, Object>> departments = (List<Map<String, Object>>) dashboard.get("departments");
        List<Map<String, Object>> teamLeads = (List<Map<String, Object>>) dashboard.get("teamLeads");
        List<Map<String, Object>> units = (List<Map<String, Object>>) dashboard.get("units");
        Map<String, Object> arAging = (Map<String, Object>) dashboard.get("arAging");

        assertNotNull(kpi);
        assertFalse(departments.isEmpty());
        assertFalse(teamLeads.isEmpty());
        assertFalse(units.isEmpty());
        assertNotNull(arAging);

        // 校验合同额（200万 + 100万 = 300万）、已开票（100万 + 50万 = 150万）、已实收（60万）、待收 AR（90万）
        assertEquals(300_000_000L, ((Number) kpi.get("totalContractedCents")).longValue());
        assertEquals(150_000_000L, ((Number) kpi.get("totalBilledCents")).longValue());
        assertEquals(60_000_000L, ((Number) kpi.get("totalCollectedCents")).longValue());
        assertEquals(90_000_000L, ((Number) kpi.get("totalArCents")).longValue());
        assertEquals(40.0, ((Number) kpi.get("billedCollectionRatePercent")).doubleValue(), 0.1);
        assertEquals(20.0, ((Number) kpi.get("contractCollectionRatePercent")).doubleValue(), 0.1);

        // 校验账龄分桶：30天内未收 40 万，90天以上未收 50 万
        assertEquals(40_000_000L, ((Number) arAging.get("under30DaysCents")).longValue());
        assertEquals(50_000_000L, ((Number) arAging.get("over90DaysCents")).longValue());
        assertEquals(90_000_000L, ((Number) arAging.get("totalArCents")).longValue());

        // 校验每个律师桌面端个体单元的饱和度指标与分层合法性
        Set<String> validBands = Set.of("IDLE", "OPTIMAL", "SATURATED", "OVERLOADED");
        for (Map<String, Object> unit : units) {
            int idx = ((Number) unit.get("workloadIndex")).intValue();
            String band = (String) unit.get("workloadBand");
            assertTrue(idx >= 0 && idx <= 120, "workloadIndex 应在 [0, 120] 区间内");
            assertTrue(validBands.contains(band), "workloadBand 应为合法枚举值: " + band);
        }
    }
}
