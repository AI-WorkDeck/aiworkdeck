// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.im;

import com.checkba.service.ai.tools.WebTools;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.http.MediaType.APPLICATION_JSON;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

/**
 * B4: the project-chat send limit on the exact request path the case server serves (POST /api/im/action with a
 * session), under the {@code case} profile that staging and production run. Only the database is swapped for H2.
 */
@SpringBootTest(properties = {
        "spring.datasource.url=jdbc:h2:mem:im-rate-case;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DEFAULT_NULL_ORDERING=HIGH;NON_KEYWORDS=VALUE;DB_CLOSE_DELAY=-1",
        "spring.datasource.driver-class-name=org.h2.Driver", "spring.datasource.username=sa", "spring.datasource.password=",
        "spring.jpa.database-platform=org.hibernate.dialect.H2Dialect", "spring.jpa.hibernate.ddl-auto=create-drop",
        "spring.flyway.enabled=false",
        // synthetic, test-only (the case profile refuses to start without one)
        "security.platform-key-secret=synthetic-test-secret-for-im-rate-limit-0123456789abcdef"
})
@AutoConfigureMockMvc
@ActiveProfiles("case")
class ImRateLimitCaseProfileIntegrationTest {
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper om;
    @MockBean WebTools webTools;

    @Autowired com.checkba.repository.UserRepository users;
    @Autowired com.checkba.service.UserSessionService sessions;

    /** The case server has no self-registration: a user row plus a real session, as an account login would leave. */
    String register() {
        com.checkba.model.entity.User u = new com.checkba.model.entity.User();
        u.setUsername("rl_" + System.nanoTime()); u.setPassword("not-a-credential"); u.setDisplayName("合成律师");
        u.setRole("USER"); u.setSubscriptionType("FREE");
        u.setCreatedAt(java.time.LocalDateTime.now()); u.setUpdatedAt(java.time.LocalDateTime.now());
        return sessions.issue(users.saveAndFlush(u).getId());
    }

    JsonNode im(String sid, String action, Map<String, Object> params, int[] status) throws Exception {
        var res = mvc.perform(post("/api/im/action").header("X-Session-Id", sid).contentType(APPLICATION_JSON)
                .content(om.writeValueAsString(Map.of("action", action, "params", params)))).andReturn().getResponse();
        if (status != null) status[0] = res.getStatus();
        return om.readTree(res.getContentAsString());
    }

    @Test
    void sendsBeyondTheDefaultLimitGetA429OnTheCaseServerPath() throws Exception {
        String sid = register();
        String conversation = im(sid, "create", Map.of("type", "GROUP", "title", "合成群"), null).path("data").path("id").asText();
        assertFalse(conversation.isEmpty());
        int[] status = {0};
        JsonNode last = null;
        int sent = 0;
        for (; sent < 40; sent++) {
            last = im(sid, "send", Map.of("conversationId", conversation, "clientMessageId", UUID.randomUUID().toString(), "text", "合成消息 " + sent), status);
            if (status[0] == 429) break;
        }
        assertEquals(429, status[0], "no 429 after " + sent + " sends; last reply " + last);
        assertEquals(4290, last.path("code").asInt());
        assertEquals("RATE_LIMITED", last.path("reason").asText());
        assertTrue(sent >= 30 && sent <= 31, "the default limit is 30 per minute, refused at send " + (sent + 1));
    }
}
