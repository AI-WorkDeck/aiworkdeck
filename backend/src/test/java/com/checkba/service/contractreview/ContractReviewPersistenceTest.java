// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.contractreview;

import com.checkba.model.entity.ContractReviewStandard;
import com.checkba.model.entity.ContractReviewRun;
import com.checkba.repository.ContractReviewStandardRepository;
import com.checkba.repository.ContractReviewRunRepository;
import jakarta.persistence.EntityManager;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.TestPropertySource;
import java.time.LocalDateTime;
import static org.junit.jupiter.api.Assertions.*;

@DataJpaTest(showSql = false)
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@TestPropertySource(properties = {
        "spring.datasource.url=jdbc:h2:mem:contract-review-test;MODE=PostgreSQL;NON_KEYWORDS=VALUE;DB_CLOSE_DELAY=-1",
        "spring.datasource.driver-class-name=org.h2.Driver", "spring.datasource.username=sa", "spring.datasource.password=",
        "spring.jpa.database-platform=org.hibernate.dialect.H2Dialect", "spring.jpa.hibernate.ddl-auto=create-drop"
})
class ContractReviewPersistenceTest {
    @Autowired ContractReviewStandardRepository standards;
    @Autowired ContractReviewRunRepository runs;
    @Autowired EntityManager em;

    @Test void savedStandardSurvivesReloadAndCannotBeLockedFromAnotherProject() {
        ContractReviewStandard standard = new ContractReviewStandard();
        standard.setProjectId(12L); standard.setName("审查标准"); standard.setRulesJson("[]");
        standard.setConfirmedVersion(1L); standard.setUpdatedAt(LocalDateTime.now());
        long id = standards.saveAndFlush(standard).getId();
        em.clear();
        assertEquals(1L, standards.lockInProject(id, 12L).orElseThrow().getConfirmedVersion());
        assertTrue(standards.lockInProject(id, 13L).isEmpty());
        assertEquals(1, standards.findByProjectIdOrderByUpdatedAtDesc(12L).size());
        assertTrue(standards.findByProjectIdOrderByUpdatedAtDesc(13L).isEmpty());
    }

    @Test void latestRunIsIsolatedByProjectAndDocumentAndKeepsItsOriginalSnapshot() {
        ContractReviewRun old = row(12L, 40L, "version-one"); runs.saveAndFlush(old);
        ContractReviewRun latest = row(12L, 40L, "version-two"); runs.saveAndFlush(latest);
        runs.saveAndFlush(row(13L, 40L, "other-project"));
        runs.saveAndFlush(row(12L, 41L, "other-document"));
        em.clear();
        assertEquals(latest.getId(), runs.findFirstByProjectIdAndDocFileIdOrderByIdDesc(12L, 40L).orElseThrow().getId());
        assertEquals("version-one", runs.findById(old.getId()).orElseThrow().getStandardJson());
        assertTrue(runs.findFirstByProjectIdAndDocFileIdOrderByIdDesc(99L, 40L).isEmpty());
    }

    private ContractReviewRun row(long projectId, long fileId, String snapshot) {
        ContractReviewRun row = new ContractReviewRun(); row.setProjectId(projectId); row.setDocFileId(fileId);
        row.setStandardJson(snapshot); row.setResultsJson("[]"); row.setStatus("DONE");
        row.setDocumentHash("a".repeat(64)); row.setStartedAt(LocalDateTime.now()); row.setFinishedAt(LocalDateTime.now());
        return row;
    }
}
