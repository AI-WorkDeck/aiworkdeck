// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.controller;

import com.checkba.model.entity.ProjectFile;
import com.checkba.service.*;
import com.checkba.storage.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.core.io.FileSystemResource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.file.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

class SensitiveControllerTest {
    @TempDir Path dir;
    private final ProjectFileService files = mock(ProjectFileService.class);
    private final ProjectMemberService members = mock(ProjectMemberService.class);
    private final StorageServiceFactory storage = mock(StorageServiceFactory.class);
    private final StorageService local = mock(StorageService.class);
    private final ObjectMapper json = new ObjectMapper();
    private final ProjectFileAccessService fileAccess = mock(ProjectFileAccessService.class);
    private MockMvc mvc() { return MockMvcBuilders.standaloneSetup(new SensitiveController(new SensitiveService(), storage, files, members, fileAccess)).build(); }
    private void file() throws Exception {
        Path path = dir.resolve("input.txt"); Files.writeString(path, "甲方：北京星河科技有限公司。电话13800001111");
        var source = new ProjectFile(); source.setId(1L); source.setProjectId(2L); source.setFilePath("projects/2/input.txt");
        when(files.getFile(1L)).thenReturn(source);
        when(storage.getStorageService()).thenReturn(local);
        when(local.load(source.getFilePath())).thenReturn(new FileSystemResource(path));
    }

    @Test void previousCustomWordsPayloadRemainsSupported() throws Exception {
        var request = json.readValue("{\"fileId\":1,\"customWords\":[\"张三\"]}", SensitiveController.Request.class);
        assertEquals(List.of("张三"), request.options().customTerms());
        assertEquals("MASK", request.options().mode());
    }

    @Test void allOperationsRequireAuthenticationBeforeStorageAccess() throws Exception {
        try (var auth = mockStatic(AuthController.class)) {
            auth.when(() -> AuthController.getUserIdFromSession(null)).thenReturn(null);
            for (String action : List.of("preview", "desensitize", "restore", "recovery")) {
                mvc().perform(post("/api/sensitive/" + action).contentType("application/json").content("{\"fileId\":1}"))
                        .andExpect(status().isUnauthorized());
            }
            verifyNoInteractions(files, storage);
        }
    }

    @Test void viewerCanPreviewButCannotCreateRedactedOrRestoredFiles() throws Exception {
        file(); when(members.hasReadPermission(2L, 9L)).thenReturn(true);
        try (var auth = mockStatic(AuthController.class)) {
            auth.when(() -> AuthController.getUserIdFromSession("s")).thenReturn(9L);
            String body = "{\"fileId\":1,\"strategies\":[\"PHONE\",\"COMPANY\"],\"mode\":\"TOKEN\"}";
            mvc().perform(post("/api/sensitive/preview").header("X-Session-Id", "s").contentType("application/json").content(body))
                    .andExpect(status().isOk()).andExpect(header().string("Cache-Control", "no-store"))
                    .andExpect(jsonPath("$.counts.COMPANY").value(1)).andExpect(jsonPath("$.counts.PHONE").value(1));
            for (String action : List.of("desensitize", "restore")) {
                mvc().perform(post("/api/sensitive/" + action).header("X-Session-Id", "s").contentType("application/json").content(body))
                        .andExpect(status().isForbidden());
            }
            try (var list = Files.list(dir)) { assertEquals(1, list.count()); }
        }
    }

    @Test void responseContainsOnlyEncryptedKitAndRegisteredRedactedFile() throws Exception {
        file(); when(members.hasReadPermission(2L, 9L)).thenReturn(true); when(members.hasWritePermission(2L, 9L)).thenReturn(true);
        when(files.createFile(eq(2L), isNull(), anyString(), eq("txt"), anyLong(), anyString(), anyString(), eq(9L)))
                .thenAnswer(call -> { var f = new ProjectFile(); f.setId(3L); f.setName(call.getArgument(2)); return f; });
        try (var auth = mockStatic(AuthController.class)) {
            auth.when(() -> AuthController.getUserIdFromSession("s")).thenReturn(9L);
            String body = json.writeValueAsString(Map.of("fileId", 1, "strategies", List.of("COMPANY", "PHONE"), "mode", "TOKEN", "password", "test-password-2026"));
            String output = mvc().perform(post("/api/sensitive/desensitize").header("X-Session-Id", "s").contentType("application/json").content(body))
                    .andExpect(status().isOk()).andExpect(header().string("Cache-Control", "no-store"))
                    .andExpect(jsonPath("$.file.id").value(3)).andReturn().getResponse().getContentAsString(java.nio.charset.StandardCharsets.UTF_8);
            assertFalse(output.contains("13800001111")); assertFalse(output.contains("星河")); assertFalse(output.contains("test-password"));
            assertTrue(json.readTree(output).get("recoveryKit").asText().startsWith("AWD-RECOVERY-1:"));
        }
    }

