// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.controller;

import com.checkba.exception.UnauthorizedException;
import com.checkba.model.entity.ProjectFile;
import com.checkba.service.LocalIdentityService;
import com.checkba.service.UserSessionService;
import com.checkba.service.ocr.FileOcrService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** Explorer OCR endpoints (tutorial-series#155). */
class FileOcrControllerTest {
    FileOcrService service = mock(FileOcrService.class);
    FileOcrController controller = new FileOcrController(service);

    @BeforeEach
    void setUp() {
        AuthController.registerLocalIdentityService(new LocalIdentityService(null, null, null, null, false));
        UserSessionService sessions = mock(UserSessionService.class);
        when(sessions.resolveUserId("sess")).thenReturn(5L);
        AuthController.registerUserSessionService(sessions);
    }

    @Test void requiresSignIn() {
        assertThrows(UnauthorizedException.class, () -> controller.recognize(1L, 2L, Map.of(), null));
        assertThrows(UnauthorizedException.class, () -> controller.cancel(1L, Map.of("jobId", "j"), null));
        verifyNoInteractions(service);
    }

    @Test void passesOutputNameConsentAndJobToService() throws Exception {
        ProjectFile created = new ProjectFile(); created.setId(9L); created.setName("a-识别文字.docx");
        when(service.run(eq(1L), eq(2L), eq(5L), any())).thenReturn(
                new FileOcrService.Outcome("done", null, created, "ocr", 3, null, null));
        Map<String, Object> body = Map.of("jobId", "job", "output", "docx", "name", "a-识别文字.docx", "consentVersion", "v");
        Map<String, Object> res = controller.recognize(1L, 2L, body, "sess");
        ArgumentCaptor<FileOcrService.Request> req = ArgumentCaptor.forClass(FileOcrService.Request.class);
        verify(service).run(eq(1L), eq(2L), eq(5L), req.capture());
        assertEquals(new FileOcrService.Request("job", FileOcrService.Output.DOCX, "a-识别文字.docx", "v"), req.getValue());
        assertEquals(0, res.get("code"));
        @SuppressWarnings("unchecked") Map<String, Object> data = (Map<String, Object>) res.get("data");
        assertEquals("done", data.get("status"));
        assertSame(created, data.get("file"));
        assertEquals(3, data.get("pages"));
    }

    @Test void consentRequiredCarriesNoticeAndVersion() throws Exception {
        when(service.run(anyLong(), anyLong(), anyLong(), any())).thenReturn(
                new FileOcrService.Outcome("consent_required", null, null, null, 0, "notice", "2026-10-21"));
        @SuppressWarnings("unchecked") Map<String, Object> data =
                (Map<String, Object>) controller.recognize(1L, 2L, Map.of(), "sess").get("data");
        assertEquals("consent_required", data.get("status"));
        assertEquals("notice", data.get("notice"));
        assertEquals("2026-10-21", data.get("version"));
    }

    @Test void unknownOutputIsRejectedBeforeAnyWork() {
        assertThrows(IllegalArgumentException.class, () -> controller.recognize(1L, 2L, Map.of("output", "pdf"), "sess"));
        verifyNoInteractions(service);
    }

    @Test void cancelIsScopedToTheSignedInUser() {
        controller.cancel(1L, Map.of("jobId", "job"), "sess");
        verify(service).cancel(5L, "job");
    }
}
