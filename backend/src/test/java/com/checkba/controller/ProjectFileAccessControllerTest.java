// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.controller;

import com.checkba.model.entity.ProjectFile;
import com.checkba.model.entity.User;
import com.checkba.repository.ProjectFileRepository;
import com.checkba.repository.UserRepository;
import com.checkba.service.*;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.test.util.ReflectionTestUtils;
import java.util.Optional;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

class ProjectFileAccessControllerTest {
    ProjectMemberService members = mock(ProjectMemberService.class);
    UserRepository users = mock(UserRepository.class);
    ProjectFileRepository files = mock(ProjectFileRepository.class);
    ProjectFileService service = mock(ProjectFileService.class);
    DocumentTextService text = mock(DocumentTextService.class);
    DdService dd = mock(DdService.class);
    ProjectFileAccessService access = new ProjectFileAccessService(members, users, files);
    ProjectFile file;
    FileController downloads;
    MockMvc mvc;
    @BeforeEach void setup() {
        file = new ProjectFile(); file.setId(1L); file.setProjectId(10L); file.setUserId(2L);
        when(files.findById(1L)).thenReturn(Optional.of(file)); when(service.getFile(1L)).thenReturn(file);
        when(members.hasReadPermission(10L, 7L)).thenReturn(true);
        User client = new User(); client.setRole("CLIENT"); when(users.findById(7L)).thenReturn(Optional.of(client));
        when(dd.getProjectIdByItemId(20L)).thenReturn(10L); when(dd.getUploadedFile(20L)).thenReturn(file);
        downloads = new FileController();
        ReflectionTestUtils.setField(downloads, "projectFileRepository", files);
        ReflectionTestUtils.setField(downloads, "fileAccess", access);
        ReflectionTestUtils.setField(downloads, "documentTextService", text);
        mvc = MockMvcBuilders.standaloneSetup(downloads, new DdController(dd, members, access),
                new ProjectFileController(service, members, access, null, null, null, null)).build();
    }
    @Test void clientCannotBypassTreeByDirectDownloadTextLocalPathCompareOrDd() throws Exception {
        try (var auth = mockStatic(AuthController.class)) {
            auth.when(() -> AuthController.getUserIdFromSession("s")).thenReturn(7L);
            mvc.perform(get("/api/files/1/download").param("token", "s"))
                    .andExpect(status().isForbidden()).andExpect(content().string(ProjectFileAccessService.UNAVAILABLE_MESSAGE));
            for (String suffix : new String[]{"text", "local-path"}) {
                mvc.perform(get("/api/files/1/" + suffix).header("X-Session-Id", "s"))
                        .andExpect(status().isForbidden()).andExpect(jsonPath("$.message").value(ProjectFileAccessService.UNAVAILABLE_MESSAGE));
            }
            mvc.perform(get("/api/files/compare").param("sourceId", "1").param("targetId", "1").header("X-Session-Id", "s"))
                    .andExpect(status().isForbidden()).andExpect(jsonPath("$.message").value(ProjectFileAccessService.UNAVAILABLE_MESSAGE));
            mvc.perform(get("/api/dd/items/20/file").param("token", "s"))
                    .andExpect(status().isForbidden()).andExpect(jsonPath("$.message").value(ProjectFileAccessService.UNAVAILABLE_MESSAGE));
            verifyNoInteractions(text); verify(dd, never()).loadStored(any());
        }
    }
    @Test void clientsReadOwnUploadsOrExplicitlyVisibleFiles() throws Exception {
        when(text.extractText(file)).thenReturn("allowed");
        try (var auth = mockStatic(AuthController.class)) {
            auth.when(() -> AuthController.getUserIdFromSession("s")).thenReturn(7L);
            file.setUserId(7L);
            mvc.perform(get("/api/files/1/text").param("token", "s")).andExpect(status().isOk()).andExpect(jsonPath("$.data").value("allowed"));
            file.setUserId(2L); file.setClientVisible(true);
            mvc.perform(get("/api/files/1/text").param("token", "s")).andExpect(status().isOk()).andExpect(jsonPath("$.data").value("allowed"));
        }
    }
    @Test void accessEndpointRequiresActualBooleanAndInternalWritePermission() throws Exception {
        try (var auth = mockStatic(AuthController.class)) {
            auth.when(() -> AuthController.getUserIdFromSession("s")).thenReturn(7L);
            for (String body : new String[]{"{}", "{\"clientVisible\":null}", "{\"clientVisible\":\"true\"}", "{\"clientVisible\":1}"}) {
                mvc.perform(put("/api/projects/10/files/1/access").header("X-Session-Id", "s").contentType("application/json").content(body))
                        .andExpect(status().isBadRequest());
            }
            mvc.perform(put("/api/projects/10/files/1/access").header("X-Session-Id", "s").contentType("application/json").content("{\"clientVisible\":true}"))
                    .andExpect(status().isForbidden());
            User staff = new User(); staff.setRole("USER"); when(users.findById(7L)).thenReturn(Optional.of(staff));
            when(members.hasWritePermission(10L, 7L)).thenReturn(true); when(files.save(file)).thenReturn(file);
            mvc.perform(put("/api/projects/10/files/1/access").header("X-Session-Id", "s").contentType("application/json").content("{\"clientVisible\":true}"))
                    .andExpect(status().isOk()).andExpect(jsonPath("$.data.clientVisible").value(true))
                    .andExpect(jsonPath("$.data.canManageAccess").value(true));
            mvc.perform(get("/api/projects/10/files/1/access").header("X-Session-Id", "s"))
                    .andExpect(status().isOk()).andExpect(jsonPath("$.data.clientVisible").value(true))
                    .andExpect(jsonPath("$.data.canManageAccess").value(true));
            assertTrue(file.getClientVisible());
            verify(files).save(file);
        }
    }
    @Test void cannotSetAccessThroughAnotherProjectsUrl() {
        var controller = new ProjectFileController(service, members, access, null, null, null, null);
        try (var auth = mockStatic(AuthController.class)) {
            auth.when(() -> AuthController.getUserIdFromSession("s")).thenReturn(7L);
            assertThrows(IllegalArgumentException.class, () -> controller.updateFileAccess(
                    99L, 1L, java.util.Map.of("clientVisible", true), "s"));
            verify(files, never()).save(any());
        }
    }

}
