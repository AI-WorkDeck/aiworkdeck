// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.controller;

import com.checkba.model.entity.User;
import com.checkba.repository.ProjectFileRepository;
import com.checkba.repository.UserRepository;
import com.checkba.service.LitigationVisualPanelService;
import com.checkba.service.ProjectFileAccessService;
import com.checkba.service.ProjectMemberService;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class LitigationVisualControllerAccessTest {
    @Test
    void bothGlobalAndProjectClientsCannotReadPrivateMapMetadataOrMutateDiagrams() {
        for (boolean globalClient : List.of(true, false)) {
            var panels = mock(LitigationVisualPanelService.class);
            var members = mock(ProjectMemberService.class);
            var users = mock(UserRepository.class);
            var customer = new User(); customer.setRole(globalClient ? "CLIENT" : "USER");
            when(users.findById(9L)).thenReturn(Optional.of(customer));
            when(members.isClient(1L, 9L)).thenReturn(!globalClient);
            when(members.hasReadPermission(1L, 9L)).thenReturn(true);
            when(members.hasWritePermission(1L, 9L)).thenReturn(true);
            var controller = new LitigationVisualController(panels, members,
                    new ProjectFileAccessService(members, users, mock(ProjectFileRepository.class)));
            try (var auth = mockStatic(AuthController.class)) {
                auth.when(() -> AuthController.getUserIdFromSession("session")).thenReturn(9L);
                for (Runnable request : List.<Runnable>of(
                        () -> controller.diagrams(1L, "session"),
                        () -> controller.restyle(1L, new LitigationVisualController.RestyleDto(), "session"),
                        () -> controller.saveDrawio(1L, 10L, new LitigationVisualController.SaveDrawioDto(), "session"),
                        () -> controller.kickoff(1L, new LitigationVisualController.KickoffDto(), "session"))) {
                    assertEquals(ProjectFileAccessService.UNAVAILABLE_MESSAGE,
                            assertThrows(ProjectFileAccessService.FileAccessDeniedException.class, request::run).getMessage());
                }
            }
            verifyNoInteractions(panels);
        }
    }

    @Test
    void internalMemberCanListButReadOnlyMemberCannotChangeDiagrams() {
        var panels = mock(LitigationVisualPanelService.class);
        var members = mock(ProjectMemberService.class);
        var users = mock(UserRepository.class);
        var lawyer = new User(); lawyer.setRole("USER");
        when(users.findById(9L)).thenReturn(Optional.of(lawyer));
        when(members.hasReadPermission(1L, 9L)).thenReturn(true);
        when(panels.listDiagrams(1L)).thenReturn(List.of());
        var controller = new LitigationVisualController(panels, members,
                new ProjectFileAccessService(members, users, mock(ProjectFileRepository.class)));
        try (var auth = mockStatic(AuthController.class)) {
            auth.when(() -> AuthController.getUserIdFromSession("session")).thenReturn(9L);
            assertEquals(List.of(), controller.diagrams(1L, "session"));
            assertThrows(IllegalArgumentException.class,
                    () -> controller.restyle(1L, new LitigationVisualController.RestyleDto(), "session"));
        }
        verify(panels).listDiagrams(1L);
        verifyNoMoreInteractions(panels);
    }
}
