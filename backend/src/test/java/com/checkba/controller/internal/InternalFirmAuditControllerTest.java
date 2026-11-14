// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.controller.internal;

import com.checkba.model.entity.AccountBinding;
import com.checkba.model.entity.User;
import com.checkba.repository.AccountBindingRepository;
import com.checkba.repository.UserRepository;
import com.checkba.service.audit.FirmAuditLog;
import com.checkba.service.collab.AccountDirectoryClient;
import com.checkba.service.collab.DirectoryAccount;
import com.checkba.service.collab.DirectoryReply;
import com.checkba.service.collab.OrgMembership;
import com.checkba.service.lawfirm.LawFirmAuthority;
import com.checkba.service.lawfirm.LawFirmCloudService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Import;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.test.context.TestPropertySource;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.*;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;

/** S20：官网经内部口上报的律所事件——闸门（裸 404）、白名单、幂等、写进同一份审计日志。 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@Import({FirmAuditLog.class, LawFirmAuthority.class, LawFirmCloudService.class})
@TestPropertySource(properties = {
        "spring.datasource.url=jdbc:h2:mem:firm-audit-ingest;MODE=PostgreSQL;NON_KEYWORDS=VALUE;DB_CLOSE_DELAY=-1",
        "spring.datasource.driver-class-name=org.h2.Driver", "spring.datasource.username=sa", "spring.datasource.password=",
        "spring.jpa.database-platform=org.hibernate.dialect.H2Dialect", "spring.jpa.hibernate.ddl-auto=create-drop",
        "security.local-mode=false"
})
@Transactional(propagation = Propagation.NOT_SUPPORTED)
class InternalFirmAuditControllerTest {

    static final String SECRET = "ingest-secret-for-tests";

    @Autowired FirmAuditLog audit;
    @Autowired LawFirmCloudService cloud;
    @Autowired UserRepository users;
    @Autowired AccountBindingRepository bindings;
    @MockBean AccountDirectoryClient directory;

    final Map<String, OrgMembership> membership = new HashMap<>();
    String firm;
    Long admin;
    InternalFirmAuditController controller;

    @BeforeEach
    void setUp() {
        firm = "firm-" + UUID.randomUUID();
        admin = user(true);
        when(directory.configured()).thenReturn(true);
        when(directory.lookupByAccountId(anyString(), anyString())).thenAnswer(c -> {
            String me = c.getArgument(0), cand = c.getArgument(1);
            return new DirectoryReply(true, new DirectoryAccount(cand, cand, cand, null),
                    membership.getOrDefault(me, OrgMembership.NONE), membership.getOrDefault(cand, OrgMembership.NONE));
        });
        controller = new InternalFirmAuditController(true, SECRET, audit, bindings);
    }

    Long user(boolean firmAdmin) {
        User u = new User();
        u.setUsername("ingest-" + UUID.randomUUID());
        u.setDisplayName("管理员");
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
        membership.put(b.getExternalAccountId(), new OrgMembership("team-" + firm, firm, firmAdmin));
        return id;
    }

    static MockHttpServletRequest from(String addr) {
        MockHttpServletRequest r = new MockHttpServletRequest();
        r.setRemoteAddr(addr);
        return r;
    }

    Map<String, Object> body(String eventId, String action) {
        Map<String, Object> b = new LinkedHashMap<>();
        b.put("eventId", eventId);
        b.put("firmId", firm);
        b.put("action", action);
        b.put("occurredAt", "2026-11-14T10:00:00.123Z");
        b.put("actorAccountId", "website-only-account");
        b.put("actorName", "王律师");
        b.put("targetType", "ACCOUNT");
        b.put("targetId", "acc-2");
        b.put("targetLabel", "李律师");
        b.put("sourceIp", "203.0.113.9");
        b.put("userAgent", "Mozilla/5.0");
        b.put("detail", Map.of("fromRole", "MEMBER", "toRole", "ADMIN", "password", "must-not-be-stored"));
        return b;
    }

    @SuppressWarnings("unchecked")
    List<Map<String, Object>> rows() {
        audit.flush();
        return (List<Map<String, Object>>) cloud.execute(admin, LawFirmCloudService.AUDIT_LIST, Map.of()).get("events");
    }

    @Test
    void everyGateAnswersABare404() {
        Map<String, Object> b = body(UUID.randomUUID().toString(), "FIRM_ROLE_CHANGED");
        assertEquals(404, controller.ingest(b, "wrong", from("127.0.0.1")).getStatusCode().value());
        assertEquals(404, controller.ingest(b, null, from("127.0.0.1")).getStatusCode().value());
        assertEquals(404, controller.ingest(b, SECRET, from("198.51.100.7")).getStatusCode().value(), "not loopback");
        assertEquals(404, new InternalFirmAuditController(false, SECRET, audit, bindings).ingest(b, SECRET, from("127.0.0.1")).getStatusCode().value(), "serve off");
        assertEquals(404, new InternalFirmAuditController(true, "", audit, bindings).ingest(b, "", from("127.0.0.1")).getStatusCode().value(), "no secret");
        assertNull(controller.ingest(b, "wrong", from("127.0.0.1")).getBody());
        assertTrue(rows().isEmpty());
    }

    @Test
    void aWebsiteEventLandsInTheFirmLogOnceEvenWhenRetried() {
        String id = UUID.randomUUID().toString();
        assertEquals(200, controller.ingest(body(id, "FIRM_ROLE_CHANGED"), SECRET, from("127.0.0.1")).getStatusCode().value());
        assertEquals(200, controller.ingest(body(id, "FIRM_ROLE_CHANGED"), SECRET, from("::1")).getStatusCode().value());

        List<Map<String, Object>> rows = rows();
        assertEquals(1, rows.size(), "same eventId is written once");
        Map<String, Object> r = rows.get(0);
        assertEquals("FIRM_ROLE_CHANGED", r.get("action"));
        assertEquals("MEMBERSHIP", r.get("category"));
        assertEquals("website", r.get("source"));
        assertEquals("王律师", r.get("actorName"));
        assertEquals("李律师", r.get("targetLabel"));
        assertEquals("203.0.113.9", r.get("sourceIp"));
        assertEquals("2026-11-14T10:00:00.123Z", r.get("occurredAt"));
        assertEquals(Map.of("fromRole", "MEMBER", "toRole", "ADMIN", "actorAccountId", "website-only-account"), r.get("detail"),
                "detail keys outside the allow-list are dropped");
        assertEquals(true, cloud.execute(admin, LawFirmCloudService.AUDIT_VERIFY, Map.of()).get("ok"));
    }

    @Test
    void loginFailuresAreFailuresAndUnknownActionsOrBadIdsAreRejected() {
        controller.ingest(body(UUID.randomUUID().toString(), "WEBSITE_LOGIN_FAILED"), SECRET, from("127.0.0.1"));
        assertEquals("FAILURE", rows().get(0).get("outcome"));
        assertEquals(400, controller.ingest(body(UUID.randomUUID().toString(), "DROP_TABLE"), SECRET, from("127.0.0.1")).getStatusCode().value());
        assertEquals(400, controller.ingest(body("x", "FIRM_CREATED"), SECRET, from("127.0.0.1")).getStatusCode().value());
        Map<String, Object> noFirm = body(UUID.randomUUID().toString(), "FIRM_CREATED");
        noFirm.put("firmId", "a firm; with spaces");
        assertEquals(400, controller.ingest(noFirm, SECRET, from("127.0.0.1")).getStatusCode().value());
        assertEquals(1, rows().size());
    }
}
