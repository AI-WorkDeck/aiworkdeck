// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service;

import com.checkba.model.entity.Project;
import com.checkba.model.entity.ProjectFile;
import com.checkba.repository.ProjectFileRepository;
import com.checkba.repository.ProjectRepository;
import com.checkba.storage.LocalFileStorageService;
import com.checkba.storage.ProjectStorageResolver;
import com.checkba.storage.StorageProperties;
import com.checkba.storage.StorageServiceFactory;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

/** Real local storage is essential: a storage mock cannot detect same-path moves deleting the file. */
class ProjectFileMovePhysicalTest {
    @TempDir Path root;
    private ProjectFileRepository files;
    private ProjectFileService service;
    private static final byte[] CONTENT = "合成合同内容\nsecond line\n".getBytes(java.nio.charset.StandardCharsets.UTF_8);

    @BeforeEach
    void setUp() {
        Project project = new Project();
        project.setId(1L);
        project.setLocalRoot(root.toString());
        ProjectRepository projects = mock(ProjectRepository.class);
        when(projects.findById(1L)).thenReturn(Optional.of(project));
        StorageProperties properties = new StorageProperties();
        properties.getLocal().setRootPath(root.resolve("storage").toString());
        properties.getLocal().setTemplatePath(root.resolve("template.docx").toString());
        ProjectStorageResolver resolver = new ProjectStorageResolver(properties, projects);
        StorageServiceFactory factory = mock(StorageServiceFactory.class);
        when(factory.getStorageService()).thenReturn(new LocalFileStorageService(resolver));
        files = mock(ProjectFileRepository.class);
        when(files.save(any(ProjectFile.class))).thenAnswer(inv -> inv.getArgument(0));
        service = new ProjectFileService(files, mock(com.checkba.service.ai.ProjectRagService.class),
                factory, mock(com.checkba.version.WorkSessionService.class), mock(UserService.class),
                mock(com.checkba.service.quota.StageQuotaService.class),
                mock(com.checkba.service.telemetry.TelemetryService.class),
                mock(com.checkba.service.evidence.EvidenceLinkService.class));
        service.setStorageResolverForTest(resolver);
    }

    private ProjectFile folder() throws Exception {
        ProjectFile folder = new ProjectFile();
        folder.setId(5L);
        folder.setProjectId(1L);
        folder.setName("归档");
        folder.setIsFolder(true);
        when(files.findById(5L)).thenReturn(Optional.of(folder));
        Files.createDirectories(root.resolve("归档"));
        return folder;
    }

    private ProjectFile document(Long parentId, String relativePath) throws Exception {
        ProjectFile file = new ProjectFile();
        file.setId(10L);
        file.setProjectId(1L);
        file.setParentId(parentId);
        file.setIsFolder(false);
        file.setName("合同.txt");
        file.setFilePath("projects/1/" + relativePath);
        file.setSortOrder(1);
        when(files.findById(10L)).thenReturn(Optional.of(file));
        Files.write(root.resolve(relativePath), CONTENT);
        return file;
    }

    @Test
    void rootReorderPreservesPhysicalFileAndUpdatesSortOrder() throws Exception {
        ProjectFile original = document(null, "合同.txt");
        ProjectFile moved = service.move(original.getId(), 0L, 12, 1L);

        assertTrue(Files.exists(root.resolve("合同.txt")), "排序不能删除原文件");
        assertArrayEquals(CONTENT, Files.readAllBytes(root.resolve("合同.txt")));
        assertEquals(original.getId(), moved.getId());
        assertEquals("projects/1/合同.txt", moved.getFilePath());
        assertNull(moved.getParentId());
        assertEquals(12, moved.getSortOrder());
        verify(files).save(moved);
    }

    @Test
    void sameFolderReorderPreservesPhysicalFileAndUpdatesSortOrder() throws Exception {
        ProjectFile parent = folder();
        ProjectFile original = document(parent.getId(), "归档/合同.txt");
        ProjectFile moved = service.move(original.getId(), parent.getId(), 7, 1L);

        assertTrue(Files.exists(root.resolve("归档/合同.txt")), "同目录排序不能删除原文件");
        assertArrayEquals(CONTENT, Files.readAllBytes(root.resolve("归档/合同.txt")));
        assertEquals(original.getId(), moved.getId());
        assertEquals("projects/1/归档/合同.txt", moved.getFilePath());
        assertEquals(parent.getId(), moved.getParentId());
        assertEquals(7, moved.getSortOrder());
    }

    @Test
    void moveToAnotherFolderRelocatesOriginalBytes() throws Exception {
        ProjectFile parent = folder();
        ProjectFile original = document(null, "合同.txt");
        ProjectFile moved = service.move(original.getId(), parent.getId(), 9, 1L);

        assertFalse(Files.exists(root.resolve("合同.txt")), "跨目录移动应移除原位置");
        assertArrayEquals(CONTENT, Files.readAllBytes(root.resolve("归档/合同.txt")));
        assertEquals(original.getId(), moved.getId());
        assertEquals("projects/1/归档/合同.txt", moved.getFilePath());
        assertEquals(parent.getId(), moved.getParentId());
        assertEquals(9, moved.getSortOrder());
    }
}
