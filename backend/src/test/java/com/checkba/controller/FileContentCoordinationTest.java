// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.controller;

import com.checkba.model.entity.ProjectFile;
import com.checkba.repository.ProjectFileRepository;
import com.checkba.service.ProjectFileAccessService;
import com.checkba.service.ProjectMemberService;
import com.checkba.service.ai.EditorBridgeService;
import com.checkba.service.ai.context.ProjectContextHolder;
import com.checkba.service.ai.tools.TextFileEditTools;
import com.checkba.storage.ProjectStorageResolver;
import com.checkba.storage.StorageService;
import com.checkba.storage.StorageServiceFactory;
import com.checkba.version.*;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.core.io.FileSystemResource;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.scheduling.TaskScheduler;
import org.springframework.test.util.ReflectionTestUtils;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Optional;
import java.util.concurrent.*;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** Real canonical version lock and disk bytes; latches expose the old uncoordinated writers. */
class FileContentCoordinationTest {
    @TempDir Path directory;
    private WorkSessionService sessions;
    private FileController controller;
    private TextFileEditTools textTools;
    private StorageService storage;
    private Path document;
    private ProjectFileRepository files;
    private EditorBridgeService bridge;

    @BeforeEach void prepare() throws Exception {
        files = mock(ProjectFileRepository.class);
        ProjectFile file = new ProjectFile();
        file.setId(11L); file.setProjectId(7L); file.setUserId(3L);
        file.setName("note.txt"); file.setFileType("txt"); file.setFilePath("projects/7/note.txt");
        when(files.findById(11L)).thenReturn(Optional.of(file));
        when(files.save(any())).thenAnswer(i -> i.getArgument(0));
        ProjectMemberService members = mock(ProjectMemberService.class);
        when(members.hasWritePermission(7L, 3L)).thenReturn(true);
        StorageServiceFactory factory = mock(StorageServiceFactory.class);
        storage = mock(StorageService.class);
        when(factory.getStorageService()).thenReturn(storage);
        document = directory.resolve("note.txt");
        Files.writeString(document, "old");
        when(storage.getSize(anyString())).thenAnswer(i -> Files.size(document));
        sessions = spy(new WorkSessionService(mock(ProjectRepoService.class), mock(ProjectTreeManifestService.class),
                mock(WorkSessionRepository.class), mock(TaskScheduler.class), files, event -> {}));
        doNothing().when(sessions).onChangeSignal(anyLong(), any(), any());
        controller = new FileController();
        ReflectionTestUtils.setField(controller, "projectFileRepository", files);
        ReflectionTestUtils.setField(controller, "projectMemberService", members);
        ReflectionTestUtils.setField(controller, "fileAccess", mock(ProjectFileAccessService.class));
        ReflectionTestUtils.setField(controller, "storageResolver", mock(ProjectStorageResolver.class));
        ReflectionTestUtils.setField(controller, "storageServiceFactory", factory);
        ReflectionTestUtils.setField(controller, "workSessionService", sessions);
        // Avoid post-processing tasks in this lock regression fixture.
        ReflectionTestUtils.setField(controller, "taskExecutor", (java.util.concurrent.Executor) command -> {});
        var content = com.checkba.service.ContentServiceTestSupport.create(files, factory, members,
                mock(ProjectFileAccessService.class), mock(ProjectStorageResolver.class), sessions);
        ReflectionTestUtils.setField(controller, "contentService", content);
        bridge = mock(EditorBridgeService.class);
        textTools = new TextFileEditTools(files, content, sessions, bridge, null);
    }

