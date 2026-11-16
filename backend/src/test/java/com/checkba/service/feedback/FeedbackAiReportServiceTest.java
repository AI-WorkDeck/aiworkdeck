// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.feedback;

import com.checkba.model.entity.FeedbackHandlingEvent;
import com.checkba.model.entity.User;
import com.checkba.model.entity.UserFeedback;
import com.checkba.repository.FeedbackHandlingEventRepository;
import com.checkba.repository.UserFeedbackRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class FeedbackAiReportServiceTest {

    @Mock
    private UserFeedbackRepository feedbackRepository;
    @Mock
    private FeedbackHandlingEventRepository eventRepository;
    @InjectMocks
    private FeedbackAiReportService service;

    private UserFeedback report;
    private User handler;

    @BeforeEach
    void setUp() {
        report = new UserFeedback();
        report.setId(7L);
        report.setStatus(UserFeedback.STATUS_EMAILED);
        report.setContextJson("{\"client\":{\"type\":\"ai-content-report\"}}");
        handler = mock(User.class);
        lenient().when(handler.getId()).thenReturn(1L);
        lenient().when(handler.getUsername()).thenReturn("admin");
    }

    @Test
    void savesProgressWithoutPretendingItIsResolved() {
        when(feedbackRepository.findById(7L)).thenReturn(Optional.of(report));
        when(feedbackRepository.saveAndFlush(report)).thenReturn(report);

        service.record(7L, handler, new FeedbackAiReportService.AiReportResolutionCommand(
                "PROGRESS", "Checked the cited answer", "Requested the original source",
                "conversation msg-12", "We are reviewing the source.", 0L));

        ArgumentCaptor<FeedbackHandlingEvent> captor = ArgumentCaptor.forClass(FeedbackHandlingEvent.class);
        verify(eventRepository).save(captor.capture());
        FeedbackHandlingEvent event = captor.getValue();
        assertEquals("PROGRESS", event.getEventType());
        assertEquals("Checked the cited answer", event.getConclusion());
        assertEquals("Requested the original source", event.getActionTaken());
        assertEquals("conversation msg-12", event.getEvidenceRef());
        assertEquals("We are reviewing the source.", event.getReporterResponse());
        assertEquals(1L, event.getHandlerId());
        assertEquals("admin", event.getHandlerName());
        assertNotNull(event.getOccurredAt());
        assertEquals(UserFeedback.STATUS_EMAILED, report.getStatus());
        assertEquals("We are reviewing the source.", report.getReporterResponse());
        assertNotNull(report.getResponsePublishedAt());
        assertNull(report.getResolvedAt());
    }

    @Test
    void resolutionRequiresHumanFieldsAndStoresCurrentSummary() {
        when(feedbackRepository.findById(7L)).thenReturn(Optional.of(report));
        when(feedbackRepository.saveAndFlush(report)).thenReturn(report);

        service.record(7L, handler, new FeedbackAiReportService.AiReportResolutionCommand(
                "RESOLVED", "Confirmed fabricated citation", "Removed the cited answer",
                "case-2026-17", "", 0L));

        ArgumentCaptor<FeedbackHandlingEvent> captor = ArgumentCaptor.forClass(FeedbackHandlingEvent.class);
        verify(eventRepository).save(captor.capture());
        assertEquals("RESOLVED", captor.getValue().getEventType());
        assertNull(captor.getValue().getReporterResponse());
        assertEquals(UserFeedback.STATUS_RESOLVED, report.getStatus());
        assertEquals("admin", report.getResolvedBy());
        assertNotNull(report.getResolvedAt());
        assertNull(report.getReporterResponse());
        assertNull(report.getResponsePublishedAt());
    }

    @Test
    void rejectsNonReportAndMalformedContext() {
        report.setContextJson("{\"client\":{\"type\":\"bug\"}}");
        when(feedbackRepository.findById(7L)).thenReturn(Optional.of(report));
        assertThrows(IllegalArgumentException.class, () -> service.record(7L, handler, command("PROGRESS")));
        report.setContextJson("not-json");
        assertThrows(IllegalArgumentException.class, () -> service.record(7L, handler, command("PROGRESS")));
        verify(eventRepository, never()).save(any());
    }

    @Test
    void rejectsInvalidInput() {
        when(feedbackRepository.findById(7L)).thenReturn(Optional.of(report));
        assertThrows(IllegalArgumentException.class, () -> service.record(7L, handler,
                new FeedbackAiReportService.AiReportResolutionCommand("RESOLVED", "", "action", null, null, 0L)));
        assertThrows(IllegalArgumentException.class, () -> service.record(7L, handler,
                new FeedbackAiReportService.AiReportResolutionCommand("RESOLVED", "conclusion", " ", null, null, 0L)));
        assertThrows(IllegalArgumentException.class, () -> service.record(7L, handler,
                new FeedbackAiReportService.AiReportResolutionCommand("OTHER", "conclusion", null, null, null, 0L)));
        assertThrows(IllegalArgumentException.class, () -> service.record(7L, handler,
                new FeedbackAiReportService.AiReportResolutionCommand("PROGRESS", "", "", "", "", 0L)));
        assertThrows(IllegalArgumentException.class, () -> service.record(7L, handler,
                new FeedbackAiReportService.AiReportResolutionCommand("PROGRESS", null, null, "x".repeat(2001), null, 0L)));
        verify(eventRepository, never()).save(any());
    }

    @Test
    void staleVersionAndRepeatedResolutionAreRejected() {
        when(feedbackRepository.findById(7L)).thenReturn(Optional.of(report));
        assertThrows(FeedbackAiReportService.ConflictException.class,
                () -> service.record(7L, handler, command("PROGRESS", 1L)));
        assertThrows(FeedbackAiReportService.ConflictException.class,
                () -> service.record(7L, handler, command("PROGRESS", null)));
        report.setStatus(UserFeedback.STATUS_RESOLVED);
        assertThrows(FeedbackAiReportService.ConflictException.class,
                () -> service.record(7L, handler, command("PROGRESS")));
        verify(eventRepository, never()).save(any());
    }

    private static FeedbackAiReportService.AiReportResolutionCommand command(String type) {
        return command(type, 0L);
    }

    private static FeedbackAiReportService.AiReportResolutionCommand command(String type, Long version) {
        return new FeedbackAiReportService.AiReportResolutionCommand(
                type, "conclusion", null, null, null, version);
    }
}
