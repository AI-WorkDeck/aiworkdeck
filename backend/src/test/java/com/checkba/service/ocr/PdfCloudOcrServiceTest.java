// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.ocr;

import com.checkba.service.OcrService;
import org.apache.pdfbox.pdmodel.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import java.nio.file.Path;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;
import static org.junit.jupiter.api.Assertions.*;

class PdfCloudOcrServiceTest {
    @TempDir Path tmp;
    OcrService ocr = mock(OcrService.class);
    PdfCloudOcrService service = new PdfCloudOcrService(ocr);
    Path pdf() throws Exception {
        Path path = tmp.resolve("synthetic.pdf");
        try (PDDocument doc = new PDDocument()) { for (int i = 0; i < 2; i++) {
            PDPage page = new PDPage(); doc.addPage(page);
            try (var content = new PDPageContentStream(doc, page)) {
                content.setNonStrokingColor(new java.awt.Color(254, 254, 254));
                content.addRect(20, 20, 10, 10); content.fill();
            }
        } doc.save(path.toFile()); }
        return path;
    }
    @Test void recognizesEveryPageThroughExistingMeteredService() throws Exception {
        when(ocr.recognizeGeneral(anyString())).thenReturn(new OcrResult("Synthetic first", ""), new OcrResult("Synthetic second", ""));
        String result = service.recognize(pdf(), () -> {});
        assertTrue(result.contains("第 1 页")); assertTrue(result.contains("第 2 页"));
        assertTrue(result.contains("Synthetic second")); verify(ocr, times(2)).recognizeGeneral(anyString());
    }
    @Test void middlePageFailureNeverReturnsPartialText() throws Exception {
        when(ocr.recognizeGeneral(anyString())).thenReturn(new OcrResult("Synthetic first", "")).thenThrow(new IllegalStateException("余额不足"));
        Exception error = assertThrows(Exception.class, () -> service.recognize(pdf(), () -> {}));
        assertTrue(error.getMessage().contains("第 2 页")); assertTrue(error.getMessage().contains("可能已计费"));
    }
    @Test void emptyRecognitionFailsRatherThanPretendingThePageWasBlank() {
        when(ocr.recognizeGeneral(anyString())).thenReturn(new OcrResult("", ""));
        assertThrows(Exception.class, () -> service.recognize(pdf(), () -> {}));
        verify(ocr).recognizeGeneral(anyString());
    }
    @Test void trulyWhitePageKeepsPageSeparatorWithoutUploadOrCharge() throws Exception {
        Path source = pdf();
        try (PDDocument doc = org.apache.pdfbox.Loader.loadPDF(source.toFile())) {
            doc.addPage(new PDPage()); doc.save(tmp.resolve("with-white.pdf").toFile());
        }
        when(ocr.recognizeGeneral(anyString())).thenReturn(new OcrResult("Synthetic", ""));
        String result = service.recognize(tmp.resolve("with-white.pdf"), () -> {});
        assertTrue(result.contains("第 3 页"));
        verify(ocr, times(2)).recognizeGeneral(anyString());
    }
    @Test void revokedGuardStopsBeforeNextPageUpload() throws Exception {
        java.util.concurrent.atomic.AtomicBoolean allowed = new java.util.concurrent.atomic.AtomicBoolean(true);
        when(ocr.recognizeGeneral(anyString())).thenAnswer(i -> {
            allowed.set(false); return new OcrResult("Synthetic", "");
        });
        Exception error = assertThrows(Exception.class, () -> service.recognize(pdf(), () -> {
            if (!allowed.get()) throw new IllegalStateException("授权已撤回");
        }));
        assertTrue(error.getMessage().contains("第 2 页"));
        verify(ocr, times(1)).recognizeGeneral(anyString());
    }
    @Test void cancellationDuringFinalUploadNeverReturnsRecognizedContent() throws Exception {
        var allowed = new java.util.concurrent.atomic.AtomicBoolean(true);
        var calls = new java.util.concurrent.atomic.AtomicInteger();
        when(ocr.recognizeGeneral(anyString())).thenAnswer(i -> {
            if (calls.incrementAndGet() == 2) allowed.set(false);
            return new OcrResult("Synthetic", "");
        });
        assertThrows(Exception.class, () -> service.recognize(pdf(), () -> {
            if (!allowed.get()) throw new IllegalStateException("任务已取消");
        }));
        verify(ocr, times(2)).recognizeGeneral(anyString());
    }
    @Test void whiteOnlyDocumentStillChecksCancellationWithoutAnyUpload() throws Exception {
        Path white = tmp.resolve("white.pdf");
        try (PDDocument doc = new PDDocument()) { doc.addPage(new PDPage()); doc.save(white.toFile()); }
        assertThrows(Exception.class, () -> service.recognize(white, () -> { throw new IllegalStateException("任务已取消"); }));
        verifyNoInteractions(ocr);
        var checks = new java.util.concurrent.atomic.AtomicInteger();
        assertTrue(service.recognize(white, () -> checks.incrementAndGet()).contains("第 1 页"));
        assertEquals(2, checks.get(), "Check before rendering and before returning the complete result");
        verifyNoInteractions(ocr);
    }
    @Test void markdownPunctuationSurvivesTheActualWordParserAndRenderer() throws Exception {
        String original = "*原文* 1. 编号 <合同> &amp; [链接](地址) `代码` | 表格 | \\路径";
        var options = com.checkba.service.ai.AiDocxExportService.markdownOptions();
        var document = com.vladsch.flexmark.parser.Parser.builder(options).build().parse(escape(original));
        var word = org.docx4j.openpackaging.packages.WordprocessingMLPackage.createPackage();
        com.vladsch.flexmark.docx.converter.DocxRenderer.builder(options).build().render(document, word);
        String extracted = org.docx4j.TextUtils.getText(word.getMainDocumentPart().getJaxbElement());
        assertEquals(original, extracted.strip());
        String numbered = "1. 编号\n# 标题\n> 原文\n---";
        String html = com.vladsch.flexmark.html.HtmlRenderer.builder(options).build()
                .render(com.vladsch.flexmark.parser.Parser.builder(options).build().parse(escape(numbered)));
        assertFalse(html.contains("<ol>")); assertFalse(html.contains("<h1>")); assertFalse(html.contains("<blockquote>"));
    }
    private String escape(String text) { return PdfCloudOcrService.escapeMarkdown(text); }
}
