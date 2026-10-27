// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.controller;

import com.checkba.model.entity.DdSubmission;
import com.checkba.service.*;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;

import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

class DdControllerSubmissionContractTest {
    DdService dd = mock(DdService.class);
    DdWorkflowService workflow = mock(DdWorkflowService.class);
    ProjectMemberService members = mock(ProjectMemberService.class);
    ProjectFileAccessService access = mock(ProjectFileAccessService.class);
    MockMvc mvc;

    @BeforeEach void setup() {
        when(dd.getProjectIdByItemId(9L)).thenReturn(1L);
        when(members.hasReadPermission(1L, 3L)).thenReturn(true);
        mvc = MockMvcBuilders.standaloneSetup(new DdController(dd, workflow, members, access)).build();
    }

    @Test void acceptsBothMultipartFieldSpellingsAndBindsConsentAndRetryKey() throws Exception {
        DdSubmission submission = new DdSubmission(); submission.setId(7L); submission.setFileIds(List.of(21L, 22L));
        when(workflow.submit(eq(9L), anyList(), eq("attempt"), eq(true), eq(3L))).thenReturn(submission);
        try (var auth = mockStatic(AuthController.class)) {
            auth.when(() -> AuthController.getUserIdFromSession("session")).thenReturn(3L);
            for (String field : List.of("files", "files[]")) {
                mvc.perform(multipart("/api/dd/items/9/submissions")
                                .file(new MockMultipartFile(field, "a.pdf", "application/pdf", new byte[]{1}))
                                .file(new MockMultipartFile(field, "b.pdf", "application/pdf", new byte[]{2}))
                                .param("idempotencyKey", "attempt").param("aiConsent", "true").header("X-Session-Id", "session"))
                        .andExpect(status().isOk()).andExpect(jsonPath("$.id").value(7))
                        .andExpect(jsonPath("$.fileIds.length()").value(2));
            }
            verify(workflow, times(2)).submit(eq(9L), argThat(files -> files.size() == 2), eq("attempt"), eq(true), eq(3L));
        }
    }

    @Test void staleReviewReturnsReal409AndPreservesVersionArguments() throws Exception {
        when(members.hasWritePermission(1L, 3L)).thenReturn(true);
        when(workflow.review(9L, "APPROVED", null, 7L, 4L, 3L))
                .thenThrow(new ResponseStatusException(HttpStatus.CONFLICT, "材料已更新，请刷新后审核"));
        try (var auth = mockStatic(AuthController.class)) {
            auth.when(() -> AuthController.getUserIdFromSession("session")).thenReturn(3L);
            mvc.perform(put("/api/dd/items/9/status").header("X-Session-Id", "session")
                            .contentType("application/json").content("{\"status\":\"APPROVED\",\"submissionId\":7,\"revision\":4}"))
                    .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value(409))
                    .andExpect(jsonPath("$.message").value("材料已更新，请刷新后审核"));
        }
    }

    @Test void readOnlyMemberCannotUseOldStaffRoute() throws Exception {
        try (var auth = mockStatic(AuthController.class)) {
            auth.when(() -> AuthController.getUserIdFromSession("session")).thenReturn(3L);
            mvc.perform(put("/api/dd/items/9/info").header("X-Session-Id", "session")
                            .contentType("application/json").content("{\"title\":\"不应保存\"}"))
                    .andExpect(status().isForbidden());
            verifyNoInteractions(workflow);
        }
    }
}
