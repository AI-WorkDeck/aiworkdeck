// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service;

import com.checkba.model.entity.DdSubmission;
import com.checkba.model.entity.ProjectFile;
import com.checkba.repository.DdSubmissionRepository;
import com.checkba.repository.ProjectFileRepository;
import com.checkba.storage.*;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.test.util.ReflectionTestUtils;

import java.io.ByteArrayInputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class DdOriginalGuardTest {
    @TempDir Path root;
    DdSubmissionRepository submissions = mock(DdSubmissionRepository.class);
    ProjectFileRepository files = mock(ProjectFileRepository.class);
    LocalFileStorageService storage;
    DdOriginalGuard guard;
    ProjectFile original, folder;
    String key = "projects/1/client_uploads/original.pdf";

    @BeforeEach void setup() throws Exception {
        StorageProperties properties = new StorageProperties(); properties.getLocal().setRootPath(root.toString());
        properties.getLocal().setTemplatePath(root.resolve("none.docx").toString());
        ProjectStorageResolver resolver = new ProjectStorageResolver(properties, null);
        storage = new LocalFileStorageService(resolver);
        storage.save(key, bytes("原件"));
        original = new ProjectFile(); original.setId(9L); original.setProjectId(1L); original.setParentId(1L);
        original.setName("原件.pdf"); original.setFilePath(key); original.setIsFolder(false);
        folder = new ProjectFile(); folder.setId(1L); folder.setProjectId(1L); folder.setName("材料"); folder.setIsFolder(true);
        DdSubmission submission = new DdSubmission(); submission.setProjectId(1L); submission.setFileIds(List.of(9L));
        when(submissions.findByProjectId(1L)).thenReturn(List.of(submission));
        when(files.findAllById(any())).thenReturn(List.of(original));
        when(files.findByProjectId(1L)).thenReturn(List.of(folder, original));
        guard = new DdOriginalGuard(submissions, files, resolver);
        ReflectionTestUtils.setField(storage, "ddOriginalGuard", guard);
    }
    ByteArrayInputStream bytes(String text) { return new ByteArrayInputStream(text.getBytes(java.nio.charset.StandardCharsets.UTF_8)); }
    String originalText() throws Exception { return Files.readString(root.resolve(key)); }

    @Test void everyStorageMutationRejectsOriginalAndLeavesItsBytes() throws Exception {
        assertThrows(IllegalArgumentException.class, () -> storage.save(key, bytes("改写")));
        assertThrows(IllegalArgumentException.class, () -> storage.append(key, bytes("追加")));
        assertThrows(IllegalArgumentException.class, () -> storage.delete(key));
        assertThrows(IllegalArgumentException.class, () -> storage.move(key, "projects/1/other.pdf"));
        assertThrows(IllegalArgumentException.class, () -> storage.moveNew(key, "projects/1/other.pdf"));
        storage.save("projects/1/new.pdf", bytes("替换"));
        assertThrows(IllegalArgumentException.class, () -> storage.move("projects/1/new.pdf", key));
        assertThrows(IllegalArgumentException.class, () -> storage.moveNew("projects/1/new.pdf", key));
        assertEquals("原件", originalText());
    }

    @Test void normalizedAliasAndParentFolderCannotEvadeProtection() throws Exception {
        assertThrows(IllegalArgumentException.class, () -> storage.save("projects/1/client_uploads/../client_uploads/original.pdf", bytes("改写")));
        assertThrows(IllegalArgumentException.class, () -> storage.delete("projects/1/client_uploads"));
        assertThrows(IllegalArgumentException.class, () -> storage.move("projects/1", "projects/2"));
        assertEquals("原件", originalText());
    }

    @Test void recursiveDeletionIsRejectedBeforeAnyRowsOrBytesChange() throws Exception {
        ProjectFileService service = new ProjectFileService(files, null, mock(StorageServiceFactory.class), null, null, null, null, null);
        ReflectionTestUtils.setField(service, "ddOriginalGuard", guard);
        when(files.findById(1L)).thenReturn(Optional.of(folder));
        assertThrows(IllegalArgumentException.class, () -> service.delete(1L, 11L));
        assertThrows(IllegalArgumentException.class, () -> service.permDelete(1L, 11L));
        assertThrows(IllegalArgumentException.class, () -> service.permDelete(1L, 11L, true));
        verify(files, never()).save(any()); verify(files, never()).deleteById(any());
        assertEquals("原件", originalText());
    }

    @Test void copiesAreEditableAndWholeProjectRemovalCanClearReferencesFirst() throws Exception {
        storage.save("projects/1/copy.pdf", storage.load(key).getInputStream());
        storage.save("projects/1/copy.pdf", bytes("工作副本"));
        assertEquals("原件", originalText());
        when(submissions.findByProjectId(1L)).thenReturn(List.of());
        assertDoesNotThrow(() -> storage.delete(key));
        assertFalse(storage.exists(key));
    }
}
