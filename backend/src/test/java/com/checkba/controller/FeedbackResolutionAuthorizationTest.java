// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.controller;

import com.checkba.model.entity.UserFeedback;
import com.checkba.repository.UserFeedbackRepository;
import com.checkba.service.feedback.FeedbackIngestGuard;
import com.checkba.service.feedback.FeedbackService;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import java.util.Map;
import java.util.Optional;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class FeedbackResolutionAuthorizationTest {
    @Test void missingUnconfiguredOrWrongTokenCannotWriteResolution() {
        var repository = mock(UserFeedbackRepository.class);
        var controller = new FeedbackIngestController(mock(FeedbackService.class), mock(FeedbackIngestGuard.class), repository);
        ReflectionTestUtils.setField(controller, "optimizerToken", "");
        assertEquals(403, controller.resolution("synthetic", 7L, Map.of("status", "EMAILED")).getStatusCode().value());
        ReflectionTestUtils.setField(controller, "optimizerToken", "synthetic");
        assertEquals(403, controller.resolution(null, 7L, Map.of("status", "EMAILED")).getStatusCode().value());
        assertEquals(403, controller.resolution("wrong", 7L, Map.of("status", "EMAILED")).getStatusCode().value());
        verifyNoInteractions(repository);
    }

    @Test void authorizedResolutionRecordsTriageNotesWithoutDeletingOriginalReport() {
        var repository = mock(UserFeedbackRepository.class);
        var controller = new FeedbackIngestController(mock(FeedbackService.class), mock(FeedbackIngestGuard.class), repository);
        ReflectionTestUtils.setField(controller, "optimizerToken", "synthetic");
        var report = new UserFeedback();
        report.setId(7L); report.setUserId(3L); report.setText("Original report"); report.setStatus("EMAILED");
        when(repository.findById(7L)).thenReturn(Optional.of(report));
        String notes = "{\"summary\":\"Human review pending\",\"reason\":\"Notification delivered; not resolved\"}";
        assertEquals(200, controller.resolution("synthetic", 7L, Map.of("triageJson", notes)).getStatusCode().value());
        assertEquals(notes, report.getTriageJson());
        assertEquals("EMAILED", report.getStatus());
        assertEquals("Original report", report.getText());
        assertEquals(3L, report.getUserId());
        verify(repository).findById(7L);
        verify(repository).save(report);
        verifyNoMoreInteractions(repository);
    }

    @Test void optimizerTokenCannotResolveAiReportOrRewriteResolvedReport() {
        var repository = mock(UserFeedbackRepository.class);
        var controller = new FeedbackIngestController(mock(FeedbackService.class), mock(FeedbackIngestGuard.class), repository);
        ReflectionTestUtils.setField(controller, "optimizerToken", "synthetic");
        var report = new UserFeedback();
        report.setId(7L);
        report.setStatus(UserFeedback.STATUS_EMAILED);
        report.setContextJson("{\"client\":{\"type\":\"ai-content-report\"}}");
        when(repository.findById(7L)).thenReturn(Optional.of(report));

        assertEquals(403, controller.resolution("synthetic", 7L, Map.of("status", "RESOLVED")).getStatusCode().value());
        report.setStatus(UserFeedback.STATUS_RESOLVED);
        assertEquals(403, controller.resolution("synthetic", 7L, Map.of("status", "FAILED")).getStatusCode().value());
        assertEquals(UserFeedback.STATUS_RESOLVED, report.getStatus());
        verify(repository, never()).save(any());
    }
}
