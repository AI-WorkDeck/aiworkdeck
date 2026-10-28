// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.ai.tools;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.checkba.model.entity.ImageAssetGeneration;
import com.checkba.repository.ImageAssetGenerationRepository;
import com.checkba.service.ProjectMemberService;
import com.checkba.service.ai.PptxServiceClient;
import com.checkba.service.ai.context.ProjectContextHolder;

import org.junit.jupiter.api.*;

import java.util.Optional;

class ImageAssetToolsTest {
    ImageAssetGenerationRepository tasks = mock(ImageAssetGenerationRepository.class);
    ProjectMemberService members = mock(ProjectMemberService.class);
    PptxServiceClient client = mock(PptxServiceClient.class);
    static class TestTransactions extends org.springframework.transaction.support.AbstractPlatformTransactionManager {
        int rollbacks;
        @Override protected Object doGetTransaction() { return new Object(); }
        @Override protected void doBegin(Object transaction, org.springframework.transaction.TransactionDefinition definition) {}
        @Override protected void doCommit(org.springframework.transaction.support.DefaultTransactionStatus status) {}
        @Override protected void doRollback(org.springframework.transaction.support.DefaultTransactionStatus status) { rollbacks++; }
    }
    TestTransactions tx = new TestTransactions();
    com.checkba.service.mobile.CloudStorageQuotaService quota =
            mock(com.checkba.service.mobile.CloudStorageQuotaService.class);
    PptxTools pptx = mock(PptxTools.class);
    com.checkba.service.ProjectFileService files =
            mock(com.checkba.service.ProjectFileService.class);
    com.checkba.storage.ProjectStorageResolver storage =
            mock(com.checkba.storage.ProjectStorageResolver.class);
    com.checkba.service.ai.EditorBridgeService editor =
            mock(com.checkba.service.ai.EditorBridgeService.class);
    ImageAssetTools tools =
            new ImageAssetTools(tasks, members, files, client, pptx, storage, editor, tx, quota);
    @org.junit.jupiter.api.io.TempDir java.nio.file.Path dir;

    @BeforeEach
    void setup() throws Exception {
        ProjectContextHolder.setProjectId("1");
        ProjectContextHolder.setUserId(2L);
        when(members.hasWritePermission(1L, 2L)).thenReturn(true);
        doAnswer(invocation -> {
            java.nio.file.Files.deleteIfExists(dir.resolve("asset-test.png"));
            return null;
        }).when(quota).removeRolledBackFile(eq(1L), eq("projects/1/asset-test.png"));
    }

    @AfterEach
    void cleanup() {
        ProjectContextHolder.clear();
    }

    ImageAssetGeneration task() {
        var t = new ImageAssetGeneration();
        t.setId("test");
        t.setUserId(2L);
        t.setProjectId(1L);
        t.setState("SUBMISSION_UNKNOWN");
        return t;
    }

    @Test
    void repeatedRequestDoesNotGenerateAgain() {
        when(tasks.findByUserIdAndProjectIdAndRequestKey(2L, 1L, "same"))
                .thenReturn(Optional.of(task()));
        assertTrue(
                tools.image_generate_asset("same", "test image", "16:9", null)
                        .contains("SUBMISSION_UNKNOWN"));
        verifyNoInteractions(client);
    }

    @Test
    void foreignOwnerCannotPoll() {
        var t = task();
        t.setUserId(9L);
        when(tasks.findLockedById("test")).thenReturn(Optional.of(t));
        assertTrue(tools.image_get_generation("test").startsWith("Error:"));
        verifyNoInteractions(client);
    }

    @Test
    void foreignProjectCannotPoll() {
        var t = task();
        t.setProjectId(9L);
        when(tasks.findLockedById("test")).thenReturn(Optional.of(t));
        assertTrue(tools.image_get_generation("test").startsWith("Error:"));
        verifyNoInteractions(client);
    }

