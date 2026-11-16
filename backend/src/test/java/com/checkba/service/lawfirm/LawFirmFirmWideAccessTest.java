// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.lawfirm;

import com.checkba.model.entity.User;
import com.checkba.repository.UserRepository;
import com.checkba.service.AdminAccessService;
import com.checkba.service.ai.PluginService;
import com.checkba.service.collab.DirectoryUnavailableException;
import com.checkba.service.im.ImService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.TestPropertySource;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

/**
 * 全所数据（收费台账、全所看板、ERP/CSV 导出）的查看资格：REST 入口（PluginLawFirmController / LawFirmManagementController
 * 都走 LawFirmManagementService.execute / exportFinanceCsvFor）与 Agent 工具共用同一个判定 LawFirmAccessPolicy。
 * 普通成员被拒绝（总览只给与自己相关的行），系统管理员与律所管理员放行。
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@Import({LawFirmManagementService.class, LawFirmClientService.class, LawFirmConflictEngine.class, ImService.class, ObjectMapper.class,
        LawFirmAccessPolicy.class, AdminAccessService.class})
@TestPropertySource(properties = {
        "spring.datasource.url=jdbc:h2:mem:lawfirm-firmwide-access-test;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DEFAULT_NULL_ORDERING=HIGH;NON_KEYWORDS=VALUE;DB_CLOSE_DELAY=-1",
        "spring.datasource.driver-class-name=org.h2.Driver",
        "spring.datasource.username=sa",
        "spring.datasource.password=",
        "spring.jpa.database-platform=org.hibernate.dialect.H2Dialect",
        "spring.jpa.hibernate.ddl-auto=create-drop",
        "security.local-mode=false"
})
class LawFirmFirmWideAccessTest {

    @Autowired private LawFirmManagementService service;
    @Autowired private LawFirmAccessPolicy policy;
    @Autowired private UserRepository users;
    @MockBean private PluginService pluginService;
    @MockBean private LawFirmAuthority authority;

    private User member;
    private User other;
    private User admin;
    private User firmAdmin;

    private LawFirmManagementService target;

    @BeforeEach
    void setUp() {
        // service 是事务代理，开关要设在被代理的实例上
        target = org.springframework.test.util.AopTestUtils.getUltimateTargetObject(service);
        target.localMode = false;
        // 模拟服务器上已有旧台账数据（升级前写入）；拒绝用例里再关掉
        target.ledgerAvailable = true;
        policy.localMode = false;
        member = user("fw_member");
        other = user("fw_other");
        admin = users.findByUsername("admin").orElseGet(() -> user("admin"));
        firmAdmin = user("fw_firm_admin");
        doThrow(new DirectoryUnavailableException("directory down")).when(authority).current(any());
        doReturn(new LawFirmAuthority.Member(firmAdmin.getId(), "acc", "firm-1", "合伙人", true)).when(authority).current(firmAdmin.getId());
        doReturn(new LawFirmAuthority.Member(member.getId(), "acc2", "firm-1", "成员", false)).when(authority).current(member.getId());
        // 一人一单
        intake(member, "成员的案件");
        intake(other, "别人的案件");
    }

    private User user(String name) {
        User u = new User();
        u.setUsername(name);
        u.setDisplayName(name);
        u.setPassword("{noop}pw123456");
        u.setRole("USER");
        u.setSubscriptionType("PAID");
        u.setCreatedAt(LocalDateTime.now());
        u.setUpdatedAt(LocalDateTime.now());
        return users.saveAndFlush(u);
    }

    private void intake(User applicant, String title) {
        service.execute(applicant.getId(), null, "submitIntake",
                Map.of("title", title, "practiceArea", "LITIGATION", "clientName", title + "委托人", "counterpartyName", "无"));
    }

    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> allIntakes(Map<String, Object> overview) {
        return (List<Map<String, Object>>) overview.get("allIntakes");
    }

    @Test
    void plainMemberIsDeniedFirmWideLedgerAndSeesOnlyOwnRows() {
        assertFalse(policy.canViewFirmWide(member.getId()));
        // REST：总览不再回全所数据
        Map<String, Object> overview = service.execute(member.getId(), null, "overview", Map.of());
        assertEquals(Boolean.TRUE, overview.get("restricted"));
        assertEquals(1, allIntakes(overview).size());
        assertEquals("成员的案件", allIntakes(overview).get(0).get("title"));
        // REST：导出台账 / ERP 同步被拒（PluginLawFirmController 与 /finance/export-csv 都走这两处）
        assertThrows(IllegalArgumentException.class, () -> service.execute(member.getId(), null, "exportCsv", Map.of()));
        assertThrows(IllegalArgumentException.class, () -> service.execute(member.getId(), null, "financeExportCsv", Map.of()));
        assertThrows(IllegalArgumentException.class, () -> service.execute(member.getId(), null, "syncErp", Map.of()));
        assertThrows(IllegalArgumentException.class, () -> service.execute(member.getId(), null, "confirmErpSync", Map.of()));
        assertThrows(IllegalArgumentException.class, () -> service.exportFinanceCsvFor(member.getId()));
        // Agent 入口用的断言
        assertThrows(IllegalArgumentException.class, () -> service.requireFirmWide(member.getId()));
    }

    @Test
    void systemAdminAndFirmAdminSeeEverything() {
        for (User u : List.of(admin, firmAdmin)) {
            assertTrue(policy.canViewFirmWide(u.getId()), u.getUsername());
            Map<String, Object> overview = service.execute(u.getId(), null, "overview", Map.of());
            assertEquals(Boolean.FALSE, overview.get("restricted"));
            assertEquals(2, allIntakes(overview).size());
            assertTrue(service.execute(u.getId(), null, "exportCsv", Map.of()).containsKey("csv"));
            assertDoesNotThrow(() -> service.exportFinanceCsvFor(u.getId()));
        }
    }

    @Test
    void directoryFailureDeniesInsteadOfFailingOpen() {
        // authority.current(any) 抛 DirectoryUnavailableException：按无资格处理
        assertFalse(policy.canViewFirmWide(other.getId()));
    }

    @Test
    void desktopLocalModeIsTheWholeFirm() {
        policy.localMode = true;
        assertTrue(policy.canViewFirmWide(other.getId()));
    }

    /** 服务器（local-mode=false）上本机台账整体不可用：别所管理员读不到总览/CSV，无关用户也写不了。 */
    @Test
    void serverProfileRefusesTheWholeLocalLedger() {
        User otherFirmAdmin = user("fw_firm_b_admin");
        doReturn(new LawFirmAuthority.Member(otherFirmAdmin.getId(), "acc3", "firm-2", "合伙人", true)).when(authority).current(otherFirmAdmin.getId());
        target.ledgerAvailable = true;
        Long invoiceId = invoiceOf(member);
        Long intakeId = intakeIdOf("成员的案件");
        target.ledgerAvailable = false;

        for (User u : List.of(otherFirmAdmin, admin, other)) {
            for (String act : List.of("overview", "list", "dashboard", "exportCsv", "financeExportCsv", "syncErp", "confirmErpSync",
                    "precheckConflict", "conflictPreview", "submitIntake", "submitInvoice", "seedDemo")) {
                IllegalArgumentException e = assertThrows(IllegalArgumentException.class,
                        () -> service.execute(u.getId(), null, act, Map.of("title", "x", "clientName", "成员的案件委托人", "amountYuan", 100)), act);
                assertTrue(e.getMessage().contains("本机收费台账仅在桌面端可用") || e.getMessage().contains("desktop"), act + ": " + e.getMessage());
            }
            assertThrows(IllegalArgumentException.class, () -> service.exportFinanceCsvFor(u.getId()));
            assertThrows(IllegalArgumentException.class, () -> service.execute(u.getId(), null, "issueInvoice", Map.of("invoiceId", invoiceId, "invoiceNumber", "1")));
            assertThrows(IllegalArgumentException.class, () -> service.execute(u.getId(), null, "voidInvoice", Map.of("invoiceId", invoiceId)));
            assertThrows(IllegalArgumentException.class, () -> service.execute(u.getId(), null, "recordCollection", Map.of("invoiceId", invoiceId, "amountYuan", 1)));
            assertThrows(IllegalArgumentException.class, () -> service.execute(u.getId(), null, "committeeReview", Map.of("intakeId", intakeId)));
            assertThrows(IllegalArgumentException.class, () -> service.execute(u.getId(), null, "respondClearance", Map.of("clearanceId", 1)));
        }
        assertThrows(IllegalArgumentException.class, () -> service.listProjectMatters(987654L));
        assertThrows(IllegalArgumentException.class, service::requireLocalLedger);
        // 数据没被改动
        target.ledgerAvailable = true;
        Map<String, Object> inv = invoiceView(invoiceId);
        assertEquals("PENDING_APPROVAL", inv.get("status"));
    }

    /** 纵深防御：即便台账可用，无关的普通成员也不能开票/作废/核销/终审别人的单子；管理员可以。 */
    @Test
    void unrelatedMemberCannotIssueVoidCollectOrFinalize() {
        Long invoiceId = invoiceOf(member);
        Long intakeId = intakeIdOf("成员的案件");
        User stranger = user("fw_stranger");
        doReturn(new LawFirmAuthority.Member(stranger.getId(), "acc4", "firm-1", "成员", false)).when(authority).current(stranger.getId());
        assertThrows(IllegalStateException.class, () -> service.execute(stranger.getId(), null, "issueInvoice", Map.of("invoiceId", invoiceId, "invoiceNumber", "1")));
        assertThrows(IllegalStateException.class, () -> service.execute(stranger.getId(), null, "voidInvoice", Map.of("invoiceId", invoiceId)));
        assertThrows(IllegalStateException.class, () -> service.execute(stranger.getId(), null, "recordCollection", Map.of("invoiceId", invoiceId, "amountYuan", 1)));
        assertThrows(IllegalStateException.class, () -> service.execute(stranger.getId(), null, "recordCollection", Map.of("amountYuan", 1)));
        assertThrows(IllegalStateException.class, () -> service.execute(stranger.getId(), null, "committeeReview", Map.of("intakeId", intakeId)));
        assertEquals("PENDING_APPROVAL", invoiceView(invoiceId).get("status"));
        // 申请人本人可以核销自己的发票；律所管理员可以终审
        assertDoesNotThrow(() -> service.execute(member.getId(), null, "recordCollection", Map.of("invoiceId", invoiceId, "amountYuan", 1)));
        assertDoesNotThrow(() -> service.execute(firmAdmin.getId(), null, "issueInvoice", Map.of("invoiceId", invoiceId, "invoiceNumber", "12345678901234567890")));
        assertDoesNotThrow(() -> service.execute(firmAdmin.getId(), null, "committeeReview", Map.of("intakeId", intakeId, "createWorkbenchProject", false)));
    }

    /** 桌面单机：一人身兼申请人/财务/委员，行为不变。 */
    @Test
    void desktopSingleUserKeepsFullLedger() {
        target.localMode = true;
        policy.localMode = true;
        Long invoiceId = invoiceOf(other);
        Long intakeId = intakeIdOf("别人的案件");
        assertDoesNotThrow(() -> service.execute(member.getId(), null, "overview", Map.of()));
        assertDoesNotThrow(() -> service.exportFinanceCsvFor(member.getId()));
        assertDoesNotThrow(() -> service.execute(member.getId(), null, "issueInvoice", Map.of("invoiceId", invoiceId, "invoiceNumber", "12345678901234567890")));
        assertDoesNotThrow(() -> service.execute(member.getId(), null, "recordCollection", Map.of("invoiceId", invoiceId, "amountYuan", 1)));
        assertDoesNotThrow(() -> service.execute(member.getId(), null, "voidInvoice", Map.of("invoiceId", invoiceId)));
        assertDoesNotThrow(() -> service.execute(member.getId(), null, "committeeReview", Map.of("intakeId", intakeId, "createWorkbenchProject", false)));
    }

    private Long invoiceOf(User applicant) {
        @SuppressWarnings("unchecked")
        Map<String, Object> inv = (Map<String, Object>) service.execute(applicant.getId(), null, "submitInvoice",
                Map.of("amountYuan", 1000, "clientName", "委托人", "invoiceType", "DIGITAL_NORMAL")).get("invoice");
        return ((Number) inv.get("id")).longValue();
    }

    @SuppressWarnings("unchecked")
    private Long intakeIdOf(String title) {
        return allIntakes(service.execute(admin.getId(), null, "overview", Map.of())).stream()
                .filter(i -> title.equals(i.get("title"))).map(i -> ((Number) i.get("id")).longValue()).findFirst().orElseThrow();
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> invoiceView(Long invoiceId) {
        return ((List<Map<String, Object>>) service.execute(admin.getId(), null, "overview", Map.of()).get("invoices")).stream()
                .filter(i -> invoiceId.equals(((Number) i.get("id")).longValue())).findFirst().orElseThrow();
    }

    @Test
    void projectMattersExposeOnlyThatProjectAndNoLedger() {
        assertTrue(service.listProjectMatters(987654L).isEmpty());
    }
}
