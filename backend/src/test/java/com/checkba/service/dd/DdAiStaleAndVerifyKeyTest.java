// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.dd;

import com.checkba.model.entity.*;
import com.checkba.repository.*;
import com.checkba.service.DdService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.*;
import org.mockito.*;
import java.time.LocalDateTime;
import java.util.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;
import static org.junit.jupiter.api.Assertions.*;

class DdAiStaleAndVerifyKeyTest {
    @Mock DdAiJobRepository jobs;
    @Mock DdSubmissionRepository submissions;
    @Mock DdItemRepository items;
    @Mock DdService dd;
    @Spy ObjectMapper json = new ObjectMapper();
    @InjectMocks DdAiService service;
    AutoCloseable mocks;
    @BeforeEach void setup() { mocks = MockitoAnnotations.openMocks(this); when(jobs.save(any())).thenAnswer(i -> i.getArgument(0)); }
    @AfterEach void close() throws Exception { service.close(); mocks.close(); }

    @Test void verifyEnqueueCarriesDeterministicAttemptKeySoUniqueConstraintRejectsRacingDuplicate() {
        DdSubmission submission = new DdSubmission(); submission.setId(3L); submission.setItemId(2L); submission.setRequestId(1L); submission.setAiConsent(true); submission.setType("FILES");
        when(submissions.findById(3L)).thenReturn(Optional.of(submission));
        DdRequest request = new DdRequest(); request.setId(1L); request.setStatus("PUBLISHED"); request.setAiReviewEnabled(true); request.setCreatedBy(9L); request.setProjectId(5L);
        when(dd.getRequest(1L)).thenReturn(request);
        DdItem item = new DdItem(); item.setCurrentSubmissionId(3L); when(items.findById(2L)).thenReturn(Optional.of(item));
        when(jobs.countByKindAndSubmissionId("VERIFY", 3L)).thenReturn(0L);
        DdAiJob job = service.reviewSubmission(3L);
        assertEquals("verify:3:0", job.getIdempotencyKey());
    }

    @Test void staleRunningJobIsFailedByDispatchButFreshOneIsLeftAlone() {
        DdAiJob stale = new DdAiJob(); stale.setId("old"); stale.setKind("EXAMPLE"); stale.setStatus("RUNNING"); stale.setStartedAt(LocalDateTime.now().minusMinutes(31));
        when(jobs.findTop8ByStatusAndStartedAtBefore(eq("RUNNING"), any())).thenReturn(List.of(stale)).thenReturn(List.of());
        service.dispatch();
        verify(jobs).finish(eq("old"), eq("FAILED"), any(), isNull(), anyString());
        var cutoff = ArgumentCaptor.forClass(LocalDateTime.class);
        verify(jobs, atLeastOnce()).findTop8ByStatusAndStartedAtBefore(eq("RUNNING"), cutoff.capture());
        assertTrue(cutoff.getValue().isBefore(LocalDateTime.now().minusMinutes(29)), "阈值必须宽松，不能回收正常运行的任务");
    }
}