    @Test
    void unknownSubmissionNeverRetriesModel() {
        when(tasks.findLockedById("test")).thenReturn(Optional.of(task()));
        assertTrue(tools.image_get_generation("test").contains("SUBMISSION_UNKNOWN"));
        verifyNoInteractions(client);
    }

    @Test
    void missingComponentDoesNotSubmitOrResolveCredentials() {
        when(client.isHealthy()).thenReturn(false);
        when(pptx.promptComponentIfMissing("image_generate_asset")).thenReturn("install");
        tools.image_generate_asset("new", "test image", "16:9", null);
        verify(client, never()).startAsset(any(), any(), any(), any());
        verify(pptx, never()).buildModelConfig(any());
        verify(tasks, never()).saveAndFlush(any());
    }

    @Test
    void successfulSubmissionIsBoundBeforeNetworkCall() {
        when(client.isHealthy()).thenReturn(true);
        when(client.createProject(any())).thenReturn("service-project");
        when(client.startAsset(any(), any(), any(), any())).thenReturn("service-task");
        when(pptx.buildModelConfig(null)).thenReturn(new PptxServiceClient.ModelConfig());
        String r = tools.image_generate_asset("new", "test image", "16:9", null);
        assertTrue(r.contains("PENDING"));
        var order = inOrder(tasks, client);
        order.verify(tasks).findByUserIdAndProjectIdAndRequestKey(2L, 1L, "new");
        order.verify(client).isHealthy();
        order.verify(tasks).saveAndFlush(any());
        order.verify(client).createProject(any());
        order.verify(tasks).saveAndFlush(any());
        order.verify(client).startAsset(eq("service-project"), eq("test image"), eq("16:9"), any());
    }

    @Test
    void ambiguousSubmissionReturnsRecoverableIdAndDoesNotRetry() {
        when(client.isHealthy()).thenReturn(true);
        when(client.createProject(any())).thenReturn("service-project");
        when(client.startAsset(any(), any(), any(), any()))
                .thenThrow(new IllegalStateException("timeout"));
        when(pptx.buildModelConfig(null)).thenReturn(new PptxServiceClient.ModelConfig());
        String r = tools.image_generate_asset("new", "test image", "16:9", null);
        assertTrue(r.contains("SUBMISSION_UNKNOWN"));
        assertTrue(r.contains("generationId"));
        verify(client, times(1)).startAsset(any(), any(), any(), any());
    }

    @Test
    void deniedProjectDoesNotReadTask() {
        when(members.hasWritePermission(1L, 2L)).thenReturn(false);
        assertTrue(tools.image_get_generation("test").startsWith("Error:"));
        verifyNoInteractions(tasks, client);
    }

    @Test
    void concurrentDuplicateReturnsPersistedWinnerNotPhantom() {
        when(tasks.findByUserIdAndProjectIdAndRequestKey(2L, 1L, "same"))
                .thenReturn(Optional.empty(), Optional.of(task()));
        when(client.isHealthy()).thenReturn(true);
        when(tasks.saveAndFlush(any()))
                .thenThrow(
                        new org.springframework.dao.DataIntegrityViolationException("duplicate"));
        String r = tools.image_generate_asset("same", "test", "16:9", null);
        assertTrue(r.contains("test"));
        verify(client, never()).createProject(any());
    }

