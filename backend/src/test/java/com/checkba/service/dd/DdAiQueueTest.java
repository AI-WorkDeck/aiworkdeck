// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.dd;

import com.checkba.model.entity.*;
import com.checkba.repository.*;
import com.checkba.service.DdService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.*;
import org.mockito.*;
import java.util.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;
import static org.junit.jupiter.api.Assertions.*;

class DdAiQueueTest {
    @Mock DdAiJobRepository jobs;
    @Mock DdSubmissionRepository submissions;
    @Mock DdItemRepository items;
    @Mock DdService dd;
    @Spy ObjectMapper json = new ObjectMapper();
    @InjectMocks DdAiService service;
    AutoCloseable mocks;
    @BeforeEach void setup() { mocks = MockitoAnnotations.openMocks(this); when(jobs.save(any())).thenAnswer(i -> i.getArgument(0)); }
    @AfterEach void close() throws Exception { service.close(); mocks.close(); }
    @Test void uncertainStartReusesEvenFinishedReceiptAndRejectsChangedInput() {
        var input = Map.of("requestId", 7L);
        var first = service.enqueue(1L, 9L, "REPORT", null, null, input, "retry-key");
        first.setInputJson(null); first.setStatus("SUCCEEDED");
        when(jobs.findByProjectIdAndUserIdAndKindAndIdempotencyKey(1L, 9L, "REPORT", "retry-key")).thenReturn(Optional.of(first));
        assertSame(first, service.enqueue(1L, 9L, "REPORT", null, null, input, "retry-key"));
        assertThrows(DdProcessingException.class, () -> service.enqueue(1L, 9L, "REPORT", null, null, Map.of("requestId", 8L), "retry-key"));
        verify(jobs, times(1)).save(any());
    }
    @Test void archivedAndSupersededSubmissionsCannotStartPaidWork() {
        DdSubmission submission = new DdSubmission(); submission.setId(3L); submission.setItemId(2L); submission.setRequestId(1L); submission.setAiConsent(true);
        when(submissions.findById(3L)).thenReturn(Optional.of(submission));
        DdRequest request = new DdRequest(); request.setId(1L); request.setStatus("ARCHIVED"); request.setAiReviewEnabled(true); when(dd.getRequest(1L)).thenReturn(request);
        assertThrows(DdProcessingException.class, () -> service.reviewSubmission(3L));
        request.setStatus("PUBLISHED"); DdItem item = new DdItem(); item.setCurrentSubmissionId(4L); when(items.findById(2L)).thenReturn(Optional.of(item));
        assertThrows(DdProcessingException.class, () -> service.reviewSubmission(3L));
        verify(jobs, never()).save(any()); verify(submissions, never()).updateAssessment(any(), any(), any());
    }
}
