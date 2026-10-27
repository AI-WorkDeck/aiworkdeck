// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.controller;

import com.checkba.model.entity.PluginJob;
import com.checkba.service.ProjectFileAccessService;
import com.checkba.service.ProjectMemberService;
import com.checkba.service.ShareholderMeetingService;
import com.checkba.service.plugin.PluginJobService;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class InternalMaterialModulesAccessTest {
    @Test
    void customerCannotCopyOrListShareholderCheckMaterialsDespiteProjectMembership() {
        var members = mock(ProjectMemberService.class);
        var meetings = mock(ShareholderMeetingService.class);
        when(members.hasReadPermission(1L, 9L)).thenReturn(true);
        when(members.isClient(1L, 9L)).thenReturn(true);
        when(meetings.getProjectIdByCheckId(12L)).thenReturn(1L);
        var controller = new ShareholderMeetingController(meetings, members);
        try (var auth = mockStatic(AuthController.class)) {
            auth.when(() -> AuthController.getUserIdFromSession("session")).thenReturn(9L);
            for (Runnable request : List.<Runnable>of(
                    () -> controller.list(1L, "session"),
                    () -> controller.get(12L, "session"),
                    () -> controller.start(12L, "session"),
                    () -> controller.attachMaterial(12L, new ShareholderMeetingController.MaterialDto(), "session"),
                    () -> controller.create(1L, new ShareholderMeetingController.UpsertCheckDto(), "session"))) {
                assertEquals(ProjectFileAccessService.UNAVAILABLE_MESSAGE,
                        assertThrows(ProjectFileAccessService.FileAccessDeniedException.class, request::run).getMessage());
            }
        }
        verify(meetings, times(3)).getProjectIdByCheckId(12L);
        verifyNoMoreInteractions(meetings);
    }

    @Test
    void customerCannotReadPrivatePluginJobResultsOrCancelTheTask() {
        var members = mock(ProjectMemberService.class);
        var jobs = mock(PluginJobService.class);
        when(members.hasReadPermission(1L, 9L)).thenReturn(true);
        when(members.hasWritePermission(1L, 9L)).thenReturn(true);
        when(members.isClient(1L, 9L)).thenReturn(true);
        var job = new PluginJob(); job.setProjectId(1L); job.setResultJson("PRIVATE_FILE_EXCERPT");
        when(jobs.get("job")).thenReturn(job);
        var controller = new PluginJobController(jobs, members);
        try (var auth = mockStatic(AuthController.class)) {
            auth.when(() -> AuthController.getUserIdFromSession("session")).thenReturn(9L);
            for (Runnable request : List.<Runnable>of(
                    () -> controller.list(1L, "session"),
                    () -> controller.get("job", "session"),
                    () -> controller.cancel("job", "session"))) {
                assertEquals(ProjectFileAccessService.UNAVAILABLE_MESSAGE,
                        assertThrows(ProjectFileAccessService.FileAccessDeniedException.class, request::run).getMessage());
            }
        }
        verify(jobs, times(2)).get("job");
        verifyNoMoreInteractions(jobs);
    }

    @Test
    void internalMembersRetainReadAccessToTheirProjectModules() {
        var members = mock(ProjectMemberService.class);
        var meetings = mock(ShareholderMeetingService.class);
        var jobs = mock(PluginJobService.class);
        when(members.hasReadPermission(1L, 9L)).thenReturn(true);
        when(meetings.list(1L)).thenReturn(List.of());
        when(jobs.listByProject(1L)).thenReturn(List.of());
        try (var auth = mockStatic(AuthController.class)) {
            auth.when(() -> AuthController.getUserIdFromSession("session")).thenReturn(9L);
            assertEquals(List.of(), new ShareholderMeetingController(meetings, members).list(1L, "session"));
            assertEquals(List.of(), new PluginJobController(jobs, members).list(1L, "session"));
        }
        verify(meetings).list(1L);
        verify(jobs).listByProject(1L);
    }
}