    @Test void projectRecoveryPersistsAndReloadsWithShortPassword() throws Exception {
        file(); when(members.hasReadPermission(2L, 9L)).thenReturn(true); when(members.hasWritePermission(2L, 9L)).thenReturn(true);
        List<ProjectFile> registered = new ArrayList<>();
        when(files.createFile(eq(2L), isNull(), anyString(), anyString(), anyLong(), anyString(), anyString(), eq(9L)))
                .thenAnswer(call -> {
                    var f = new ProjectFile(); f.setId(10L + registered.size()); f.setProjectId(2L);
                    f.setName(call.getArgument(2)); f.setFileType(call.getArgument(3)); f.setFilePath(call.getArgument(5));
                    registered.add(f); when(files.getFile(f.getId())).thenReturn(f);
                    when(local.load(f.getFilePath())).thenReturn(new FileSystemResource(dir.resolve(f.getName())));
                    return f;
                });
        when(files.getFilesByParent(2L, null)).thenAnswer(call -> registered);
        try (var auth = mockStatic(AuthController.class)) {
            auth.when(() -> AuthController.getUserIdFromSession("s")).thenReturn(9L);
            String body = json.writeValueAsString(Map.of("fileId", 1, "strategies", List.of("PHONE"), "mode", "TOKEN", "password", "1"));
            String output = mvc().perform(post("/api/sensitive/desensitize").header("X-Session-Id", "s").contentType("application/json").content(body))
                    .andExpect(status().isOk()).andReturn().getResponse().getContentAsString(java.nio.charset.StandardCharsets.UTF_8);
            assertEquals(2, registered.size());
            var kit = registered.get(0); var redacted = registered.get(1);
            assertEquals(redacted.getFilePath() + ".awd-recovery", kit.getFilePath());
            String encrypted = Files.readString(dir.resolve(kit.getName()));
            assertEquals(json.readTree(output).get("recoveryKit").asText(), encrypted);
            assertFalse(encrypted.contains("13800001111"));
            for (Long id : List.of(redacted.getId(), kit.getId())) {
                mvc().perform(post("/api/sensitive/recovery").header("X-Session-Id", "s").contentType("application/json")
                        .content(json.writeValueAsString(Map.of("fileId", id))))
                        .andExpect(status().isOk()).andExpect(header().string("Cache-Control", "no-store"))
                        .andExpect(jsonPath("$.recoveryKit").value(encrypted));
            }
            String restored = mvc().perform(post("/api/sensitive/restore").header("X-Session-Id", "s").contentType("application/json")
                    .content(json.writeValueAsString(Map.of("fileId", redacted.getId(), "recoveryKit", encrypted, "password", "1"))))
                    .andExpect(status().isOk()).andReturn().getResponse().getContentAsString(java.nio.charset.StandardCharsets.UTF_8);
            assertEquals(Files.readString(dir.resolve("input.txt")), Files.readString(dir.resolve(json.readTree(restored).get("file").get("name").asText())));
        }
    }

    @Test void absentProjectRecoveryDoesNotPickUnrelatedMaterial() throws Exception {
        file(); when(members.hasReadPermission(2L, 9L)).thenReturn(true);
        var kit = new ProjectFile(); kit.setId(3L); kit.setProjectId(2L); kit.setFilePath("projects/2/other.txt.awd-recovery");
        when(files.getFilesByParent(2L, null)).thenReturn(List.of(kit));
        try (var auth = mockStatic(AuthController.class)) {
            auth.when(() -> AuthController.getUserIdFromSession("s")).thenReturn(9L);
            mvc().perform(post("/api/sensitive/recovery").header("X-Session-Id", "s").contentType("application/json").content("{\"fileId\":1}"))
                    .andExpect(status().isOk()).andExpect(jsonPath("$.recoveryKit").value(""));
            verify(local, never()).load(kit.getFilePath());
        }
    }

