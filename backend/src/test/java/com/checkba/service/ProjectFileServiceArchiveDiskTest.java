// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service;

import com.checkba.model.entity.ProjectFile;
import com.checkba.repository.ProjectFileRepository;
import com.checkba.storage.*;
import com.checkba.version.WorkSessionService;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.core.io.FileSystemResource;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.io.*;
import java.nio.file.*;
import java.util.Optional;
import java.util.zip.*;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class ProjectFileServiceArchiveDiskTest {
    @TempDir Path root;
    ProjectFileRepository repo;
    LocalFileStorageService storage;
    StorageServiceFactory factory;
    ProjectFileService service;
    WorkSessionService sessions;
    final byte[] photo = {0, (byte) 255, 10, 20};
    final String target = "projects/1/现场.jpg";

    @BeforeEach void setup() throws Exception {
        var props = new StorageProperties();
        props.getLocal().setRootPath(root.toString());
        props.getLocal().setTemplatePath(root.resolve("missing.docx").toString());
        storage = spy(new LocalFileStorageService(new ProjectStorageResolver(props, null)));
        factory = mock(StorageServiceFactory.class);
        when(factory.getStorageService()).thenReturn(storage);
        repo = mock(ProjectFileRepository.class);
        sessions = mock(WorkSessionService.class);
        service = new ProjectFileService(repo, null, factory, sessions, mock(UserService.class), null,
                mock(com.checkba.service.telemetry.TelemetryService.class), null);
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        try (ZipOutputStream zip = new ZipOutputStream(out)) {
            zip.putNextEntry(new ZipEntry("照片/现场.jpg"));
            zip.write(photo);
            zip.closeEntry();
        }
        var archive = new ProjectFile();
        archive.setId(10L); archive.setProjectId(1L); archive.setName("照片.zip");
        archive.setFileType("zip"); archive.setIsFolder(false); archive.setFilePath("projects/1/照片.zip");
        archive.setFileSize((long) out.size());
        when(repo.findById(10L)).thenReturn(Optional.of(archive));
        storage.save(archive.getFilePath(), new ByteArrayInputStream(out.toByteArray()));
        when(repo.saveAndFlush(any())).thenAnswer(call -> { ProjectFile f = call.getArgument(0); f.setId(20L); return f; });
    }

    ProjectFile importEntry() { return service.importArchiveEntry(1L, 10L, "照片/现场.jpg", null, 1L); }
    long fileCount() throws IOException { try (var files = Files.walk(root)) { return files.filter(Files::isRegularFile).count(); } }
    @AfterEach void clearTx() { if (TransactionSynchronizationManager.isSynchronizationActive()) TransactionSynchronizationManager.clearSynchronization(); }

    @Test void unindexedDiskFileIsNeverOverwritten() throws Exception {
        byte[] existing = "Finder original".getBytes();
        storage.save(target, new ByteArrayInputStream(existing));
        assertTrue(assertThrows(IllegalArgumentException.class, this::importEntry).getMessage().contains("未覆盖"));
        assertArrayEquals(existing, Files.readAllBytes(root.resolve(target)));
        assertEquals(2, fileCount());
        verify(repo, never()).saveAndFlush(any());
        verify(storage, never()).createFromTemplate(anyString());
    }

    @Test void concurrentDiskCreationWinsWithoutOverwrite() throws Exception {
        doAnswer(call -> {
            storage.save(call.getArgument(1), new ByteArrayInputStream("concurrent".getBytes()));
            return call.callRealMethod();
        }).when(storage).moveNew(anyString(), eq(target));
        assertThrows(IllegalArgumentException.class, this::importEntry);
        assertEquals("concurrent", Files.readString(root.resolve(target)));
        assertEquals(2, fileCount());
        verify(repo, never()).saveAndFlush(any());
    }

    @Test void failedStagingWriteLeavesNoTemplateOrPartialFile() throws Exception {
        doAnswer(call -> {
            call.callRealMethod();
            throw new StorageException("disk write failed");
        }).when(storage).save(contains("/.awd/archive-"), any());
        assertThrows(IllegalArgumentException.class, this::importEntry);
        assertFalse(Files.exists(root.resolve(target)));
        assertEquals(1, fileCount());
        verify(repo, never()).saveAndFlush(any());
        verify(storage, never()).createFromTemplate(anyString());
    }

    @Test void databaseFailureRemovesPublishedFile() throws Exception {
        doThrow(new IllegalStateException("db failed")).when(repo).saveAndFlush(any());
        assertThrows(IllegalStateException.class, this::importEntry);
        assertEquals(1, fileCount());
        verifyNoInteractions(sessions);
    }

    @Test void transactionRollbackRemovesPublishedFile() throws Exception {
        TransactionSynchronizationManager.initSynchronization();
        importEntry();
        assertEquals(2, fileCount());
        verifyNoInteractions(sessions);
        for (var sync : TransactionSynchronizationManager.getSynchronizations()) sync.afterCompletion(TransactionSynchronization.STATUS_ROLLED_BACK);
        assertEquals(1, fileCount());
    }

    @Test void successfulPublishPreservesBytesAndSignalsAfterCommit() throws Exception {
        TransactionSynchronizationManager.initSynchronization();
        ProjectFile result = importEntry();
        assertArrayEquals(photo, Files.readAllBytes(root.resolve(result.getFilePath())));
        assertEquals((long) photo.length, result.getFileSize());
        assertEquals(2, fileCount());
        verify(storage, never()).createFromTemplate(anyString());
        verifyNoInteractions(sessions);
        for (var sync : TransactionSynchronizationManager.getSynchronizations()) {
            sync.afterCommit(); sync.afterCompletion(TransactionSynchronization.STATUS_COMMITTED);
        }
        verify(sessions).onChangeSignal(eq(1L), eq(1L), anyString());
    }

    @Test void localZipPreviewSeeksFileWithoutReadingArchiveStream() {
        doReturn(new FileSystemResource(root.resolve("projects/1/照片.zip")) {
            @Override public InputStream getInputStream() { throw new AssertionError("Must not load the entire archive"); }
        }).when(storage).load("projects/1/照片.zip");
        assertArrayEquals(photo, service.readArchiveEntry(10L, "照片/现场.jpg").bytes());
    }
}
