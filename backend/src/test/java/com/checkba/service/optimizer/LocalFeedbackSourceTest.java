// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.optimizer;

import com.checkba.model.entity.UserFeedback;
import com.checkba.repository.UserFeedbackRepository;
import com.checkba.service.feedback.FeedbackService;
import org.junit.jupiter.api.Test;

import java.util.Optional;

import static org.mockito.Mockito.*;

class LocalFeedbackSourceTest {

    @Test
    void staleOptimizerSaveCannotOverwriteResolvedAiReport() {
        UserFeedbackRepository repository = mock(UserFeedbackRepository.class);
        LocalFeedbackSource source = new LocalFeedbackSource(repository, mock(FeedbackService.class));
        UserFeedback current = aiReport(UserFeedback.STATUS_RESOLVED);
        UserFeedback stale = aiReport(UserFeedback.STATUS_EMAILED);
        when(repository.findById(7L)).thenReturn(Optional.of(current));

        source.save(stale);

        verify(repository, never()).save(any());
    }

    @Test
    void unresolvedAiReportStillAcceptsOptimizerReceipt() {
        UserFeedbackRepository repository = mock(UserFeedbackRepository.class);
        LocalFeedbackSource source = new LocalFeedbackSource(repository, mock(FeedbackService.class));
        UserFeedback current = aiReport(UserFeedback.STATUS_NEW);
        UserFeedback incoming = aiReport(UserFeedback.STATUS_EMAILED);
        when(repository.findById(7L)).thenReturn(Optional.of(current));

        source.save(incoming);

        verify(repository).save(incoming);
    }

    private static UserFeedback aiReport(String status) {
        UserFeedback feedback = new UserFeedback();
        feedback.setId(7L);
        feedback.setStatus(status);
        feedback.setContextJson("{\"client\":{\"type\":\"ai-content-report\"}}");
        return feedback;
    }
}