    com.checkba.model.entity.ProjectFile completedFixture(byte[] data) throws Exception {
        var task = task();
        task.setServiceProjectId("service-project");
        task.setServiceTaskId("service-task");
        when(tasks.findLockedById("test")).thenReturn(Optional.of(task));
        when(client.getTaskStatus(any(), any()))
                .thenReturn(
                        cn.hutool.json.JSONUtil.parseObj(
                                "{\"status\":\"COMPLETED\",\"progress\":{\"image_url\":\"/files/service-project/materials/test.png\"}}"));
        when(client.readAsset(any(), any())).thenReturn(data);
        when(pptx.buildPhysicalPath(1L, null, "asset-test.png"))
                .thenReturn("projects/1/asset-test.png");
        when(storage.resolve(any())).thenReturn(dir.resolve("asset-test.png"));
        when(files.getFilesByParent(1L, null)).thenReturn(java.util.List.of());
        var file = new com.checkba.model.entity.ProjectFile();
        file.setId(33L);
        file.setProjectId(1L);
        file.setName("asset-test.png");
        file.setWpsFileId("asset_test");
        file.setFilePath("projects/1/asset-test.png");
        file.setIsFolder(false);
        file.setIsDeleted(false);
        when(files.createOrUpdateFile(any(), any(), any(), any(), any(), any(), any(), any()))
                .thenReturn(file);
        when(files.getFile(33L)).thenReturn(file);
        return file;
    }

    byte[] png() throws Exception {
        var b = new java.io.ByteArrayOutputStream();
        javax.imageio.ImageIO.write(
                new java.awt.image.BufferedImage(2, 2, java.awt.image.BufferedImage.TYPE_INT_RGB),
                "png",
                b);
        return b.toByteArray();
    }

    @Test
    void completedImportIsEditableProjectAssetAndSecondPollDoesNotDownload() throws Exception {
        completedFixture(png());
        assertTrue(tools.image_get_generation("test").contains("33"));
        assertTrue(java.nio.file.Files.exists(dir.resolve("asset-test.png")));
        assertTrue(tools.image_get_generation("test").contains("33"));
        verify(client, times(1)).readAsset(any(), any());
        verify(files, times(1))
                .createOrUpdateFile(any(), any(), any(), any(), any(), any(), any(), any());
    }

    @Test
    void invalidImageRollsBackAndDoesNotCreateFile() throws Exception {
        completedFixture(new byte[] {1, 2, 3});
        assertTrue(tools.image_get_generation("test").startsWith("Error:"));
        assertEquals(1, tx.rollbacks);
        verify(files, never())
                .createOrUpdateFile(any(), any(), any(), any(), any(), any(), any(), any());
        assertFalse(java.nio.file.Files.exists(dir.resolve("asset-test.png")));
    }

    @Test
    void oversizedDimensionsAreRejectedBeforeDecode() throws Exception {
        byte[] data = png();
        java.nio.ByteBuffer.wrap(data, 16, 8).putInt(100000).putInt(100000);
        completedFixture(data);
        assertTrue(tools.image_get_generation("test").startsWith("Error:"));
        assertEquals(1, tx.rollbacks);
        verify(files, never())
                .createOrUpdateFile(any(), any(), any(), any(), any(), any(), any(), any());
    }

    @Test
    void failedDatabaseImportRemovesNewFileAndCanRetryWithoutRegeneration() throws Exception {
        var file = completedFixture(png());
        when(files.createOrUpdateFile(any(), any(), any(), any(), any(), any(), any(), any()))
                .thenThrow(new IllegalStateException("database unavailable"))
                .thenReturn(file);
        assertTrue(tools.image_get_generation("test").startsWith("Error:"));
        assertEquals(1, tx.rollbacks);
        assertFalse(java.nio.file.Files.exists(dir.resolve("asset-test.png")));
        verify(quota).removeRolledBackFile(1L, "projects/1/asset-test.png");
        assertTrue(tools.image_get_generation("test").contains("33"));
        assertTrue(java.nio.file.Files.exists(dir.resolve("asset-test.png")));
        verify(client, never()).startAsset(any(), any(), any(), any());
    }

    @Test
    void existingDifferentBytesAreNotOverwritten() throws Exception {
        completedFixture(png());
        java.nio.file.Files.writeString(dir.resolve("asset-test.png"), "keep me");
        assertTrue(tools.image_get_generation("test").startsWith("Error:"));
        assertEquals("keep me", java.nio.file.Files.readString(dir.resolve("asset-test.png")));
        verify(files, never())
                .createOrUpdateFile(any(), any(), any(), any(), any(), any(), any(), any());
    }

