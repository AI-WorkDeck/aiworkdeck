// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.dd;

import com.checkba.model.entity.*;
import com.checkba.repository.*;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.*;
import java.time.LocalDateTime;
import static org.junit.jupiter.api.Assertions.*;

@DataJpaTest(showSql = false, properties = {
    "spring.datasource.url=jdbc:h2:mem:dd-assessment;MODE=PostgreSQL;NON_KEYWORDS=VALUE;DB_CLOSE_DELAY=-1",
    "spring.datasource.driver-class-name=org.h2.Driver", "spring.jpa.database-platform=org.hibernate.dialect.H2Dialect",
    "spring.jpa.hibernate.ddl-auto=create-drop"
})
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@Transactional(propagation = Propagation.NOT_SUPPORTED)
class DdAssessmentPersistenceTest {
    @Autowired DdSubmissionRepository submissions;
    @Autowired DdAiJobRepository jobs;
    @Autowired PlatformTransactionManager manager;

    @Test void lateAssessmentPreservesLawyerDecisionAppealAndVersion() {
        DdSubmission s = new DdSubmission(); s.setProjectId(1L); s.setRequestId(2L); s.setItemId(3L); s.setVersion(1);
        s.setSubmittedBy(4L); s.setSubmittedAt(LocalDateTime.now()); s.setIdempotencyKey("assessment-version");
        s = submissions.saveAndFlush(s);
        long id = s.getId();
        DdSubmission stale = submissions.findById(id).orElseThrow();
        new TransactionTemplate(manager).executeWithoutResult(tx -> {
            DdSubmission current = submissions.findById(id).orElseThrow();
            current.setReviewStatus("APPROVED"); current.setReviewReason("原件已复核"); current.setReviewedBy(9L);
            current.setReviewedAt(LocalDateTime.now()); current.setAppealReason("补充说明"); submissions.saveAndFlush(current);
        });
        assertEquals("UPLOADED", stale.getReviewStatus());
        submissions.updateAssessment(id, "FAILED", "{\"summary\":\"模型迟到结果\"}");
        DdSubmission result = submissions.findById(id).orElseThrow();
        assertEquals("APPROVED", result.getReviewStatus()); assertEquals(9L, result.getReviewedBy());
        assertEquals("原件已复核", result.getReviewReason()); assertEquals("补充说明", result.getAppealReason());
        assertEquals(1, result.getVersion()); assertEquals("FAILED", result.getAiStatus());
    }
    @Test void claimedJobCannotBeClaimedTwiceOrRecreatedAfterDeletion() {
        DdAiJob job = new DdAiJob(); job.setId("queue-test"); job.setProjectId(1L); job.setUserId(9L); job.setKind("VERIFY");
        jobs.saveAndFlush(job);
        assertEquals(1, jobs.claim(job.getId())); assertEquals(0, jobs.claim(job.getId()));
        assertEquals(1, jobs.progress(job.getId(), "处理中"));
        jobs.deleteById(job.getId());
        assertEquals(0, jobs.finish(job.getId(), "SUCCEEDED", "完成", "{}", null));
        assertFalse(jobs.existsById(job.getId()));
    }
}
