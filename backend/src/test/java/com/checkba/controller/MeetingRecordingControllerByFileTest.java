// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.controller;

import com.checkba.model.entity.MeetingRecording;
import com.checkba.service.LocalIdentityService;
import com.checkba.service.ProjectMemberService;
import com.checkba.service.UserSessionService;
import com.checkba.service.meeting.MeetingRecordingService;
import com.checkba.service.meeting.MeetingTranscriptionService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * dev-board#1024：按文件反查会议记录，播放器的字幕按钮靠它推导状态。
 * 没有记录是常态（绝大多数媒体文件没转写过），必须回 200 + meeting:null 而不是 404。
 */
class MeetingRecordingControllerByFileTest {

    private MeetingRecordingService meetingService;
    private MeetingTranscriptionService transcriptionService;
    private ProjectMemberService projectMemberService;
    private MeetingRecordingController controller;

    @BeforeEach
    void setUp() {
        AuthController.registerLocalIdentityService(
                new LocalIdentityService(null, null, null, null, false));
        meetingService = mock(MeetingRecordingService.class);
        transcriptionService = mock(MeetingTranscriptionService.class);
        projectMemberService = mock(ProjectMemberService.class);
        UserSessionService userSessionService = mock(UserSessionService.class);
        when(userSessionService.resolveUserId("sess")).thenReturn(7L);
        AuthController.registerUserSessionService(userSessionService);
        var files = mock(com.checkba.repository.ProjectFileRepository.class);
        when(files.findById(anyLong())).thenAnswer(i -> {
            var file = new com.checkba.model.entity.ProjectFile(); file.setId(i.getArgument(0)); file.setProjectId(1L);
            return Optional.of(file);
        });
        controller = new MeetingRecordingController(meetingService, transcriptionService, projectMemberService,
                        files, mock(com.checkba.service.ProjectFileAccessService.class));
    }

    @Test
    void todosUsesOnlyAuthorizedProjectMemberIds() {
        var m = new MeetingRecording();
        m.setId(9L); m.setProjectId(1L); m.setStatus(MeetingRecording.STATUS_TRANSCRIBED);
        when(meetingService.get(9L)).thenReturn(m);
        when(meetingService.getProjectId(9L)).thenReturn(1L);
        when(projectMemberService.hasReadPermission(eq(1L), anyLong())).thenReturn(true);
        when(projectMemberService.hasWritePermission(eq(1L), anyLong())).thenReturn(true);
        var owner = new com.checkba.model.entity.User(); owner.setId(7L); owner.setDisplayName("Owner");
        var member = new com.checkba.model.entity.User(); member.setId(8L); member.setDisplayName("Member");
        when(projectMemberService.getProjectOwner(1L)).thenReturn(owner);
        when(projectMemberService.getMemberUsers(1L)).thenReturn(java.util.List.of(member));
        when(meetingService.buildTodosKickoffPrompt(m, Map.of(7L, "Owner", 8L, "Member"))).thenReturn("prompt");
        org.junit.jupiter.api.Assertions.assertEquals("prompt", controller.todosPrompt(9L, "sess").get("prompt"));
    }

    @Test
    void todosRejectsReadersBeforeBuildingPrompt() {
        var m = new MeetingRecording();
        m.setId(9L); m.setProjectId(1L);
        when(meetingService.get(9L)).thenReturn(m);
        when(meetingService.getProjectId(9L)).thenReturn(1L);
        when(projectMemberService.hasReadPermission(eq(1L), anyLong())).thenReturn(true);
        when(projectMemberService.hasWritePermission(eq(1L), anyLong())).thenReturn(false);
        assertThrows(com.checkba.service.ProjectFileAccessService.FileAccessDeniedException.class,
                () -> controller.todosPrompt(9L, "sess"));
        verify(meetingService, never()).buildTodosKickoffPrompt(org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.any());
    }

    @Test
    void todosRequiresCompletedTranscription() {
        var m = new MeetingRecording();
        m.setId(9L); m.setProjectId(1L); m.setStatus("TRANSCRIBING");
        when(meetingService.get(9L)).thenReturn(m);
        when(meetingService.getProjectId(9L)).thenReturn(1L);
        when(projectMemberService.hasReadPermission(eq(1L), anyLong())).thenReturn(true);
        when(projectMemberService.hasWritePermission(eq(1L), anyLong())).thenReturn(true);
        assertThrows(IllegalArgumentException.class, () -> controller.todosPrompt(9L, "sess"));
    }

    @Test
    @DisplayName("有记录：返回该文件最新的会议记录（带进度）")
    void returnsMeetingForFile() {
        when(projectMemberService.hasReadPermission(eq(1L), anyLong())).thenReturn(true);
        MeetingRecording m = new MeetingRecording();
        m.setId(9L);
        m.setAudioFileId(42L);
        when(meetingService.findByAudioFile(1L, 42L)).thenReturn(Optional.of(m));
        when(transcriptionService.attachProgress(m)).thenReturn(m);

        Map<String, Object> res = controller.byFile(1L, 42L, "sess");

        assertSame(m, res.get("meeting"));
        verify(transcriptionService).attachProgress(m);
    }

    @Test
    @DisplayName("无记录：200 + meeting 为 null（键存在），不抛异常")
    void returnsNullMeetingWhenNone() {
        when(projectMemberService.hasReadPermission(eq(1L), anyLong())).thenReturn(true);
        when(meetingService.findByAudioFile(1L, 43L)).thenReturn(Optional.empty());

        Map<String, Object> res = controller.byFile(1L, 43L, "sess");

        assertTrue(res.containsKey("meeting"));
        assertNull(res.get("meeting"));
    }

    @Test
    @DisplayName("非项目成员：与 list 同口径拒绝，不查库")
    void rejectsNonMember() {
        when(projectMemberService.hasReadPermission(eq(1L), anyLong())).thenReturn(false);

        assertThrows(RuntimeException.class, () -> controller.byFile(1L, 42L, "sess"));
        verify(meetingService, never()).findByAudioFile(anyLong(), anyLong());
    }
}
