// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.im;

import com.checkba.exception.RateLimitedException;
import com.checkba.model.entity.User;
import com.checkba.repository.UserRepository;
import com.checkba.service.UserRateLimiter;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.mock;

/** The real bean wiring: the limiter reaches ImService and its configured send limit applies (B4, server mode). */
@DataJpaTest(showSql = false)
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@TestPropertySource(properties = {
        "spring.datasource.url=jdbc:h2:mem:im-rate-wiring;MODE=PostgreSQL;NON_KEYWORDS=VALUE;DB_CLOSE_DELAY=-1",
        "spring.datasource.driver-class-name=org.h2.Driver", "spring.datasource.username=sa", "spring.datasource.password=",
        "spring.jpa.database-platform=org.hibernate.dialect.H2Dialect", "spring.jpa.hibernate.ddl-auto=create-drop",
        "security.local-mode=false", "security.rate-limit.im-send-per-minute=3"
})
@Import({ImService.class, com.checkba.service.ProjectMemberService.class, UserRateLimiter.class})
@Transactional(propagation = Propagation.NOT_SUPPORTED)
class ImRateLimitWiringTest {
    @Autowired ImService service;
    @Autowired UserRepository users;

    @Test
    void theConfiguredSendLimitApplies() {
        ReflectionTestUtils.setField(service, "agents", mock(ImAgentService.class));
        assertNotNull(ReflectionTestUtils.getField(service, "rateLimiter"), "UserRateLimiter must be injected into ImService");
        User u = new User(); u.setUsername("rl-" + UUID.randomUUID()); u.setPassword("x"); u.setDisplayName("合成律师");
        u.setRole("USER"); u.setSubscriptionType("FREE"); u.setCreatedAt(LocalDateTime.now()); u.setUpdatedAt(LocalDateTime.now());
        Long me = users.saveAndFlush(u).getId();
        @SuppressWarnings("unchecked")
        String id = String.valueOf(((Map<String, Object>) service.execute(me, "create", Map.of("type", "GROUP", "title", "合成群"))).get("id"));
        for (int i = 0; i < 3; i++) service.executeRequest(me, "send", Map.of("conversationId", id, "clientMessageId", "m" + i, "text", "x"));
        assertThrows(RateLimitedException.class, () -> service.executeRequest(me, "send", Map.of("conversationId", id, "clientMessageId", "m4", "text", "x")));
    }
}