    @Test void failedDocumentRegistrationPurgesOnlyTheNewRecoveryMaterial() throws Exception {
        file(); when(members.hasReadPermission(2L, 9L)).thenReturn(true); when(members.hasWritePermission(2L, 9L)).thenReturn(true);
        var kit = new ProjectFile(); kit.setId(3L);
        when(files.createFile(eq(2L), isNull(), anyString(), eq("awd-recovery"), anyLong(), anyString(), anyString(), eq(9L))).thenReturn(kit);
        when(files.createFile(eq(2L), isNull(), anyString(), eq("txt"), anyLong(), anyString(), anyString(), eq(9L))).thenThrow(new RuntimeException("registration failed"));
        try (var auth = mockStatic(AuthController.class)) {
            auth.when(() -> AuthController.getUserIdFromSession("s")).thenReturn(9L);
            mvc().perform(post("/api/sensitive/desensitize").header("X-Session-Id", "s").contentType("application/json")
                    .content(json.writeValueAsString(Map.of("fileId", 1, "strategies", List.of("PHONE"), "mode", "TOKEN", "password", "1"))))
                    .andExpect(status().isInternalServerError());
            verify(files).permDelete(3L, 9L);
            verify(files, never()).delete(anyLong(), anyLong());
            try (var paths = Files.list(dir)) { assertEquals(List.of("input.txt"), paths.map(path -> path.getFileName().toString()).toList()); }
        }
    }

    @Test void matchedRecoveryRequiresItsOwnReadPermission() throws Exception {
        file(); when(members.hasReadPermission(2L, 9L)).thenReturn(true);
        var kit = new ProjectFile(); kit.setId(3L); kit.setProjectId(2L); kit.setFilePath("projects/2/input.txt.awd-recovery");
        when(files.getFilesByParent(2L, null)).thenReturn(List.of(kit));
        doThrow(new ProjectFileAccessService.FileAccessDeniedException()).when(fileAccess).requireRead(kit, 9L);
        try (var auth = mockStatic(AuthController.class)) {
            auth.when(() -> AuthController.getUserIdFromSession("s")).thenReturn(9L);
            mvc().perform(post("/api/sensitive/recovery").header("X-Session-Id", "s").contentType("application/json").content("{\"fileId\":1}"))
                    .andExpect(status().isForbidden());
            verify(local, never()).load(kit.getFilePath());
        }
    }

    @Test void globalClientCannotPreviewPrivateTextEvenWithProjectReadPermission() throws Exception {
        var source = new ProjectFile(); source.setId(1L); source.setProjectId(2L); source.setUserId(4L);
        when(files.getFile(1L)).thenReturn(source);
        when(members.hasReadPermission(2L, 9L)).thenReturn(true);
        var users = mock(com.checkba.repository.UserRepository.class);
        var customer = new com.checkba.model.entity.User(); customer.setRole("CLIENT");
        when(users.findById(9L)).thenReturn(Optional.of(customer));
        var gate = new ProjectFileAccessService(members, users, mock(com.checkba.repository.ProjectFileRepository.class));
        MockMvc guarded = MockMvcBuilders.standaloneSetup(new SensitiveController(new SensitiveService(), storage, files, members, gate)).build();
        try (var auth = mockStatic(AuthController.class)) {
            auth.when(() -> AuthController.getUserIdFromSession("s")).thenReturn(9L);
            guarded.perform(post("/api/sensitive/preview").header("X-Session-Id", "s")
                    .contentType("application/json").content("{\"fileId\":1}"))
                    .andExpect(status().isForbidden()).andExpect(jsonPath("$.error").value(ProjectFileAccessService.UNAVAILABLE_MESSAGE));
            verifyNoInteractions(storage);
        }
    }

}
