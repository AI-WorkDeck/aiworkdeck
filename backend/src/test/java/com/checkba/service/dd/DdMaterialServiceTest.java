// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.dd;

import com.checkba.model.entity.*;
import com.checkba.repository.*;
import com.checkba.service.*;
import com.checkba.service.ai.StyleProfileResolver;
import com.checkba.service.evidence.*;
import com.checkba.storage.*;
import com.checkba.util.style.StyleProfiles;
import com.checkba.version.CloudSyncService;
import com.fasterxml.jackson.databind.*;
import org.apache.poi.xwpf.usermodel.XWPFDocument;
import org.junit.jupiter.api.*;
import org.mockito.ArgumentCaptor;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.transaction.support.*;
import java.io.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class DdMaterialServiceTest {
    DdAiService jobs = mock(DdAiService.class);
    DdAiGateway ai = mock(DdAiGateway.class);
    DdService dd = mock(DdService.class);
    DdWorkflowService workflow = mock(DdWorkflowService.class);
    DdSubmissionRepository submissions = mock(DdSubmissionRepository.class);
    ProjectFileRepository files = mock(ProjectFileRepository.class);
    ProjectFileService projectFiles = mock(ProjectFileService.class);
    ProjectRemoteRepository remotes = mock(ProjectRemoteRepository.class);
    CloudSyncService cloud = mock(CloudSyncService.class);
    DdMaterialMirrorRepository mirrors = mock(DdMaterialMirrorRepository.class);
    StorageServiceFactory factory = mock(StorageServiceFactory.class);
    StorageService storage = mock(StorageService.class);
    EvidenceTextExtractor extractor = mock(EvidenceTextExtractor.class);
    EvidenceLinkService evidence = mock(EvidenceLinkService.class);
    StyleProfileResolver styles = mock(StyleProfileResolver.class);
    ObjectMapper json = new ObjectMapper().findAndRegisterModules();
    TransactionTemplate tx = mock(TransactionTemplate.class);
    DdMaterialService service;
    DdAiJob job;
    DdSubmission submission;
    ProjectFile source, report;
    byte[] reportBytes;

    @BeforeEach void setup() throws Exception {
        service = new DdMaterialService(jobs, ai, dd, workflow, submissions, files, projectFiles, remotes, cloud, mirrors, factory, extractor, evidence, styles, json, tx);
        when(tx.execute(any())).thenAnswer(inv -> ((TransactionCallback<?>)inv.getArgument(0)).doInTransaction(new SimpleTransactionStatus()));
        when(factory.getStorageService()).thenReturn(storage);
        when(styles.resolve(1L, null)).thenReturn(StyleProfiles.houseDefault());
        job = new DdAiJob(); job.setId("test-job"); job.setProjectId(1L); job.setUserId(9L);
        DdRequest request = new DdRequest(); request.setId(2L); request.setProjectId(1L); request.setName("合成尽调清单");
        when(dd.getRequest(2L)).thenReturn(request);
        DdItem item = new DdItem(); item.setId(3L); item.setDdRequestId(2L); item.setTitle("营业执照"); item.setCurrentSubmissionId(4L);
        when(dd.getItems(2L)).thenReturn(List.of(item));
        submission = new DdSubmission(); submission.setId(4L); submission.setProjectId(1L); submission.setItemId(3L); submission.setVersion(2);
        submission.setFileIds(List.of(11L)); submission.setReviewStatus("APPROVED"); when(submissions.findById(4L)).thenReturn(Optional.of(submission));
        when(submissions.findAllById(any())).thenAnswer(inv -> List.of(submission));
        source = file(11L, "执照.pdf"); source.setFilePath("source"); when(files.findById(11L)).thenReturn(Optional.of(source));
        when(storage.load("source")).thenReturn(new ByteArrayResource("示例公司注册资本一百万元".getBytes()));
        when(extractor.textOf(source, 9L)).thenReturn("示例公司注册资本一百万元");
        ProjectFile folder = file(70L, "_交付件"); folder.setIsFolder(true); when(projectFiles.getFilesByParent(1L, null)).thenReturn(List.of(folder));
        report = file(80L, "报告.docx");
        when(jobs.saveFile(eq(1L), eq(9L), anyString(), eq("docx"), any(), eq(70L))).thenAnswer(inv -> { reportBytes = inv.getArgument(4); return report; });
    }
    ProjectFile file(long id, String name) { ProjectFile f = new ProjectFile(); f.setId(id); f.setProjectId(1L); f.setName(name); f.setIsDeleted(false); return f; }
    void model(long citedId, String quote) {
        when(ai.structured(eq(1L), eq(9L), anyString(), anyString())).thenReturn(json.valueToTree(Map.of("paragraphs", List.of(
            Map.of("text", "根据营业执照记载，示例公司注册资本为一百万元。", "citations", List.of(Map.of("fileId", citedId, "quote", quote)))))));
    }
    @Test void reportContainsRealBookmarkHyperlinkAndVersionedLocalEvidence() throws Exception {
        model(11, "注册资本一百万元");
        var result = service.report(job, json.valueToTree(Map.of("requestId", 2)));
        assertEquals(1L, result.get("linkedParagraphs")); assertNotNull(reportBytes);
        ArgumentCaptor<String> key = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<List<EvidenceLinkViews.TargetInput>> targets = ArgumentCaptor.forClass(List.class);
        verify(evidence).create(eq(9L), eq(1L), eq(80L), key.capture(), anyString(), eq("营业执照"), eq("营业执照"), eq("ai"), targets.capture());
        assertEquals(11L, targets.getValue().get(0).fileId()); assertTrue(targets.getValue().get(0).note().contains("第2版"));
        try (XWPFDocument doc = new XWPFDocument(new ByteArrayInputStream(reportBytes))) {
            assertTrue(doc.getDocument().xmlText().contains(key.getValue()));
            assertTrue(Arrays.stream(doc.getHyperlinks()).anyMatch(h -> h.getURL().contains("checkba-internal.local/open") && h.getURL().contains(key.getValue())));
        }
    }
    @Test void unconfirmedFilesAreGapsAndNeverSentToModel() throws Exception {
        submission.setReviewStatus("UPLOADED");
        var result = service.report(job, json.valueToTree(Map.of("requestId", 2)));
        assertEquals(0L, result.get("linkedParagraphs")); assertEquals(1L, result.get("gaps"));
        verifyNoInteractions(ai, evidence);
    }
    @Test void foreignCitationOrInventedQuoteNeverCreatesEvidence() throws Exception {
        model(999, "注册资本一百万元");
        assertEquals(0L, service.report(job, json.valueToTree(Map.of("requestId", 2))).get("linkedParagraphs"));
        verifyNoInteractions(evidence);
        model(11, "未在原文出现");
        assertEquals(0L, service.report(job, json.valueToTree(Map.of("requestId", 2))).get("linkedParagraphs"));
        verifyNoInteractions(evidence);
    }
    @Test void changedSourceAbortsBeforeSavingReport() throws Exception {
        model(11, "注册资本一百万元");
        when(storage.load("source")).thenReturn(new ByteArrayResource("原文".getBytes()), new ByteArrayResource("改后".getBytes()));
        assertThrows(DdProcessingException.class, () -> service.report(job, json.valueToTree(Map.of("requestId", 2))));
        verify(jobs, never()).saveFile(any(), any(), any(), any(), any(), any()); verifyNoInteractions(evidence);
    }
    @Test void withdrawnApprovalAbortsBeforeSavingReport() throws Exception {
        model(11, "注册资本一百万元");
        DdSubmission withdrawn = new DdSubmission(); withdrawn.setId(4L); withdrawn.setReviewStatus("UPLOADED");
        when(submissions.findAllById(any())).thenReturn(List.of(withdrawn));
        assertThrows(DdProcessingException.class, () -> service.report(job, json.valueToTree(Map.of("requestId", 2))));
        verify(jobs, never()).saveFile(any(), any(), any(), any(), any(), any()); verifyNoInteractions(evidence);
    }
    @Test void remoteRequestMustBelongToBoundProjectBeforeAnyDownload() throws Exception {
        ProjectRemote binding = new ProjectRemote(); binding.setProjectId(1L); binding.setConnectionId(5L); binding.setRemoteProjectId("42");
        when(remotes.findByProjectId(1L)).thenReturn(Optional.of(binding));
        when(cloud.proxyDd(1L, "GET", "/requests/2", "", null, null)).thenReturn(new CloudSyncService.RawResponse(200, "application/json", null,
                "{\"request\":{\"projectId\":43},\"items\":[]}".getBytes()));
        assertThrows(DdProcessingException.class, () -> service.importMaterials(job, json.valueToTree(Map.of("requestId", 2))));
        verify(cloud, times(1)).proxyDd(anyLong(), any(), any(), any(), any(), any()); verifyNoInteractions(ai, evidence);
    }
}