    @Test
    void existingOtherIdentityIsNotOverwritten() throws Exception {
        var file = completedFixture(png());
        file.setWpsFileId("other");
        when(files.getFilesByParent(1L, null)).thenReturn(java.util.List.of(file));
        assertTrue(tools.image_get_generation("test").startsWith("Error:"));
        verify(files, never())
                .createOrUpdateFile(any(), any(), any(), any(), any(), any(), any(), any());
    }

    @Test
    void changedCompletedFileIdentityIsRejected() throws Exception {
        var file = completedFixture(png());
        assertTrue(tools.image_get_generation("test").contains("33"));
        file.setIsFolder(true);
        assertTrue(tools.image_get_generation("test").startsWith("Error:"));
        verify(client, times(1)).readAsset(any(), any());
    }
    @Test
    void failedAndUnknownReceiptsDoNotInstructEndlessPolling() {
        var t = task();
        when(tasks.findLockedById("test")).thenReturn(Optional.of(t));
        var unknown = cn.hutool.json.JSONUtil.parseObj(tools.image_get_generation("test"));
        assertTrue(unknown.getBool("needsInvestigation"));
        assertFalse(unknown.containsKey("nextTool"));
        t.setServiceProjectId("service-project");
        t.setServiceTaskId("service-task");
        when(client.getTaskStatus(any(), any())).thenReturn(cn.hutool.json.JSONUtil.parseObj("{\"status\":\"FAILED\"}"));
        var failed = cn.hutool.json.JSONUtil.parseObj(tools.image_get_generation("test"));
        assertEquals("FAILED", failed.getStr("state"));
        assertTrue(failed.getBool("needsInvestigation"));
        assertFalse(failed.containsKey("nextTool"));
        verify(client, never()).startAsset(any(), any(), any(), any());
        verify(client, never()).readAsset(any(), any());
    }

    @Test
    void quotaRejectionDoesNotWriteImageOrCreateMetadata() throws Exception {
        completedFixture(png());
        doThrow(new IllegalArgumentException("quota exhausted"))
                .when(quota).requireProjectCapacity(eq(1L), anyLong());
        assertTrue(tools.image_get_generation("test").startsWith("Error:"));
        assertFalse(java.nio.file.Files.exists(dir.resolve("asset-test.png")));
        verify(files, never()).createOrUpdateFile(any(), any(), any(), any(), any(), any(), any(), any());
        verify(quota, never()).removeRolledBackFile(any(), any());
    }

    @Test
    void databaseFailureDoesNotDeletePreexistingIdenticalFile() throws Exception {
        completedFixture(png());
        // Use the normalized bytes that the importer writes.
        assertTrue(tools.image_get_generation("test").contains("33"));
        byte[] existing = java.nio.file.Files.readAllBytes(dir.resolve("asset-test.png"));
        completedFixture(png());
        when(files.createOrUpdateFile(any(), any(), any(), any(), any(), any(), any(), any()))
                .thenThrow(new IllegalStateException("database unavailable"));
        assertTrue(tools.image_get_generation("test").startsWith("Error:"));
        assertArrayEquals(existing, java.nio.file.Files.readAllBytes(dir.resolve("asset-test.png")));
        verify(quota, never()).removeRolledBackFile(any(), any());
    }

    @Test
    void taskReceiptFailureAlsoRollsBackNewPhysicalFile() throws Exception {
        completedFixture(png());
        when(tasks.saveAndFlush(any())).thenAnswer(invocation -> {
            ImageAssetGeneration task = invocation.getArgument(0);
            if (task.getOutputFileId() != null) throw new IllegalStateException("task write failed");
            return task;
        });
        assertTrue(tools.image_get_generation("test").startsWith("Error:"));
        assertFalse(java.nio.file.Files.exists(dir.resolve("asset-test.png")));
        verify(quota).removeRolledBackFile(1L, "projects/1/asset-test.png");
    }

}
