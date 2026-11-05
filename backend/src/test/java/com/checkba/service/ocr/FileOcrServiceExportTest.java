// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.ocr;

import com.checkba.config.AiContextProperties;
import com.checkba.model.entity.ProjectFile;
import com.checkba.repository.ProjectFileRepository;
import com.checkba.service.OcrService;
import com.checkba.service.ProjectFileAccessService;
import com.checkba.service.ProjectFileService;
import com.checkba.service.ProjectMemberService;
import com.checkba.service.ai.AiDocxExportService;
import com.checkba.service.ai.context.FileContentExtractorService;
import com.checkba.storage.StorageService;
import com.checkba.storage.StorageServiceFactory;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;
import java.util.concurrent.CancellationException;

import static com.checkba.service.ocr.FileOcrService.Output.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** Phase 2 (tutorial-series#155): layout Word, searchable PDF and the local-first route. */
class FileOcrServiceExportTest {
    OcrService ocr = mock(OcrService.class);
    PdfCloudOcrService pdfOcr = mock(PdfCloudOcrService.class);
    OcrRoutingService routing = mock(OcrRoutingService.class);
    ProjectFileService files = mock(ProjectFileService.class);
    ProjectFileAccessService access = mock(ProjectFileAccessService.class);
    ProjectMemberService members = mock(ProjectMemberService.class);
    ProjectFileRepository repository = mock(ProjectFileRepository.class);
    StorageServiceFactory storageFactory = mock(StorageServiceFactory.class);
    StorageService storage = mock(StorageService.class);
    AiDocxExportService docx = mock(AiDocxExportService.class);
    OcrExportService exports = mock(OcrExportService.class);
    FileContentExtractorService extractor = new FileContentExtractorService(ocr, new AiContextProperties());
    FileOcrService service;
    static final String MD = "# 股权转让协议\n\n甲方同意转让。\n";

    @BeforeEach
    void setUp() throws Exception {
        service = new FileOcrService(ocr, pdfOcr, routing, extractor, files, access, members, repository, storageFactory, docx, exports);
        when(storageFactory.getStorageService()).thenReturn(storage);
        when(members.hasWritePermission(7L, 1L)).thenReturn(true);
        prefer("ask");
        when(repository.save(any())).thenAnswer(i -> i.getArgument(0));
        when(files.generateWpsFileId(7L)).thenReturn("w");
        when(files.createFile(anyLong(), anyLong(), anyString(), anyString(), anyLong(), any(), anyString(), anyLong(), any()))
                .thenAnswer(i -> {
                    ProjectFile f = new ProjectFile();
                    f.setName(i.getArgument(2)); f.setFilePath("p/" + i.getArgument(2));
                    return f;
                });
    }

    void prefer(String choice) {
        when(routing.preference(1L)).thenReturn(Map.of("choice", choice, "notice", "N", "version", OcrRoutingService.VERSION));
    }

    void file(long id, String name, byte[] bytes) throws Exception {
        ProjectFile f = new ProjectFile();
        f.setId(id); f.setProjectId(7L); f.setParentId(3L); f.setName(name); f.setIsFolder(false);
        when(files.getFile(id)).thenReturn(f);
        when(files.getFileBytes(id)).thenReturn(bytes);
    }

    static byte[] png() throws Exception {
        var out = new java.io.ByteArrayOutputStream();
        javax.imageio.ImageIO.write(new java.awt.image.BufferedImage(20, 20, 1), "png", out);
        return out.toByteArray();
    }

    FileOcrService.Request req(FileOcrService.Output output, String consent, String route) {
        return new FileOcrService.Request("job-1", output, null, consent, route);
    }

    static OcrExportService.LocalResult local(boolean layout) {
        return new OcrExportService.LocalResult(MD, List.of(), Map.of(), layout);
    }

    // ---------------------------------------------------------------- cloud

    @Test
    void cloudLayoutWordIsSavedBesideTheScan() throws Exception {
        prefer("cloud");
        file(11L, "scan.png", png());
        when(exports.cloudPages(any(), any(), any())).thenReturn(List.of("raw"));
        when(exports.layoutDocxFromCloud(any(), eq(List.of("raw")))).thenReturn(new byte[]{1, 2});
        var outcome = service.run(7L, 11L, 1L, req(LAYOUT_DOCX, null, null));
        assertEquals("done", outcome.status());
        assertEquals("ocr", outcome.source());
        assertEquals("scan-识别版式.docx", outcome.file().getName());
        verify(storage).save(eq("p/scan-识别版式.docx"), any());
    }

    @Test
    void cloudSearchablePdfOfAnImageIsAPdf() throws Exception {
        prefer("cloud");
        file(11L, "scan.png", png());
        when(exports.cloudPages(any(), any(), any())).thenReturn(List.of("raw"));
        when(exports.searchablePdfFromCloud(any(), any())).thenReturn(new byte[]{9});
        var outcome = service.run(7L, 11L, 1L, req(SEARCHABLE_PDF, null, null));
        assertEquals("scan-可搜索.pdf", outcome.file().getName());
    }

    @Test
    void layoutNeedsConsentLikeEveryUpload() throws Exception {
        file(11L, "scan.png", png());
        assertEquals("consent_required", service.run(7L, 11L, 1L, req(LAYOUT_DOCX, null, null)).status());
        verify(exports, never()).cloudPages(any(), any(), any());
        verifyNoInteractions(ocr);
    }

    @Test
    void gatewayWithoutLayoutReportsAndCreatesNothing() throws Exception {
        prefer("cloud");
        file(11L, "scan.png", png());
        var ctor = OcrExportService.LayoutUnsupportedException.class.getDeclaredConstructor(String.class);
        ctor.setAccessible(true);
        when(exports.cloudPages(any(), any(), any())).thenThrow(ctor.newInstance("服务端暂不支持"));
        var outcome = service.run(7L, 11L, 1L, req(SEARCHABLE_PDF, null, null));
        assertEquals("layout_unsupported", outcome.status());
        assertEquals("服务端暂不支持", outcome.notice());
        verify(files, never()).createFile(anyLong(), anyLong(), anyString(), anyString(), anyLong(), any(), anyString(), anyLong(), any());
    }

    // ---------------------------------------------------------------- text layer

    @Test
    void pdfWithTextLayerIsAlreadySearchable() throws Exception {
        file(12L, "digital.pdf", FileOcrServiceTest.pdf("A perfectly usable text layer with plenty of words in it."));
        assertEquals("already_searchable", service.run(7L, 12L, 1L, req(SEARCHABLE_PDF, null, null)).status());
        verifyNoInteractions(exports, ocr, pdfOcr);
    }

    @Test
    void pdfWithTextLayerGetsLayoutWordFromLocalConversionOrFallsBackToTextWord() throws Exception {
        file(12L, "digital.pdf", FileOcrServiceTest.pdf("A perfectly usable text layer with plenty of words in it."));
        when(exports.layoutDocxFromTextPdf(any())).thenReturn(new byte[]{7});
        var outcome = service.run(7L, 12L, 1L, req(LAYOUT_DOCX, null, null));
        assertEquals("text", outcome.source());
        assertEquals("digital-识别版式.docx", outcome.file().getName());
        verify(docx, never()).exportMarkdownToDocx(anyLong(), anyLong(), anyLong(), anyString(), anyString());

        when(exports.layoutDocxFromTextPdf(any())).thenReturn(null);
        service.run(7L, 12L, 1L, req(LAYOUT_DOCX, null, null));
        verify(docx).exportMarkdownToDocx(eq(7L), eq(3L), eq(1L), eq("digital-识别版式.docx"), anyString());
        verifyNoInteractions(ocr, pdfOcr);
    }

    // ---------------------------------------------------------------- local first

    @Test
    void installedLocalEngineIsUsedForAskWithoutUploadNotice() throws Exception {
        file(11L, "scan.png", png());
        when(exports.localReady()).thenReturn(true);
        when(exports.local(any(), any(), eq(false))).thenReturn(local(false));
        var outcome = service.run(7L, 11L, 1L, req(TEXT, null, null));
        assertEquals("done", outcome.status());
        assertEquals("local", outcome.source());
        assertTrue(outcome.text().startsWith("股权转让协议"));
        verify(ocr, never()).recognizeGeneral(anyString());
    }

    @Test
    void cloudPreferenceStaysCloudEvenWithTheLocalEngineInstalled() throws Exception {
        prefer("cloud");
        file(11L, "scan.png", png());
        when(exports.localReady()).thenReturn(true);
        when(ocr.recognizeGeneral(anyString())).thenReturn(new OcrResult("云端", ""));
        assertEquals("ocr", service.run(7L, 11L, 1L, req(TEXT, null, null)).source());
        verify(exports, never()).local(any(), any(), anyBoolean());
    }

    @Test
    void localFailureAsksInsteadOfQuietlyUploading() throws Exception {
        file(11L, "scan.png", png());
        when(exports.localReady()).thenReturn(true);
        when(exports.local(any(), any(), anyBoolean())).thenThrow(new IllegalStateException("本地识别未返回内容"));
        var outcome = service.run(7L, 11L, 1L, req(LAYOUT_DOCX, null, null));
        assertEquals("local_failed", outcome.status());
        assertEquals("本地识别未返回内容", outcome.notice());
        assertEquals(OcrRoutingService.VERSION, outcome.version());
        verifyNoInteractions(ocr, pdfOcr);
        verify(exports, never()).cloudPages(any(), any(), any());
    }

    @Test
    void explicitCloudRetryAfterLocalFailureStillNeedsConsent() throws Exception {
        prefer("local");
        file(11L, "scan.png", png());
        when(exports.localReady()).thenReturn(true);
        assertEquals("consent_required", service.run(7L, 11L, 1L, req(TEXT, null, "cloud")).status());
        when(ocr.recognizeGeneral(anyString())).thenReturn(new OcrResult("云端", ""));
        var outcome = service.run(7L, 11L, 1L, req(TEXT, OcrRoutingService.VERSION, "cloud"));
        assertEquals("ocr", outcome.source());
        verify(exports, never()).local(any(), any(), anyBoolean());
    }

    @Test
    void localOnlyWithoutTheEngineStillNeverUploads() throws Exception {
        prefer("local");
        file(11L, "scan.png", png());
        assertEquals("local_only", service.run(7L, 11L, 1L, req(LAYOUT_DOCX, OcrRoutingService.VERSION, null)).status());
        verifyNoInteractions(ocr);
    }

    @Test
    void outdatedLocalComponentIsReportedForSearchablePdf() throws Exception {
        file(11L, "scan.png", png());
        when(exports.localReady()).thenReturn(true);
        when(exports.local(any(), any(), eq(true))).thenReturn(local(false));
        var ctor = OcrExportService.ComponentOutdatedException.class.getDeclaredConstructor(String.class);
        ctor.setAccessible(true);
        when(exports.searchablePdfFromLocal(any(), any())).thenThrow(ctor.newInstance("请更新组件"));
        var outcome = service.run(7L, 11L, 1L, req(SEARCHABLE_PDF, null, null));
        assertEquals("component_outdated", outcome.status());
        assertEquals("请更新组件", outcome.notice());
    }

    @Test
    void cancelDuringLocalRecognitionProducesNoFile() throws Exception {
        file(11L, "scan.png", png());
        when(exports.localReady()).thenReturn(true);
        when(exports.local(any(), any(), anyBoolean())).thenAnswer(i -> { service.cancel(1L, "job-1"); return local(true); });
        assertEquals("cancelled", service.run(7L, 11L, 1L, req(LAYOUT_DOCX, null, null)).status());
        verify(exports, never()).layoutDocxFromLocal(any(), any());
    }

    @Test
    void cloudCancellationIsReportedAsCancelled() throws Exception {
        prefer("cloud");
        file(11L, "scan.png", png());
        when(exports.cloudPages(any(), any(), any())).thenThrow(new CancellationException("cancelled"));
        assertEquals("cancelled", service.run(7L, 11L, 1L, req(LAYOUT_DOCX, null, null)).status());
    }
}
