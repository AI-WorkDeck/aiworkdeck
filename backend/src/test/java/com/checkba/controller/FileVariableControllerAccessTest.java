// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.controller;

import com.checkba.model.entity.FileVariable;
import com.checkba.model.entity.ProjectFile;
import com.checkba.model.entity.User;
import com.checkba.repository.ProjectFileRepository;
import com.checkba.repository.UserRepository;
import com.checkba.service.FileVariableService;
import com.checkba.service.ProjectFileAccessService;
import com.checkba.service.ProjectMemberService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import java.util.List;
import java.util.Optional;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

class FileVariableControllerAccessTest {
    FileVariableService variables = mock(FileVariableService.class);
    ProjectMemberService members = mock(ProjectMemberService.class);
    ProjectFileRepository files = mock(ProjectFileRepository.class);
    UserRepository users = mock(UserRepository.class);
    ProjectFileAccessService access = new ProjectFileAccessService(members, users, files);
    MockMvc mvc;
    ProjectFile file;
    @BeforeEach void setup() {
        file = new ProjectFile(); file.setId(1L); file.setProjectId(10L); file.setUserId(2L);
        when(files.findById(1L)).thenReturn(Optional.of(file));
        when(members.hasReadPermission(10L, 7L)).thenReturn(true);
        role("USER");
        mvc = MockMvcBuilders.standaloneSetup(new FileVariableController(variables, members, files, access)).build();
    }
    void role(String role) {
        User user = new User(); user.setRole(role); when(users.findById(7L)).thenReturn(Optional.of(user));
    }
    @Test void privateFileVariablesAreHiddenFromProjectAndGlobalClients() throws Exception {
        try (var auth = mockStatic(AuthController.class)) {
            auth.when(() -> AuthController.getUserIdFromSession("s")).thenReturn(7L);
            when(members.isClient(10L, 7L)).thenReturn(true);
            deniedRead();
            when(members.isClient(10L, 7L)).thenReturn(false); role("CLIENT"); deniedRead();
            verifyNoInteractions(variables);
        }
    }
    void deniedRead() throws Exception {
        mvc.perform(get("/api/file-variables").param("fileId", "1").header("X-Session-Id", "s"))
                .andExpect(status().isForbidden()).andExpect(jsonPath("$.message").value(ProjectFileAccessService.UNAVAILABLE_MESSAGE));
    }
    @Test void internalMembersAndClientsWithOwnOrGrantedFilesCanRead() throws Exception {
        FileVariable value = new FileVariable(); value.setFileId(1L); value.setValue("allowed");
        when(variables.getVariables(1L)).thenReturn(List.of(value));
        try (var auth = mockStatic(AuthController.class)) {
            auth.when(() -> AuthController.getUserIdFromSession("s")).thenReturn(7L);
            allowedRead();
            role("CLIENT"); file.setUserId(7L); allowedRead();
            file.setUserId(2L); file.setClientVisible(true); allowedRead();
        }
    }
    void allowedRead() throws Exception {
        mvc.perform(get("/api/file-variables").param("fileId", "1").header("X-Session-Id", "s"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data[0].value").value("allowed"));
    }
    @Test void publicOrOwnFileStillRequiresProjectMembership() throws Exception {
        file.setUserId(7L); file.setClientVisible(true); when(members.hasReadPermission(10L, 7L)).thenReturn(false);
        try (var auth = mockStatic(AuthController.class)) {
            auth.when(() -> AuthController.getUserIdFromSession("s")).thenReturn(7L); deniedRead();
            verifyNoInteractions(variables);
        }
    }
    @Test void readOnlyMembersAndClientsCannotWriteOrDeleteEvenVisibleFiles() throws Exception {
        file.setClientVisible(true); when(variables.getFileIdById(30L)).thenReturn(1L);
        try (var auth = mockStatic(AuthController.class)) {
            auth.when(() -> AuthController.getUserIdFromSession("s")).thenReturn(7L);
            deniedWrites();
            when(members.hasWritePermission(10L, 7L)).thenReturn(true); role("CLIENT"); deniedWrites();
            verify(variables, never()).createOrUpdateVariable(any()); verify(variables, never()).deleteVariable(any());
        }
    }
    void deniedWrites() throws Exception {
        mvc.perform(post("/api/file-variables").header("X-Session-Id", "s").contentType("application/json")
                .content("{\"fileId\":1,\"name\":\"x\",\"value\":\"changed\"}")).andExpect(status().isForbidden());
        mvc.perform(delete("/api/file-variables/30").header("X-Session-Id", "s")).andExpect(status().isForbidden());
    }
    @Test void internalWriterCanSaveAndDelete() throws Exception {
        when(members.hasWritePermission(10L, 7L)).thenReturn(true); when(variables.getFileIdById(30L)).thenReturn(1L);
        when(variables.createOrUpdateVariable(any())).thenAnswer(i -> i.getArgument(0));
        try (var auth = mockStatic(AuthController.class)) {
            auth.when(() -> AuthController.getUserIdFromSession("s")).thenReturn(7L);
            mvc.perform(post("/api/file-variables").header("X-Session-Id", "s").contentType("application/json")
                    .content("{\"fileId\":1,\"name\":\"x\",\"value\":\"changed\"}"))
                    .andExpect(status().isOk()).andExpect(jsonPath("$.data.value").value("changed"));
            mvc.perform(delete("/api/file-variables/30").header("X-Session-Id", "s")).andExpect(status().isOk());
            verify(variables).deleteVariable(30L);
        }
    }
    @Test void requestCannotRetargetAnExistingVariableFromAnotherFile() throws Exception {
        when(members.hasWritePermission(10L, 7L)).thenReturn(true); when(variables.getFileIdById(30L)).thenReturn(99L);
        try (var auth = mockStatic(AuthController.class)) {
            auth.when(() -> AuthController.getUserIdFromSession("s")).thenReturn(7L);
            mvc.perform(post("/api/file-variables").header("X-Session-Id", "s").contentType("application/json")
                    .content("{\"id\":30,\"fileId\":1,\"name\":\"x\"}")).andExpect(status().isForbidden());
            verify(variables, never()).createOrUpdateVariable(any());
        }
    }
}