    @Test void busyVersionLockReturnsKnownNotStartedWithoutPublishing() throws Exception {
        CountDownLatch acquired = new CountDownLatch(1), release = new CountDownLatch(1);
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            Future<?> holder = pool.submit(() -> sessions.runLocked(7L, () -> {
                acquired.countDown();
                try { assertTrue(release.await(5, TimeUnit.SECONDS)); } catch (InterruptedException e) { throw new RuntimeException(e); }
            }));
            assertTrue(acquired.await(3, TimeUnit.SECONDS));
            var response = pool.submit(() -> uploadResponse()).get(4, TimeUnit.SECONDS);
            assertEquals(423, response.getStatusCode().value());
            assertEquals("VERSION_BUSY", response.getBody().get("reason"));
            assertEquals("not_started", response.getBody().get("writeState"));
            verify(storage, never()).save(anyString(), any());
            assertEquals("old", Files.readString(document));
            release.countDown(); holder.get(3, TimeUnit.SECONDS);
        } finally { release.countDown(); pool.shutdownNow(); }
    }

    @Test void downstreamBusyAfterPublicationNeverClaimsNotStarted() throws Exception {
        when(storage.save(anyString(), any())).thenAnswer(i -> {
            Files.writeString(document, "published"); throw VersionException.busy("downstream failure");
        });
        var response = uploadResponse();
        assertEquals(500, response.getStatusCode().value());
        assertFalse(response.getBody().containsKey("writeState"));
        assertEquals("published", Files.readString(document));
    }

    @Test void receivingSlowUploadDoesNotHoldVersionLockOrTransaction() throws Exception {
        CountDownLatch receiving = new CountDownLatch(1), release = new CountDownLatch(1);
        var input = new java.io.InputStream() {
            private final java.io.ByteArrayInputStream source = new java.io.ByteArrayInputStream("complete".getBytes(java.nio.charset.StandardCharsets.UTF_8));
            public int read() { return source.read(); }
            public int read(byte[] bytes, int offset, int length) {
                assertFalse(org.springframework.transaction.support.TransactionSynchronizationManager.isActualTransactionActive());
                receiving.countDown();
                try { assertTrue(release.await(5, TimeUnit.SECONDS)); } catch (InterruptedException e) { throw new RuntimeException(e); }
                return source.read(bytes, offset, length);
            }
        };
        when(storage.save(anyString(), any())).thenReturn("projects/7/note.txt");
        var content = (com.checkba.service.ProjectFileContentService) ReflectionTestUtils.getField(controller, "contentService");
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            Future<?> writer = pool.submit(() -> {
                try { content.upload(11L, 7L, 3L, input, 8, null, false, null); }
                catch (Exception e) { throw new RuntimeException(e); }
            });
            assertTrue(receiving.await(3, TimeUnit.SECONDS));
            pool.submit(() -> sessions.runLocked(7L, () -> {})).get(1, TimeUnit.SECONDS);
            release.countDown(); writer.get(3, TimeUnit.SECONDS);
        } finally { release.countDown(); pool.shutdownNow(); }
    }

    @Test void failedOptionalMetadataDoesNotTurnPublishedBytesIntoFailedUpload() throws Exception {
        when(storage.save(anyString(), any())).thenAnswer(i -> {
            Files.writeString(document, "complete"); return i.getArgument(0);
        });
        when(files.updateContentMetadataIfCurrent(any(), any(), anyString(), any(), any()))
                .thenThrow(new IllegalStateException("metadata unavailable"));
        assertEquals(200, upload());
        assertEquals("complete", Files.readString(document));
    }

    @Test void rejectedPostProcessingWithTotalSizeStillAcknowledgesBytesAndSignalsOnce() throws Exception {
        when(storage.save(anyString(), any())).thenAnswer(invocation -> {
            try (java.io.InputStream input = invocation.getArgument(1)) {
                Files.write(document, input.readAllBytes());
            }
            return invocation.getArgument(0);
        });
        ReflectionTestUtils.setField(controller, "taskExecutor", (java.util.concurrent.Executor) command -> {
            throw new RejectedExecutionException("indexing executor is full");
        });

        var response = uploadResponse("8");

        assertEquals("complete", Files.readString(document));
        assertEquals(200, response.getStatusCode().value());
        assertEquals(0, response.getBody().get("code"));
        verify(sessions, times(1)).onChangeSignal(eq(7L), eq(3L), any());
    }

    @Test void quotaUploadWithUnknownLengthRejectsBeforeReadingBody() {
        var content = (com.checkba.service.ProjectFileContentService) ReflectionTestUtils.getField(controller, "contentService");
        ReflectionTestUtils.setField(content, "subscriptionQuotaEnabled", true);
        var reads = new java.util.concurrent.atomic.AtomicInteger();
        var input = new java.io.InputStream() {
            public int read() throws java.io.IOException {
                reads.incrementAndGet();
                throw new java.io.IOException("Unknown-length cloud upload body must not be read");
            }
        };

        Exception failure = assertThrows(Exception.class,
                () -> content.upload(11L, 7L, 3L, input, -1, null, false, null));

        assertAll(
                () -> assertInstanceOf(IllegalArgumentException.class, failure),
                () -> assertEquals(0, reads.get()));
        verify(storage, never()).save(anyString(), any());
    }

    @Test void blockedTextNotificationDoesNotHoldVersionLock() throws Exception {
        CountDownLatch notifying = new CountDownLatch(1), release = new CountDownLatch(1);
        when(storage.save(anyString(), any())).thenAnswer(i -> {
            try (java.io.InputStream in = i.getArgument(1)) { Files.write(document, in.readAllBytes()); }
            return i.getArgument(0);
        });
        doAnswer(i -> { notifying.countDown(); assertTrue(release.await(5, TimeUnit.SECONDS)); return null; })
                .when(bridge).sendTextReloadFileAction(any());
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            Future<String> writer = pool.submit(() -> {
                ProjectContextHolder.setProjectId("7"); ProjectContextHolder.setUserId(3L);
                try { return textTools.text_write_file(11L, "complete"); }
                finally { ProjectContextHolder.clear(); }
            });
            assertTrue(notifying.await(3, TimeUnit.SECONDS));
            pool.submit(() -> sessions.runLocked(7L, () -> {})).get(1, TimeUnit.SECONDS);
            release.countDown(); assertFalse(writer.get(3, TimeUnit.SECONDS).startsWith("Error"));
        } finally { release.countDown(); pool.shutdownNow(); }
    }

    @Test void inlineUploadPostProcessingDoesNotHoldVersionLock() throws Exception {
        CountDownLatch processing = new CountDownLatch(1), release = new CountDownLatch(1);
        when(storage.save(anyString(), any())).thenReturn("projects/7/note.txt");
        var rag = mock(com.checkba.service.ai.ProjectRagService.class);
        doAnswer(i -> { processing.countDown(); assertTrue(release.await(5, TimeUnit.SECONDS)); return null; })
                .when(rag).refreshProjectKnowledgeIncremental(anyString(), anyString());
        ReflectionTestUtils.setField(controller, "projectRagService", rag);
        ReflectionTestUtils.setField(controller, "autoTaggingService", mock(com.checkba.service.ai.AutoTaggingService.class));
        ReflectionTestUtils.setField(controller, "taskExecutor", (java.util.concurrent.Executor) Runnable::run);
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            Future<Integer> writer = pool.submit(this::upload);
            assertTrue(processing.await(3, TimeUnit.SECONDS));
            pool.submit(() -> sessions.runLocked(7L, () -> {})).get(1, TimeUnit.SECONDS);
            release.countDown(); assertEquals(200, writer.get(3, TimeUnit.SECONDS));
        } finally { release.countDown(); pool.shutdownNow(); }
    }

    @Test void snapshotCannotObserveHalfOfAnUpload() throws Exception {
        CountDownLatch partial = new CountDownLatch(1), finish = new CountDownLatch(1);
        when(storage.save(anyString(), any())).thenAnswer(i -> {
            Files.writeString(document, "half"); partial.countDown();
            assertTrue(finish.await(5, TimeUnit.SECONDS));
            Files.writeString(document, "complete"); return i.getArgument(0);
        });
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            Future<Integer> upload = pool.submit(this::upload);
            assertTrue(partial.await(3, TimeUnit.SECONDS));
            CountDownLatch snapshotEntered = new CountDownLatch(1);
            Future<String> snapshot = pool.submit(() -> {
                String[] bytes = new String[1];
                sessions.runLocked(7L, () -> {
                    snapshotEntered.countDown();
                    try { bytes[0] = Files.readString(document); } catch (Exception e) { throw new RuntimeException(e); }
                });
                return bytes[0];
            });
            boolean observedPartial = snapshotEntered.await(200, TimeUnit.MILLISECONDS);
            finish.countDown();
            assertEquals(200, upload.get(5, TimeUnit.SECONDS));
            assertFalse(observedPartial, "snapshot entered while the upload was only half written");
            assertEquals("complete", snapshot.get(5, TimeUnit.SECONDS));
        } finally { finish.countDown(); pool.shutdownNow(); }
    }

    @Test void textReadModifyWriteWaitsForTheCanonicalVersionLock() throws Exception {
        CountDownLatch versionEntered = new CountDownLatch(1), versionRelease = new CountDownLatch(1);
        CountDownLatch textRead = new CountDownLatch(1);
        when(storage.load(anyString())).thenAnswer(i -> { textRead.countDown(); return new FileSystemResource(document); });
        when(storage.save(anyString(), any())).thenAnswer(i -> {
            try (java.io.InputStream in = i.getArgument(1)) { Files.write(document, in.readAllBytes()); }
            return i.getArgument(0);
        });
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            Future<?> version = pool.submit(() -> sessions.runLocked(7L, () -> {
                versionEntered.countDown();
                try { assertTrue(versionRelease.await(5, TimeUnit.SECONDS)); } catch (InterruptedException e) { throw new RuntimeException(e); }
            }));
            assertTrue(versionEntered.await(3, TimeUnit.SECONDS));
            Future<String> edit = pool.submit(() -> {
                ProjectContextHolder.setProjectId("7"); ProjectContextHolder.setUserId(3L);
                try { return textTools.text_find_replace(11L, "old", "new", true); }
                finally { ProjectContextHolder.clear(); }
            });
            boolean readBeforeLock = textRead.await(200, TimeUnit.MILLISECONDS);
            versionRelease.countDown(); version.get(5, TimeUnit.SECONDS);
            assertFalse(edit.get(5, TimeUnit.SECONDS).startsWith("Error"));
            assertFalse(readBeforeLock, "AI read stale bytes before acquiring the snapshot lock");
            assertEquals("new", Files.readString(document));
        } finally { versionRelease.countDown(); pool.shutdownNow(); }
    }

    private int upload() {
        return uploadResponse().getStatusCode().value();
    }

    private org.springframework.http.ResponseEntity<java.util.Map<String, Object>> uploadResponse() {
        return uploadResponse(null);
    }

    private org.springframework.http.ResponseEntity<java.util.Map<String, Object>> uploadResponse(String totalSize) {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setContentType("application/octet-stream"); request.setContent("complete".getBytes(java.nio.charset.StandardCharsets.UTF_8));
        if (totalSize != null) request.addHeader("X-File-Total-Size", totalSize);
        try (var auth = mockStatic(AuthController.class)) {
            auth.when(() -> AuthController.getUserIdFromSession("session")).thenReturn(3L);
            return controller.uploadFile("11", null, null, "session", null, request);
        }
    }
}
