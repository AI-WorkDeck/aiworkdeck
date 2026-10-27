// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.plugin;

import com.checkba.model.entity.PluginAgentSession;
import com.checkba.repository.PluginAgentSessionRepository;
import jakarta.persistence.EntityManager;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.test.context.TestPropertySource;

import static org.junit.jupiter.api.Assertions.*;

@DataJpaTest(showSql = false)
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@TestPropertySource(properties = {
        "spring.datasource.url=jdbc:h2:mem:plugin-agent-sessions;MODE=PostgreSQL;NON_KEYWORDS=VALUE;DB_CLOSE_DELAY=-1",
        "spring.datasource.driver-class-name=org.h2.Driver", "spring.datasource.username=sa", "spring.datasource.password=",
        "spring.jpa.database-platform=org.hibernate.dialect.H2Dialect", "spring.jpa.hibernate.ddl-auto=create-drop"
})
class PluginAgentSessionPersistenceTest {
    @Autowired PluginAgentSessionRepository sessions;
    @Autowired EntityManager em;

    @Test
    void bindingSurvivesReloadAndEveryIdentityDimensionIsScoped() {
        var original = row("dpia", 7L, 1L, "conv-first");
        sessions.saveAndFlush(original);
        sessions.saveAndFlush(row("other", 7L, 1L, "conv-other-plugin"));
        sessions.saveAndFlush(row("dpia", 8L, 1L, "conv-other-user"));
        sessions.saveAndFlush(row("dpia", 7L, 2L, "conv-other-project"));
        em.clear();
        assertEquals("conv-first", sessions.findByPluginIdAndUserIdAndProjectIdAndSessionKey(
                "dpia", 7L, 1L, "session-same-key").orElseThrow().getConversationId());
        assertTrue(sessions.findByPluginIdAndUserIdAndProjectIdAndSessionKey(
                "dpia", 8L, 2L, "session-same-key").isEmpty());
    }

    @Test
    void databaseRejectsDuplicateBindingEvenWhenConversationDiffers() {
        sessions.saveAndFlush(row("dpia", 7L, 1L, "conv-first"));
        em.clear();
        assertThrows(DataIntegrityViolationException.class,
                () -> sessions.saveAndFlush(row("dpia", 7L, 1L, "conv-collision")));
    }

    private PluginAgentSession row(String plugin, long user, long project, String conversation) {
        var row = new PluginAgentSession();
        row.setPluginId(plugin); row.setUserId(user); row.setProjectId(project);
        row.setSessionKey("session-same-key"); row.setConversationId(conversation); row.setTitle("DPIA");
        return row;
    }
}
