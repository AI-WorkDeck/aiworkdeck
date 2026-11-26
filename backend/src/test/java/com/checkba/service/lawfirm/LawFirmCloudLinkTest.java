// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.lawfirm;

import com.checkba.model.entity.User;
import com.checkba.repository.UserRepository;
import com.checkba.repository.lawfirm.LawFirmMatterIntakeRepository;
import com.checkba.service.AdminAccessService;
import com.checkba.service.ai.PluginService;
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
import java.util.HashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

/** C19：本机收案关联律所云端利冲后，本机进度跟随云端终审结论；只认本人能看到全文的云端记录。 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@Import({LawFirmManagementService.class, LawFirmClientService.class, LawFirmConflictEngine.class, ImService.class, ObjectMapper.class,
        LawFirmAccessPolicy.class, AdminAccessService.class})
@TestPropertySource(properties = {
        "spring.datasource.url=jdbc:h2:mem:lawfirm-cloud-link-test;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DEFAULT_NULL_ORDERING=HIGH;NON_KEYWORDS=VALUE;DB_CLOSE_DELAY=-1",
        "spring.datasource.driver-class-name=org.h2.Driver",
        "spring.datasource.username=sa",
        "spring.datasource.password=",
        "spring.jpa.database-platform=org.hibernate.dialect.H2Dialect",
        "spring.jpa.hibernate.ddl-auto=create-drop",
        "security.local-mode=true"
})
class LawFirmCloudLinkTest {
    private static final String RECORD = "12345678-1234-1234-1234-123456789012";

    @Autowired private LawFirmManagementService service;
    @Autowired private UserRepository users;
    @Autowired private LawFirmMatterIntakeRepository intakes;
    @MockBean private PluginService pluginService;
    @MockBean private LawFirmAuthority authority;
    @MockBean private LawFirmWorkflowGateway gateway;

    private User partner;

    @BeforeEach
    void setUp() {
        partner = users.findByUsername("cl_partner").orElseGet(() -> {
            User u = new User();
            u.setUsername("cl_partner"); u.setDisplayName("合成合伙人"); u.setPassword("{noop}pw123456");
            u.setRole("USER"); u.setSubscriptionType("PAID");
            u.setCreatedAt(LocalDateTime.now()); u.setUpdatedAt(LocalDateTime.now());
            return users.saveAndFlush(u);
        });
    }

    private Long pendingIntake(String title) {
        service.execute(partner.getId(), null, "submitIntake",
                Map.of("title", title, "practiceArea", "LITIGATION", "clientName", "合成委托人", "counterpartyName", "无"));
        var intake = intakes.findAll().stream().filter(i -> title.equals(i.getTitle())).findFirst().orElseThrow();
        intake.setStatus("PENDING_COMMITTEE_REVIEW");
        return intakes.saveAndFlush(intake).getId();
    }

    private void cloud(String status, boolean full) {
        Map<String, Object> view = new HashMap<>(Map.of("id", RECORD, "title", "合成案件", "status", status));
        if (full) { view.put("clientName", "合成委托人"); view.put("decisionComment", "委员核查后通过"); }
        doReturn(view).when(gateway).execute(eq(partner.getId()), eq("workflowDetail"), any());
    }

    @Test
    void approvedCloudDecisionClosesTheLocalCommitteeStep() {
        Long id = pendingIntake("合成案件甲");
        cloud("APPROVED", true);
        service.execute(partner.getId(), null, "linkCloudClearance", Map.of("intakeId", id, "recordId", RECORD));
        var intake = intakes.findById(id).orElseThrow();
        assertEquals("APPROVED_FILED", intake.getStatus());
        assertEquals(RECORD, intake.getCloudWorkflowId());
        assertEquals("APPROVED", intake.getCloudWorkflowStatus());
        assertTrue(intake.getCommitteeComment().contains("委员核查后通过"));
        verify(gateway).execute(partner.getId(), "workflowDetail", Map.of("recordId", RECORD));
    }

    @Test
    void pendingCloudRecordIsLinkedAndLaterResyncedWithoutRecordId() {
        Long id = pendingIntake("合成案件乙");
        cloud("PENDING_COMMITTEE_REVIEW", true);
        service.execute(partner.getId(), null, "linkCloudClearance", Map.of("intakeId", id, "recordId", RECORD));
        assertEquals("PENDING_COMMITTEE_REVIEW", intakes.findById(id).orElseThrow().getStatus());
        cloud("REJECTED", true);
        service.execute(partner.getId(), null, "linkCloudClearance", Map.of("intakeId", id));
        assertEquals("REJECTED_CONFLICT", intakes.findById(id).orElseThrow().getStatus());
    }

    @Test
    void recordsTheUserCannotSeeInFullAreRefused() {
        Long id = pendingIntake("合成案件丙");
        cloud("APPROVED", false);
        assertThrows(IllegalStateException.class, () ->
                service.execute(partner.getId(), null, "linkCloudClearance", Map.of("intakeId", id, "recordId", RECORD)));
        var intake = intakes.findById(id).orElseThrow();
        assertEquals("PENDING_COMMITTEE_REVIEW", intake.getStatus());
        assertNull(intake.getCloudWorkflowId());
    }
}
