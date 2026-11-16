// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.controller;

import com.checkba.model.entity.AccountBinding;
import com.checkba.model.entity.User;
import com.checkba.repository.AccountBindingRepository;
import com.checkba.repository.UserRepository;
import com.checkba.service.AuthAbuseGuard;
import com.checkba.service.UserService;
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
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.LocalDateTime;
import java.util.*;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * S20 failure path: a wrong password is a refusal, and a refusal must reach the firm audit log even when the request
 * runs inside a transaction that rolls back (today the login handler has none; this pins that it must not matter).
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@Import({FirmAuditLog.class, LawFirmAuthority.class, LawFirmCloudService.class})
@TestPropertySource(properties = {
        "spring.datasource.url=jdbc:h2:mem:auth-failed-audit;MODE=PostgreSQL;NON_KEYWORDS=VALUE;DB_CLOSE_DELAY=-1",
        "spring.datasource.driver-class-name=org.h2.Driver", "spring.datasource.username=sa", "spring.datasource.password=",
        "spring.jpa.database-platform=org.hibernate.dialect.H2Dialect", "spring.jpa.hibernate.ddl-auto=create-drop",
        "security.local-mode=false"
})
@Transactional(propagation = Propagation.NOT_SUPPORTED)
class AuthControllerFailedLoginAuditTest {

    @Autowired FirmAuditLog audit;
    @Autowired LawFirmCloudService cloud;
    @Autowired UserRepository users;
    @Autowired AccountBindingRepository bindings;
    @Autowired PlatformTransactionManager tx;
    @MockBean AccountDirectoryClient directory;

    final Map<String, OrgMembership> membership = new HashMap<>();
    String firm;
    Long admin;
    User lawyer;
    AuthController controller;

    @BeforeEach
    void setUp() {
        firm = "firm-" + UUID.randomUUID();
        admin = user(true).getId();
        lawyer = user(false);
        when(directory.configured()).thenReturn(true);
        when(directory.lookupByAccountId(anyString(), anyString())).thenAnswer(c -> {
            String me = c.getArgument(0), cand = c.getArgument(1);
            return new DirectoryReply(true, new DirectoryAccount(cand, cand, cand, null),
                    membership.getOrDefault(me, OrgMembership.NONE), membership.getOrDefault(cand, OrgMembership.NONE));
        });
        UserService userService = mock(UserService.class);
        when(userService.login(anyString(), anyString())).thenThrow(new IllegalArgumentException("用户名或密码错误"));
        when(userService.getUserByUsername(eq(lawyer.getUsername()))).thenReturn(Optional.of(lawyer));
        controller = new AuthController(userService, null, null, null, new AuthAbuseGuard(false, "open"), null, null, null,
                null, null, false, null, mock(com.checkba.service.account.AccountDeletionService.class), null);
        controller.setFirmAudit(audit);
    }

    User user(boolean firmAdmin) {
        User u = new User();
        u.setUsername("auth-audit-" + UUID.randomUUID());
        u.setDisplayName(firmAdmin ? "管理员" : "律师");
        u.setPassword("synthetic");
        u.setRole("USER");
        u.setSubscriptionType("FREE");
        u.setCreatedAt(LocalDateTime.now());
        u.setUpdatedAt(LocalDateTime.now());
        u = users.saveAndFlush(u);
        AccountBinding b = new AccountBinding();
        b.setUserId(u.getId());
        b.setExternalAccountId("account-" + u.getId());
        b.setCreatedAt(LocalDateTime.now());
        bindings.saveAndFlush(b);
        membership.put(b.getExternalAccountId(), new OrgMembership("team-" + firm, firm, firmAdmin));
        return u;
    }

    static MockHttpServletRequest http() {
        MockHttpServletRequest r = new MockHttpServletRequest();
        r.setRemoteAddr("9.9.9.9");
        return r;
    }

    @SuppressWarnings("unchecked")
    List<String> actions() {
        audit.flush();
        List<Map<String, Object>> rows = (List<Map<String, Object>>) cloud.execute(admin, LawFirmCloudService.AUDIT_LIST, Map.of()).get("events");
        return rows.stream().map(r -> r.get("action") + "/" + r.get("outcome") + "/" + ((Map<?, ?>) r.get("detail")).get("via")).toList();
    }

    @Test
    void wrongPasswordOnLoginIsRecordedEvenWhenTheRequestTransactionRollsBack() {
        AuthController.LoginRequest req = new AuthController.LoginRequest();
        req.setUsername(lawyer.getUsername());
        req.setPassword("wrong");
        new TransactionTemplate(tx).executeWithoutResult(status -> {
            assertEquals(1, controller.login(req, http()).get("code"));
            status.setRollbackOnly();
        });
        assertEquals(List.of("LOGIN_FAILED/FAILURE/password"), actions());
    }

    @Test
    void wrongPasswordOnDeviceTokenIsRecordedEvenWhenTheRequestTransactionRollsBack() {
        new TransactionTemplate(tx).executeWithoutResult(status -> {
            assertEquals(1, controller.issueDeviceToken(Map.of("username", lawyer.getUsername(), "password", "wrong"), http()).get("code"));
            status.setRollbackOnly();
        });
        assertEquals(List.of("LOGIN_FAILED/FAILURE/device-token"), actions());
    }
}
