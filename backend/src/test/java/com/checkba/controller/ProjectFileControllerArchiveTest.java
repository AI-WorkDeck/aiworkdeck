// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.controller;

import com.checkba.exception.UnauthorizedException;
import com.checkba.model.entity.ProjectFile;
import com.checkba.service.FileTagService;
import com.checkba.service.ProjectFileAccessService;
import com.checkba.service.ProjectFileService;
import com.checkba.service.ProjectMemberService;
import com.checkba.service.quota.StageQuotaService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.MockedStatic;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.ContentDisposition;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class ProjectFileControllerArchiveTest {
    @Mock private ProjectFileService projectFileService;
    @Mock private ProjectMemberService projectMemberService;
    @Mock private ProjectFileAccessService fileAccess;
    @Mock private FileTagService fileTagService;
    @Mock private StageQuotaService stageQuotaService;
    @InjectMocks private ProjectFileController controller;

    private ProjectFile archive(long projectId) {
        ProjectFile file = new ProjectFile();
        file.setId(10L);
        file.setProjectId(projectId);
        return file;
    }

    private ProjectFileController.ImportArchiveEntryRequest request(Long parentId) {
        var request = new ProjectFileController.ImportArchiveEntryRequest();
        request.setPath("照片/现场.jpg");
        request.setParentId(parentId);
        return request;
    }

    @Test
    void readAndImportRequireSession() {
        try (MockedStatic<AuthController> auth = mockStatic(AuthController.class)) {
            auth.when(() -> AuthController.getUserIdFromSession(null)).thenReturn(null);
            assertThrows(UnauthorizedException.class, () -> controller.readArchiveEntry(1L, 10L, "x", null));
            assertThrows(UnauthorizedException.class, () -> controller.importArchiveEntry(1L, 10L, request(null), null));
            verifyNoInteractions(projectFileService);
        }
    }

    @Test
    void readRejectsNonMemberAndClient() {
        try (MockedStatic<AuthController> auth = mockStatic(AuthController.class)) {
            auth.when(() -> AuthController.getUserIdFromSession("sess")).thenReturn(1L);
            assertThrows(IllegalArgumentException.class, () -> controller.readArchiveEntry(1L, 10L, "x", "sess"));
            when(projectMemberService.hasReadPermission(1L, 1L)).thenReturn(true);
            when(fileAccess.isClient(1L, 1L)).thenReturn(true);
            assertThrows(IllegalArgumentException.class, () -> controller.readArchiveEntry(1L, 10L, "x", "sess"));
            verifyNoInteractions(projectFileService);
        }
    }

    @Test
    void readRejectsArchiveInAnotherProject() {
        try (MockedStatic<AuthController> auth = mockStatic(AuthController.class)) {
            auth.when(() -> AuthController.getUserIdFromSession("sess")).thenReturn(1L);
            when(projectMemberService.hasReadPermission(1L, 1L)).thenReturn(true);
            when(projectFileService.getFile(10L)).thenReturn(archive(99L));
            assertThrows(IllegalArgumentException.class, () -> controller.readArchiveEntry(1L, 10L, "x", "sess"));
            verify(projectFileService, never()).readArchiveEntry(anyLong(), anyString());
        }
    }

    @Test
    void readUsesSafeHeadersAndPreservesBytesAndChineseFilename() {
        try (MockedStatic<AuthController> auth = mockStatic(AuthController.class)) {
            auth.when(() -> AuthController.getUserIdFromSession("sess")).thenReturn(1L);
            when(projectMemberService.hasReadPermission(1L, 1L)).thenReturn(true);
            when(projectFileService.getFile(10L)).thenReturn(archive(1L));
            byte[] data = {0, (byte) 255};
            for (String name : new String[]{"现场.jpg", "恶意.html", "脚本.svg"}) {
                when(projectFileService.readArchiveEntry(10L, name)).thenReturn(new ProjectFileService.ArchiveEntryContent(name, data));
                var response = controller.readArchiveEntry(1L, 10L, name, "sess");
                assertArrayEquals(data, response.getBody());
                assertEquals(name, ContentDisposition.parse(response.getHeaders().getFirst("Content-Disposition")).getFilename());
                assertEquals("attachment", ContentDisposition.parse(response.getHeaders().getFirst("Content-Disposition")).getType());
                assertEquals("nosniff", response.getHeaders().getFirst("X-Content-Type-Options"));
                assertEquals("sandbox; default-src 'none'", response.getHeaders().getFirst("Content-Security-Policy"));
                assertEquals(name.endsWith("jpg") ? "image/jpeg" : "application/octet-stream", response.getHeaders().getFirst("Content-Type"));
            }
        }
    }

    @Test
    void importRequiresWritePermission() {
        try (MockedStatic<AuthController> auth = mockStatic(AuthController.class)) {
            auth.when(() -> AuthController.getUserIdFromSession("sess")).thenReturn(1L);
            when(projectMemberService.hasReadPermission(1L, 1L)).thenReturn(true);
            assertThrows(IllegalArgumentException.class, () -> controller.importArchiveEntry(1L, 10L, request(null), "sess"));
            verifyNoInteractions(projectFileService);
        }
    }

    @Test
    void importRejectsForeignArchiveAndInvalidTarget() {
        try (MockedStatic<AuthController> auth = mockStatic(AuthController.class)) {
            auth.when(() -> AuthController.getUserIdFromSession("sess")).thenReturn(1L);
            when(projectMemberService.hasReadPermission(1L, 1L)).thenReturn(true);
            when(projectMemberService.hasWritePermission(1L, 1L)).thenReturn(true);
            when(projectFileService.getFile(10L)).thenReturn(archive(99L));
            assertThrows(IllegalArgumentException.class, () -> controller.importArchiveEntry(1L, 10L, request(null), "sess"));
            when(projectFileService.getFile(10L)).thenReturn(archive(1L));
            ProjectFile parent = archive(99L);
            parent.setIsFolder(true);
            when(projectFileService.getFile(50L)).thenReturn(parent);
            assertThrows(IllegalArgumentException.class, () -> controller.importArchiveEntry(1L, 10L, request(50L), "sess"));
            parent.setProjectId(1L);
            parent.setIsDeleted(true);
            assertThrows(IllegalArgumentException.class, () -> controller.importArchiveEntry(1L, 10L, request(50L), "sess"));
            parent.setIsDeleted(false);
            parent.setIsFolder(false);
            assertThrows(IllegalArgumentException.class, () -> controller.importArchiveEntry(1L, 10L, request(50L), "sess"));
            verify(projectFileService, never()).importArchiveEntry(anyLong(), anyLong(), anyString(), any(), anyLong());
        }
    }

    @Test
    void importAcceptsRootAndValidFolder() {
        try (MockedStatic<AuthController> auth = mockStatic(AuthController.class)) {
            auth.when(() -> AuthController.getUserIdFromSession("sess")).thenReturn(1L);
            when(projectMemberService.hasReadPermission(1L, 1L)).thenReturn(true);
            when(projectMemberService.hasWritePermission(1L, 1L)).thenReturn(true);
            when(projectFileService.getFile(10L)).thenReturn(archive(1L));
            controller.importArchiveEntry(1L, 10L, request(0L), "sess");
            verify(projectFileService).importArchiveEntry(1L, 10L, "照片/现场.jpg", null, 1L);
            ProjectFile folder = archive(1L);
            folder.setIsFolder(true);
            when(projectFileService.getFile(50L)).thenReturn(folder);
            controller.importArchiveEntry(1L, 10L, request(50L), "sess");
            verify(projectFileService).importArchiveEntry(1L, 10L, "照片/现场.jpg", 50L, 1L);
        }
    }
}
