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
@Import({LawFirmManagementService.class, LawFirmConflictEngine.class, ImService.class, ObjectMapper.class,
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

    @BeforeEach
    void setUp() {
        service.localMode = false;
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

    @Test
    void projectMattersExposeOnlyThatProjectAndNoLedger() {
        assertTrue(service.listProjectMatters(987654L).isEmpty());
    }
}
