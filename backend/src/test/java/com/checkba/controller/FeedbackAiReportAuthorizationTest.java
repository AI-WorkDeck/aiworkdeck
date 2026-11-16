// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.controller;

import com.checkba.model.entity.User;
import com.checkba.model.entity.UserFeedback;
import com.checkba.repository.UserFeedbackRepository;
import com.checkba.repository.UserRepository;
import com.checkba.service.AdminAccessService;
import com.checkba.service.feedback.FeedbackAiReportService;
import com.checkba.service.feedback.FeedbackService;
import com.checkba.service.feedback.FeedbackUploadService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.MockedStatic;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class FeedbackAiReportAuthorizationTest {

    @Mock private FeedbackService feedbackService;
    @Mock private FeedbackUploadService uploadService;
    @Mock private UserFeedbackRepository feedbackRepository;
    @Mock private UserRepository userRepository;
    @Mock private AdminAccessService adminAccessService;
    @Mock private FeedbackAiReportService aiReportService;
    @InjectMocks private FeedbackController controller;

    @Test
    void anonymousAndOptimizerTokenAloneCannotWrite() {
        ReflectionTestUtils.setField(controller, "optimizerToken", "synthetic");
        try (MockedStatic<AuthController> auth = mockStatic(AuthController.class)) {
            auth.when(() -> AuthController.getUserIdFromSession(null)).thenReturn(null);
            assertEquals(401, controller.resolveAiReport(null, 7L, command()).getStatusCode().value());
        }
        verifyNoInteractions(aiReportService);
    }

    @Test
    void ordinaryUserCannotWrite() {
        User ordinary = mock(User.class);
        when(userRepository.findById(3L)).thenReturn(Optional.of(ordinary));
        when(adminAccessService.isAdmin(ordinary)).thenReturn(false);
        try (MockedStatic<AuthController> auth = mockStatic(AuthController.class)) {
            auth.when(() -> AuthController.getUserIdFromSession("ordinary")).thenReturn(3L);
            assertEquals(403, controller.resolveAiReport("ordinary", 7L, command()).getStatusCode().value());
        }
        verifyNoInteractions(aiReportService);
    }

    @Test
    void adminSessionCanWriteAndServerSuppliesIdentity() {
        User admin = mock(User.class);
        UserFeedback saved = new UserFeedback();
        saved.setId(7L);
        saved.setStatus(UserFeedback.STATUS_RESOLVED);
        when(userRepository.findById(1L)).thenReturn(Optional.of(admin));
        when(adminAccessService.isAdmin(admin)).thenReturn(true);
        when(aiReportService.record(eq(7L), same(admin), any())).thenReturn(saved);
        try (MockedStatic<AuthController> auth = mockStatic(AuthController.class)) {
            auth.when(() -> AuthController.getUserIdFromSession("admin-session")).thenReturn(1L);
            assertEquals(200, controller.resolveAiReport("admin-session", 7L, command()).getStatusCode().value());
        }
        verify(aiReportService).record(eq(7L), same(admin), any());
    }

    @Test
    void invalidInputIsABadRequestAndConflictIs409() {
        User admin = mock(User.class);
        when(userRepository.findById(1L)).thenReturn(Optional.of(admin));
        when(adminAccessService.isAdmin(admin)).thenReturn(true);
        when(aiReportService.record(eq(7L), same(admin), any()))
                .thenThrow(new IllegalArgumentException("invalid"))
                .thenThrow(new FeedbackAiReportService.ConflictException("stale"));
        try (MockedStatic<AuthController> auth = mockStatic(AuthController.class)) {
            auth.when(() -> AuthController.getUserIdFromSession("admin-session")).thenReturn(1L);
            assertEquals(400, controller.resolveAiReport("admin-session", 7L, command()).getStatusCode().value());
            assertEquals(409, controller.resolveAiReport("admin-session", 7L, command()).getStatusCode().value());
        }
    }

    private static FeedbackAiReportService.AiReportResolutionCommand command() {
        return new FeedbackAiReportService.AiReportResolutionCommand(
                "RESOLVED", "conclusion", "action", "evidence", "response", 0L);
    }
}
