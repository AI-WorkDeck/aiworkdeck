// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.ocr;

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
import com.checkba.config.AiContextProperties;
import com.vladsch.flexmark.docx.converter.DocxRenderer;
import com.vladsch.flexmark.parser.Parser;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.pdfbox.pdmodel.PDPageContentStream;
import org.apache.pdfbox.pdmodel.font.PDType1Font;
import org.apache.pdfbox.pdmodel.font.Standard14Fonts;
import org.docx4j.openpackaging.packages.WordprocessingMLPackage;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** Explorer right-click OCR (tutorial-series#155): consent gate, routing, output files, cancellation. */
class FileOcrServiceTest {
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
    FileContentExtractorService extractor = new FileContentExtractorService(ocr, new AiContextProperties());
    FileOcrService service;

    @BeforeEach
    void setUp() throws Exception {
        service = new FileOcrService(ocr, pdfOcr, routing, extractor, files, access, members, repository, storageFactory, docx);
        when(storageFactory.getStorageService()).thenReturn(storage);
        when(members.hasWritePermission(7L, 1L)).thenReturn(true);
        prefer("ask");
        when(repository.save(any())).thenAnswer(i -> i.getArgument(0));
    }

    void prefer(String choice) {
        when(routing.preference(1L)).thenReturn(Map.of("choice", choice, "notice", "N", "version", OcrRoutingService.VERSION));
    }

    ProjectFile file(long id, String name, byte[] bytes) throws Exception {
        ProjectFile f = new ProjectFile();
        f.setId(id); f.setProjectId(7L); f.setParentId(3L); f.setName(name); f.setIsFolder(false);
        when(files.getFile(id)).thenReturn(f);
        when(files.getFileBytes(id)).thenReturn(bytes);
        return f;
    }

    static byte[] png() { return new byte[]{(byte) 0x89, 'P', 'N', 'G'}; }

    static byte[] pdf(String text) throws Exception {
        try (PDDocument doc = new PDDocument(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            PDPage page = new PDPage(); doc.addPage(page);
            if (text != null) try (var content = new PDPageContentStream(doc, page)) {
                content.beginText(); content.setFont(new PDType1Font(Standard14Fonts.FontName.HELVETICA), 12);
                content.newLineAtOffset(50, 700); content.showText(text); content.endText();
            }
            doc.save(out); return out.toByteArray();
        }
    }

    FileOcrService.Request req(FileOcrService.Output output, String name, String consent) {
        return new FileOcrService.Request("job-1", output, name, consent);
    }

    @Test void askPreferenceWithoutConsentNeverUploads() throws Exception {
        file(11, "scan.png", png());
        var outcome = service.run(7L, 11L, 1L, req(FileOcrService.Output.TEXT, null, null));
        assertEquals("consent_required", outcome.status());
        assertEquals(OcrRoutingService.VERSION, outcome.version());
        verify(ocr, never()).recognizeGeneral(anyString());
    }

    @Test void staleConsentVersionIsNotConsent() throws Exception {
        file(11, "scan.png", png());
        var outcome = service.run(7L, 11L, 1L, req(FileOcrService.Output.TEXT, null, "1999-01-01"));
        assertEquals("consent_required", outcome.status());
        verify(ocr, never()).recognizeGeneral(anyString());
    }

    @Test void batchConsentRecognizesImageThroughMeteredService() throws Exception {
        file(11, "scan.png", png());
        when(ocr.recognizeGeneral(anyString())).thenReturn(new OcrResult("第一行\n第二行", ""));
        var outcome = service.run(7L, 11L, 1L, req(FileOcrService.Output.TEXT, null, OcrRoutingService.VERSION));
        assertEquals("done", outcome.status());
        assertEquals("第一行\n第二行", outcome.text());
        assertEquals("ocr", outcome.source());
        verify(ocr, times(1)).recognizeGeneral(anyString());
    }

    @Test void rememberedCloudPreferenceNeedsNoPrompt() throws Exception {
        prefer("cloud");
        file(11, "scan.jpg", png());
        when(ocr.recognizeGeneral(anyString())).thenReturn(new OcrResult("text", ""));
        assertEquals("done", service.run(7L, 11L, 1L, req(FileOcrService.Output.TEXT, null, null)).status());
    }

    @Test void localOnlyPreferenceNeverUploadsEvenWithConsent() throws Exception {
        prefer("local");
        file(11, "scan.png", png());
        var outcome = service.run(7L, 11L, 1L, req(FileOcrService.Output.TEXT, null, OcrRoutingService.VERSION));
        assertEquals("local_only", outcome.status());
        verify(ocr, never()).recognizeGeneral(anyString());
    }

    @Test void pdfTextLayerIsReturnedFreeWithoutConsent() throws Exception {
        file(12, "contract.pdf", pdf("This contract has a perfectly usable text layer"));
        var outcome = service.run(7L, 12L, 1L, req(FileOcrService.Output.TEXT, null, null));
        assertEquals("done", outcome.status());
        assertEquals("text", outcome.source());
        assertTrue(outcome.text().contains("perfectly usable text layer"));
        verify(ocr, never()).recognizeGeneral(anyString());
        verifyNoInteractions(pdfOcr);
    }

    @Test void scannedPdfUsesEveryPageWithoutCapAndJoinsPages() throws Exception {
        file(13, "scan.pdf", pdf(null));
        when(pdfOcr.recognizePages(any(), any())).thenReturn(List.of("page one", "", "page three"));
        var outcome = service.run(7L, 13L, 1L, req(FileOcrService.Output.TEXT, null, OcrRoutingService.VERSION));
        assertEquals("done", outcome.status());
        assertEquals("page one\n\npage three", outcome.text());
        assertEquals(3, outcome.pages());
    }

    @Test void scannedPdfWithoutConsentNeverRenders() throws Exception {
        file(13, "scan.pdf", pdf(null));
        assertEquals("consent_required", service.run(7L, 13L, 1L, req(FileOcrService.Output.TEXT, null, null)).status());
        verifyNoInteractions(pdfOcr);
    }

    @Test void txtExportCreatesSiblingWithRenamePolicy() throws Exception {
        file(11, "scan.png", png());
        when(ocr.recognizeGeneral(anyString())).thenReturn(new OcrResult("甲方\n乙方", ""));
        ProjectFile created = new ProjectFile(); created.setId(99L); created.setName("scan-识别文字 (1).txt"); created.setFilePath("p/x.txt");
        when(files.generateWpsFileId(7L)).thenReturn("w");
        when(files.createFile(eq(7L), eq(3L), eq("scan-识别文字.txt"), eq("txt"), anyLong(), isNull(), eq("w"), eq(1L),
                eq(ProjectFileService.ConflictPolicy.RENAME))).thenReturn(created);
        var outcome = service.run(7L, 11L, 1L, req(FileOcrService.Output.TXT, "scan-识别文字.txt", OcrRoutingService.VERSION));
        assertEquals("done", outcome.status());
        assertSame(created, outcome.file());
        ArgumentCaptor<InputStream> body = ArgumentCaptor.forClass(InputStream.class);
        verify(storage).save(eq("p/x.txt"), body.capture());
        assertEquals("甲方\n乙方", new String(body.getValue().readAllBytes(), StandardCharsets.UTF_8));
    }

    @Test void unsafeOrMismatchedNameFallsBackToDefault() throws Exception {
        file(11, "scan.final.png", png());
        when(ocr.recognizeGeneral(anyString())).thenReturn(new OcrResult("x", ""));
        when(files.generateWpsFileId(7L)).thenReturn("w");
        ProjectFile created = new ProjectFile(); created.setFilePath("p/y.txt");
        when(files.createFile(anyLong(), any(), anyString(), anyString(), anyLong(), any(), any(), anyLong(), any())).thenReturn(created);
        service.run(7L, 11L, 1L, req(FileOcrService.Output.TXT, "../evil.docx", OcrRoutingService.VERSION));
        ArgumentCaptor<String> name = ArgumentCaptor.forClass(String.class);
        verify(files).createFile(anyLong(), any(), name.capture(), anyString(), anyLong(), any(), any(), anyLong(), any());
        assertTrue(name.getValue().startsWith("scan.final-"), name.getValue());
        assertTrue(name.getValue().endsWith(".txt"), name.getValue());
        assertFalse(name.getValue().contains("/"));
    }

    @Test void docxExportGoesThroughExistingWriter() throws Exception {
        file(11, "scan.png", png());
        when(ocr.recognizeGeneral(anyString())).thenReturn(new OcrResult("# 1. 标题\n下一行", ""));
        ProjectFile created = new ProjectFile(); created.setId(100L);
        when(docx.exportMarkdownToDocx(eq(7L), eq(3L), eq(1L), eq("scan-识别文字.docx"), anyString())).thenReturn(created);
        var outcome = service.run(7L, 11L, 1L, req(FileOcrService.Output.DOCX, "scan-识别文字.docx", OcrRoutingService.VERSION));
        assertSame(created, outcome.file());
        ArgumentCaptor<String> md = ArgumentCaptor.forClass(String.class);
        verify(docx).exportMarkdownToDocx(eq(7L), eq(3L), eq(1L), anyString(), md.capture());
        assertEquals(FileOcrService.toMarkdown("# 1. 标题\n下一行"), md.getValue());
    }

    @Test void cancelledJobStopsBeforeUploadAndWritesNothing() throws Exception {
        file(11, "scan.png", png());
        service.cancel(1L, "job-1");
        var outcome = service.run(7L, 11L, 1L, req(FileOcrService.Output.TXT, null, OcrRoutingService.VERSION));
        assertEquals("cancelled", outcome.status());
        verify(ocr, never()).recognizeGeneral(anyString());
        verify(files, never()).createFile(anyLong(), any(), anyString(), anyString(), anyLong(), any(), any(), anyLong(), any());
    }

    @Test void cancellationDuringRecognitionProducesNoLateFile() throws Exception {
        file(11, "scan.png", png());
        when(ocr.recognizeGeneral(anyString())).thenAnswer(i -> { service.cancel(1L, "job-1"); return new OcrResult("x", ""); });
        assertEquals("cancelled", service.run(7L, 11L, 1L, req(FileOcrService.Output.DOCX, null, OcrRoutingService.VERSION)).status());
        verifyNoInteractions(docx);
    }

    @Test void anotherUsersCancelDoesNotStopMyJob() throws Exception {
        file(11, "scan.png", png());
        when(ocr.recognizeGeneral(anyString())).thenReturn(new OcrResult("x", ""));
        service.cancel(2L, "job-1");
        assertEquals("done", service.run(7L, 11L, 1L, req(FileOcrService.Output.TEXT, null, OcrRoutingService.VERSION)).status());
    }

    @Test void readOnlyMemberMayCopyButNotExport() throws Exception {
        when(members.hasWritePermission(7L, 1L)).thenReturn(false);
        file(11, "scan.png", png());
        assertThrows(IllegalArgumentException.class,
                () -> service.run(7L, 11L, 1L, req(FileOcrService.Output.TXT, null, OcrRoutingService.VERSION)));
        verify(ocr, never()).recognizeGeneral(anyString());
    }

    @Test void rejectsOtherProjectFoldersUnsupportedTypesAndUnreadableFiles() throws Exception {
        ProjectFile other = file(21, "a.png", png()); other.setProjectId(8L);
        assertThrows(IllegalArgumentException.class, () -> service.run(7L, 21L, 1L, req(FileOcrService.Output.TEXT, null, null)));
        ProjectFile folder = file(22, "dir", null); folder.setIsFolder(true);
        assertThrows(IllegalArgumentException.class, () -> service.run(7L, 22L, 1L, req(FileOcrService.Output.TEXT, null, null)));
        file(23, "a.docx", new byte[]{1});
        assertThrows(IllegalArgumentException.class, () -> service.run(7L, 23L, 1L, req(FileOcrService.Output.TEXT, null, null)));
        file(24, "b.png", png());
        doThrow(new ProjectFileAccessService.FileAccessDeniedException()).when(access).requireRead(argThat(f -> f != null && f.getId() == 24L), eq(1L));
        assertThrows(IllegalArgumentException.class, () -> service.run(7L, 24L, 1L, req(FileOcrService.Output.TEXT, null, null)));
        verify(ocr, never()).recognizeGeneral(anyString());
    }

    @Test void markdownKeepsLinesAndParagraphsAndNeutralisesSyntax() {
        String md = FileOcrService.toMarkdown("# 1. 标题\n第二行\n\n\n新段落 *星号*");
        assertFalse(md.startsWith("#"), md);
        assertTrue(md.contains("\\#"), md);
        assertTrue(md.contains("\\*星号\\*"), md);
        // one hard break inside the paragraph, exactly one blank line between paragraphs
        assertTrue(md.contains("标题\\\n第二行\n\n新段落"), md);
    }

    @Test void markdownRendersHardBreaksAsWordLineBreaks() throws Exception {
        var options = AiDocxExportService.markdownOptions();
        var pkg = WordprocessingMLPackage.createPackage();
        DocxRenderer.builder(options).build().render(
                Parser.builder(options).build().parse(FileOcrService.toMarkdown("第一行\n第二行\n\n第二段")), pkg);
        String xml = pkg.getMainDocumentPart().getXML();
        assertTrue(xml.contains("<w:br/>"), xml);
        assertTrue(xml.contains("第一行") && xml.contains("第二行") && xml.contains("第二段"));
        assertFalse(xml.contains("\\"), xml);
    }
}
