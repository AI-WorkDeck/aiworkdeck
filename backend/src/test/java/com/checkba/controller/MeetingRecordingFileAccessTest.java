// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.controller;

import com.checkba.model.entity.MeetingRecording;
import com.checkba.model.entity.ProjectFile;
import com.checkba.model.entity.User;
import com.checkba.repository.ProjectFileRepository;
import com.checkba.repository.UserRepository;
import com.checkba.service.ProjectFileAccessService;
import com.checkba.service.ProjectMemberService;
import com.checkba.service.meeting.MeetingRecordingService;
import com.checkba.service.meeting.MeetingTranscriptionService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import java.util.List;
import java.util.Optional;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

class MeetingRecordingFileAccessTest {
    MeetingRecordingService meetings = mock(MeetingRecordingService.class);
    MeetingTranscriptionService transcription = mock(MeetingTranscriptionService.class);
    ProjectMemberService members = mock(ProjectMemberService.class);
    ProjectFileRepository files = mock(ProjectFileRepository.class);
    UserRepository users = mock(UserRepository.class);
    ProjectFileAccessService access = new ProjectFileAccessService(members, users, files);
    MockMvc mvc;
    ProjectFile audio;
    MeetingRecording meeting;
    @BeforeEach void setup() {
        audio = new ProjectFile(); audio.setId(1L); audio.setProjectId(10L); audio.setUserId(2L);
        meeting = new MeetingRecording(); meeting.setId(20L); meeting.setProjectId(10L); meeting.setAudioFileId(1L);
        meeting.setTranscriptJson("private transcript"); meeting.setSummaryJson("private summary");
        meeting.setStatus(MeetingRecording.STATUS_TRANSCRIBED);
        when(files.findById(1L)).thenReturn(Optional.of(audio));
        when(members.hasReadPermission(10L, 7L)).thenReturn(true); role("CLIENT");
        when(meetings.get(20L)).thenReturn(meeting); when(meetings.getProjectId(20L)).thenReturn(10L);
        when(meetings.findByAudioFile(10L, 1L)).thenReturn(Optional.of(meeting));
        when(meetings.list(10L)).thenReturn(List.of(meeting));
        when(transcription.refreshIfNeeded(meeting)).thenReturn(meeting);
        when(transcription.attachProgress(meeting)).thenReturn(meeting);
        mvc = MockMvcBuilders.standaloneSetup(new MeetingRecordingController(meetings, transcription, members, files, access)).build();
    }
    void role(String role) { User user = new User(); user.setRole(role); when(users.findById(7L)).thenReturn(Optional.of(user)); }
    @Test void privateAudioTranscriptHiddenAtEveryReadEndpoint() throws Exception {
        try (var auth = mockStatic(AuthController.class)) {
            auth.when(() -> AuthController.getUserIdFromSession("s")).thenReturn(7L);
            for (String path : List.of("/api/meetings/20", "/api/meetings/projects/10/by-file/1")) {
                mvc.perform(get(path).header("X-Session-Id", "s")).andExpect(status().isForbidden())
                        .andExpect(jsonPath("$.message").value(ProjectFileAccessService.UNAVAILABLE_MESSAGE));
            }
            mvc.perform(post("/api/meetings/20/minutes-prompt").header("X-Session-Id", "s")).andExpect(status().isForbidden());
            mvc.perform(get("/api/meetings/projects/10").header("X-Session-Id", "s"))
                    .andExpect(status().isOk()).andExpect(jsonPath("$.meetings").isEmpty());
            verify(transcription, never()).refreshIfNeeded(any());
            verify(meetings, never()).buildMinutesKickoffPrompt(any());
        }
    }
    @Test void ownAndExplicitlyGrantedAudioRemainReadableToClients() throws Exception {
        try (var auth = mockStatic(AuthController.class)) {
            auth.when(() -> AuthController.getUserIdFromSession("s")).thenReturn(7L);
            audio.setUserId(7L); assertReadable();
            audio.setUserId(2L); audio.setClientVisible(true); assertReadable();
        }
    }
    void assertReadable() throws Exception {
        mvc.perform(get("/api/meetings/20").header("X-Session-Id", "s"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.transcriptJson").value("private transcript"));
        mvc.perform(get("/api/meetings/projects/10/by-file/1").header("X-Session-Id", "s"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.meeting.summaryJson").value("private summary"));
        mvc.perform(get("/api/meetings/projects/10").header("X-Session-Id", "s"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.meetings[0].id").value(20));
    }
    @Test void legacyRecordWithoutSourceIsOnlyReadableInternally() throws Exception {
        meeting.setAudioFileId(null);
        try (var auth = mockStatic(AuthController.class)) {
            auth.when(() -> AuthController.getUserIdFromSession("s")).thenReturn(7L);
            mvc.perform(get("/api/meetings/20").header("X-Session-Id", "s")).andExpect(status().isForbidden());
            mvc.perform(get("/api/meetings/projects/10").header("X-Session-Id", "s"))
                    .andExpect(jsonPath("$.meetings").isEmpty());
            role("USER");
            mvc.perform(get("/api/meetings/20").header("X-Session-Id", "s"))
                    .andExpect(status().isOk()).andExpect(jsonPath("$.transcriptJson").value("private transcript"));
        }
    }
    @Test void removedSourceAlsoDoesNotExposeTranscriptToClient() throws Exception {
        when(files.findById(1L)).thenReturn(Optional.empty());
        try (var auth = mockStatic(AuthController.class)) {
            auth.when(() -> AuthController.getUserIdFromSession("s")).thenReturn(7L);
            mvc.perform(get("/api/meetings/20").header("X-Session-Id", "s")).andExpect(status().isForbidden());
        }
    }
    @Test void clientAndReadOnlyStaffCannotMutateEvenWhenAudioVisible() throws Exception {
        audio.setClientVisible(true);
        try (var auth = mockStatic(AuthController.class)) {
            auth.when(() -> AuthController.getUserIdFromSession("s")).thenReturn(7L);
            when(members.hasWritePermission(10L, 7L)).thenReturn(true); assertWritesDenied();
            role("USER"); when(members.hasWritePermission(10L, 7L)).thenReturn(false); assertWritesDenied();
            verify(meetings, never()).create(any(), any()); verify(meetings, never()).finish(any(), any());
            verify(meetings, never()).delete(any(), any()); verify(transcription, never()).startTranscription(any());
        }
    }
    void assertWritesDenied() throws Exception {
        for (String path : List.of("/api/meetings/projects/10", "/api/meetings/20/finish", "/api/meetings/20/transcribe", "/api/meetings/20/export"))
            mvc.perform(post(path).header("X-Session-Id", "s")).andExpect(status().isForbidden());
        mvc.perform(post("/api/meetings/projects/10/register-file").header("X-Session-Id", "s")
                .contentType("application/json").content("{\"fileId\":1}")).andExpect(status().isForbidden());
        mvc.perform(patch("/api/meetings/20").header("X-Session-Id", "s")
                .contentType("application/json").content("{\"title\":\"changed\"}")).andExpect(status().isForbidden());
        mvc.perform(delete("/api/meetings/20").header("X-Session-Id", "s")).andExpect(status().isForbidden());
    }
}
