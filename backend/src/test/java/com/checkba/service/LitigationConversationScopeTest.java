// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service;

import com.checkba.model.entity.ProjectAiMessage;
import com.checkba.repository.*;
import com.checkba.service.ai.ConversationIssuanceService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.boot.test.autoconfigure.orm.jpa.TestEntityManager;
import org.springframework.test.context.TestPropertySource;
import java.util.List;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.mock;

@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@TestPropertySource(properties = {
        "spring.datasource.url=jdbc:h2:mem:litigation-scope;MODE=PostgreSQL;NON_KEYWORDS=VALUE;DB_CLOSE_DELAY=-1",
        "spring.datasource.driver-class-name=org.h2.Driver", "spring.datasource.username=sa", "spring.datasource.password=",
        "spring.jpa.database-platform=org.hibernate.dialect.H2Dialect", "spring.jpa.hibernate.ddl-auto=create-drop"
})
class LitigationConversationScopeTest {
    @Autowired ProjectAiMessageRepository repository;
    @Autowired TestEntityManager em;
    ConversationIssuanceService issuance;
    ProjectAiMessageService service;
    static final String SCOPE = "litigation-visual";

    @BeforeEach void setup() {
        issuance = new ConversationIssuanceService(false, false);
        service = service(issuance);
    }
    ProjectAiMessageService service(ConversationIssuanceService issuer) {
        return new ProjectAiMessageService(repository, issuer, mock(AgentRunRecordRepository.class), mock(UserRepository.class));
    }
    String conversation(long project, long owner, String scope) {
        String id = issuance.issue(owner, project, scope);
        service.saveMessage(Long.toString(project), owner, id, "USER", "synthetic request");
        service.upsertAssistantMessage(Long.toString(project), owner, id, null, "synthetic answer");
        return id;
    }
    List<String> ids(List<Object[]> rows) { return rows.stream().map(r -> r[0].toString()).toList(); }

    @Test void dedicatedHistorySurvivesReloadAndIsExcludedFromBothGeneralLists() {
        String ordinary = conversation(42, 7, null);
        String dedicated = conversation(42, 7, SCOPE);
        conversation(42, 8, SCOPE);
        conversation(43, 7, SCOPE);
        em.flush(); em.clear();
        assertEquals(List.of(ordinary), ids(repository.findConversationSummaries(42L, 7L)));
        assertTrue(service.listByProjectAndUser(42L, 7L).stream().allMatch(m -> ordinary.equals(m.getConversationId())));
        assertEquals(List.of(ordinary), ids(repository.findProjectConversationSummaries(42L, null, null)));
        assertEquals(List.of(dedicated), ids(repository.findScopedConversationSummaries(42L, 7L, SCOPE)));
        var restarted = service(new ConversationIssuanceService(false, false));
        assertEquals(SCOPE, restarted.conversationScopeOf(dedicated));
        assertEquals(2, restarted.listByConversationId(dedicated).size());
        restarted.saveMessage("42", 7L, dedicated, "USER", "next question");
        assertTrue(repository.findByConversationIdOrderByCreatedAtAsc(dedicated).stream()
                .allMatch(m -> SCOPE.equals(m.getConversationScope())));
        assertFalse(restarted.canUseConversation(dedicated, 8L));
        assertTrue(restarted.canUseConversation(dedicated, 7L));
    }

    @Test void explicitAdoptionPreservesLegacyMessagesAndChecksOwnerProjectAndMirror() {
        String legacy = conversation(42, 7, null);
        assertFalse(service.adoptConversationScope(legacy, 8L, 42L, SCOPE));
        assertFalse(service.adoptConversationScope(legacy, 7L, 43L, SCOPE));
        assertFalse(service.adoptConversationScope("unknown", 7L, 42L, SCOPE));
        assertTrue(service.adoptConversationScope(legacy, 7L, 42L, SCOPE));
        em.flush(); em.clear();
        assertTrue(repository.findConversationSummaries(42L, 7L).isEmpty());
        assertEquals(2, repository.findByConversationIdOrderByCreatedAtAsc(legacy).size());
        assertEquals(SCOPE, service(new ConversationIssuanceService(false, false)).conversationScopeOf(legacy));
        String mirror = conversation(42, 7, null);
        ProjectAiMessage first = repository.findFirstByConversationId(mirror).orElseThrow();
        first.setSourceChannel("office-word"); repository.saveAndFlush(first);
        assertFalse(service.adoptConversationScope(mirror, 7L, 42L, SCOPE));
    }

    @Test void adoptionOfIssuedEmptyConversationRequiresOriginalProjectAndOwner() {
        String id = issuance.issue(7L, 42L);
        assertFalse(service.adoptConversationScope(id, 8L, 42L, SCOPE));
        assertFalse(service.adoptConversationScope(id, 7L, 43L, SCOPE));
        assertTrue(service.adoptConversationScope(id, 7L, 42L, SCOPE));
        service.saveUserAndAssistantMessage("42", 7L, id, "hello", "world");
        assertTrue(repository.findByConversationIdOrderByCreatedAtAsc(id).stream()
                .allMatch(m -> SCOPE.equals(m.getConversationScope())));
    }

    @Test void forkKeepsDedicatedHistoryScope() {
        String source = conversation(42, 7, SCOPE);
        String fork = service.forkConversation(source, 7L, " branch", source, null, null);
        em.flush(); em.clear();
        assertEquals(SCOPE, service.conversationScopeOf(fork));
        assertTrue(repository.findConversationSummaries(42L, 7L).isEmpty());
        assertEquals(2, repository.findScopedConversationSummaries(42L, 7L, SCOPE).size());
    }

    @Test void invalidScopeCannotIssueOrReclassifyHistory() {
        assertThrows(IllegalArgumentException.class, () -> issuance.issue(7L, 42L, "arbitrary"));
        String id = conversation(42, 7, null);
        assertThrows(IllegalArgumentException.class, () -> service.adoptConversationScope(id, 7L, 42L, "arbitrary"));
        assertNull(service.conversationScopeOf(id));
    }
}
