// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.controller;

import com.checkba.service.revision.PendingRevisionService;
import org.junit.jupiter.api.Test;
import org.mockito.MockedStatic;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.util.List;
import java.util.Map;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;

class RevisionControllerTest {

    @Test
    void listAcceptRejectAndStaleCode() throws Exception {
        PendingRevisionService service = mock(PendingRevisionService.class);
        MockMvc mvc = MockMvcBuilders.standaloneSetup(new RevisionController(service)).build();
        when(service.listByProject(7L, 1L)).thenReturn(List.of(Map.of("id", 11)));
        when(service.accept(7L, 11L)).thenReturn(Map.of("edits", List.of()));
        when(service.accept(7L, 12L))
                .thenThrow(new PendingRevisionService.StaleRevisionException("stale"));
        try (MockedStatic<AuthController> auth = mockStatic(AuthController.class)) {
            auth.when(() -> AuthController.getUserIdFromSession("s")).thenReturn(7L);
            mvc.perform(get("/api/revisions/pending?projectId=1").header("X-Session-Id", "s"))
                    .andExpect(jsonPath("$.code").value(0))
                    .andExpect(jsonPath("$.data.revisions[0].id").value(11));
            mvc.perform(post("/api/revisions/pending/11/accept").header("X-Session-Id", "s")
                            .contentType(MediaType.APPLICATION_JSON))
                    .andExpect(jsonPath("$.code").value(0));
            mvc.perform(post("/api/revisions/pending/12/accept").header("X-Session-Id", "s")
                            .contentType(MediaType.APPLICATION_JSON))
                    .andExpect(jsonPath("$.code").value(4090))
                    .andExpect(jsonPath("$.data.status").value("STALE"));
            mvc.perform(post("/api/revisions/pending/11/reject").header("X-Session-Id", "s"))
                    .andExpect(jsonPath("$.data.rejected").value(true));
            mvc.perform(post("/api/revisions/pending/11/applied").header("X-Session-Id", "s"))
                    .andExpect(jsonPath("$.data.applied").value(true));
            verify(service).markApplied(7L, 11L);
            mvc.perform(post("/api/revisions/pending/11/progress").header("X-Session-Id", "s")
                            .contentType(MediaType.APPLICATION_JSON).content("{\"appliedCount\":1}"))
                    .andExpect(jsonPath("$.data.appliedCount").value(1));
            verify(service).recordProgress(7L, 11L, 1);
            verify(service).reject(7L, 11L);
        }
    }
}
