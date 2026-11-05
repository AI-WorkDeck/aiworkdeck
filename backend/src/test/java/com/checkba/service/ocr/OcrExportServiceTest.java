// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.ocr;

import cn.hutool.json.JSONObject;
import com.checkba.service.OcrService;
import com.checkba.service.ai.PdfEditService;
import com.checkba.service.ai.PptxServiceClient;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.pdfbox.pdmodel.PDPageContentStream;
import org.apache.pdfbox.pdmodel.common.PDRectangle;
import org.apache.pdfbox.pdmodel.font.PDType0Font;
import org.apache.pdfbox.text.PDFTextStripper;
import org.docx4j.TextUtils;
import org.docx4j.openpackaging.packages.WordprocessingMLPackage;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.concurrent.CancellationException;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class OcrExportServiceTest {
    @TempDir Path dir;
    OcrService ocr = mock(OcrService.class);
    PptxServiceClient pptx = mock(PptxServiceClient.class);
    PdfEditService pdfEdit = mock(PdfEditService.class);
    OcrExportService service;
    File latin;

    @BeforeEach
    void setUp() throws Exception {
        service = new OcrExportService(ocr, pptx, null, null, pdfEdit, new OcrResultCache(dir.resolve("cache"), 50));
        latin = dir.resolve("latin.ttf").toFile();
        try (var in = getClass().getResourceAsStream("/org/apache/pdfbox/resources/ttf/LiberationSans-Regular.ttf")) {
            Files.write(latin.toPath(), in.readAllBytes());
        }
        when(pdfEdit.resolveCjkFontFile()).thenReturn(latin);
        when(pdfEdit.loadEmbeddedCjkFont(any(), any(), any())).thenAnswer(i -> PDType0Font.load((PDDocument) i.getArgument(0), latin));
    }

    static String fixture(int page) throws Exception {
        return AliyunLayoutReaderTest.raw(page);
    }

    /** A4 pages, each with a grey mark so it is not skipped as blank; `blank` pages stay white. */
    static byte[] scan(boolean... blank) throws Exception {
        try (PDDocument doc = new PDDocument(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            for (boolean b : blank) {
                PDPage page = new PDPage(PDRectangle.A4);
                doc.addPage(page);
                if (!b) try (var c = new PDPageContentStream(doc, page)) {
                    c.setNonStrokingColor(new java.awt.Color(120, 120, 120));
                    c.addRect(100, 100, 50, 50);
                    c.fill();
                }
            }
            doc.save(out);
            return out.toByteArray();
        }
    }

    static String asciiRaw(String text) {
        return "{\"width\":1240,\"height\":1754,\"subImages\":[{\"blockInfo\":{\"blockDetails\":[{\"blockId\":0,\"blockContent\":\""
                + text + "\",\"blockPoints\":[{\"x\":200,\"y\":300},{\"x\":700,\"y\":300},{\"x\":700,\"y\":340},{\"x\":200,\"y\":340}]}]}}]}";
    }

    @Test
    void cloudRecognizesEachPageWithLayoutOnceThenServesTheCache() throws Exception {
        byte[] pdf = scan(false, false);
        when(ocr.recognizeGeneral(anyString(), eq(true)))
                .thenReturn(new OcrResult("p1", fixture(1)), new OcrResult("p2", fixture(2)));
        List<String> first = service.cloudPages(pdf, pdf, () -> {});
        List<String> second = service.cloudPages(pdf, pdf, () -> {});
        assertEquals(2, first.size());
        assertEquals(first, second);
        verify(ocr, times(2)).recognizeGeneral(anyString(), eq(true));
        verify(ocr, never()).recognizeGeneral(anyString());
    }

    @Test
    void gatewayWithoutLayoutStopsAfterTheFirstBilledPageAndIsNotCached() throws Exception {
        byte[] pdf = scan(false, false, false);
        String noCoords = "{\"width\":1240,\"height\":1754,\"subImages\":[{\"blockInfo\":{\"blockDetails\":[{\"blockContent\":\"x\"}]}}]}";
        when(ocr.recognizeGeneral(anyString(), eq(true))).thenReturn(new OcrResult("x", noCoords));
        var error = assertThrows(OcrExportService.LayoutUnsupportedException.class, () -> service.cloudPages(pdf, pdf, () -> {}));
        assertTrue(error.getMessage().contains("第 1 页") || error.getMessage().contains("page 1"));
        verify(ocr, times(1)).recognizeGeneral(anyString(), eq(true));
        assertThrows(OcrExportService.LayoutUnsupportedException.class, () -> service.cloudPages(pdf, pdf, () -> {}));
        verify(ocr, times(2)).recognizeGeneral(anyString(), eq(true));
    }

    @Test
    void blankPagesAreNeitherUploadedNorBilled() throws Exception {
        byte[] pdf = scan(true, false);
        when(ocr.recognizeGeneral(anyString(), eq(true))).thenReturn(new OcrResult("p", fixture(2)));
        List<String> pages = service.cloudPages(pdf, pdf, () -> {});
        assertEquals("", pages.get(0));
        verify(ocr, times(1)).recognizeGeneral(anyString(), eq(true));
    }

    @Test
    void cancellationStopsBeforeAnyUpload() throws Exception {
        byte[] pdf = scan(false);
        assertThrows(CancellationException.class,
                () -> service.cloudPages(pdf, pdf, () -> { throw new CancellationException("cancelled"); }));
        verifyNoInteractions(ocr);
    }

    @Test
    void cloudLayoutWordRebuildsBothRealPages() throws Exception {
        byte[] pdf = scan(false, false);
        byte[] docx = service.layoutDocxFromCloud(pdf, List.of(fixture(1), fixture(2)));
        var pkg = WordprocessingMLPackage.load(new ByteArrayInputStream(docx));
        String text = TextUtils.getText(pkg.getMainDocumentPart().getJaxbElement());
        assertTrue(text.contains("股权转让协议"));
        assertTrue(text.indexOf("3.3乙方保证") < text.indexOf("来源合法") && text.indexOf("来源合法") < text.indexOf("3.4"),
                "two-column reading order survives the whole pipeline");
        assertTrue(pkg.getParts().getParts().keySet().stream().anyMatch(n -> n.getName().contains("/media/")), "seal cut out of the rendered page");
    }

    @Test
    void searchablePdfKeepsThePagesAndAddsAFindableTextLayer() throws Exception {
        byte[] pdf = scan(false, true);
        byte[] out = service.searchablePdfFromCloud(pdf, List.of(asciiRaw("Share Transfer Agreement"), ""));
        try (PDDocument doc = Loader.loadPDF(out)) {
            assertEquals(2, doc.getNumberOfPages());
            assertTrue(new PDFTextStripper().getText(doc).contains("Share Transfer Agreement"));
        }
    }

    @Test
    void fontThatWouldBreakSearchIsRefusedWithoutAFile() throws Exception {
        File heiti = new File("/System/Library/Fonts/STHeiti Light.ttc");
        org.junit.jupiter.api.Assumptions.assumeTrue(heiti.isFile());
        doAnswer(i -> {
            var c = new org.apache.fontbox.ttf.TrueTypeCollection(heiti);
            org.apache.fontbox.ttf.TrueTypeFont[] f = new org.apache.fontbox.ttf.TrueTypeFont[1];
            c.processAllFonts(x -> { if (f[0] == null) f[0] = x; });
            return PDType0Font.load((PDDocument) i.getArgument(0), f[0], true);
        }).when(pdfEdit).loadEmbeddedCjkFont(any(), any(), any());
        byte[] pdf = scan(false);
        var error = assertThrows(IllegalStateException.class, () -> service.searchablePdfFromCloud(pdf, List.of(asciiRaw("甲方"))));
        assertTrue(error.getMessage().contains("方"));
    }

    static JSONObject localResponse(boolean layout) throws Exception {
        JSONObject data = new JSONObject();
        data.set("markdown", new String(MineruLayoutReaderTest.class.getResourceAsStream("/ocr/mineru-sample.md").readAllBytes(),
                java.nio.charset.StandardCharsets.UTF_8));
        if (layout) {
            data.set("pages", List.of(new JSONObject().set("width", 594).set("height", 841)
                    .set("lines", List.of(new JSONObject().set("text", "Share Transfer").set("bbox", List.of(218, 71, 372, 95))))));
            data.set("images", new JSONObject());
        }
        return data;
    }

    @Test
    void localRouteNeverCallsCloudAndIsCached() throws Exception {
        byte[] pdf = scan(false);
        when(pptx.isHealthy()).thenReturn(true);
        when(pptx.ocrPdfLocal(anyString(), eq(true))).thenReturn(localResponse(true));
        var first = service.local(pdf, pdf, true);
        var second = service.local(pdf, pdf, true);
        verify(pptx, times(1)).ocrPdfLocal(anyString(), eq(true));
        verifyNoInteractions(ocr);
        assertTrue(first.hasLayout());
        assertEquals(first.markdown(), second.markdown());
        byte[] docx = service.layoutDocxFromLocal(pdf, first);
        assertTrue(TextUtils.getText(WordprocessingMLPackage.load(new ByteArrayInputStream(docx))
                .getMainDocumentPart().getJaxbElement()).contains("第一条"));
        try (PDDocument doc = Loader.loadPDF(service.searchablePdfFromLocal(pdf, first))) {
            assertTrue(new PDFTextStripper().getText(doc).contains("Share Transfer"));
        }
    }

    @Test
    void oldLocalComponentCannotMakeASearchablePdf() throws Exception {
        byte[] pdf = scan(false);
        when(pptx.isHealthy()).thenReturn(true);
        when(pptx.ocrPdfLocal(anyString(), eq(true))).thenReturn(localResponse(false));
        var result = service.local(pdf, pdf, true);
        assertFalse(result.hasLayout());
        assertThrows(OcrExportService.ComponentOutdatedException.class, () -> service.searchablePdfFromLocal(pdf, result));
        assertNotNull(service.layoutDocxFromLocal(pdf, result), "layout Word still works, just without pictures");
    }

    @Test
    void localServiceDownIsAClearFailure() throws Exception {
        when(pptx.isHealthy()).thenReturn(false);
        byte[] pdf = scan(false);
        assertThrows(IllegalStateException.class, () -> service.local(pdf, pdf, false));
    }

    @Test
    void mineruMarkdownBecomesPlainTextWithTableRows() throws Exception {
        String text = OcrExportService.plainText(localResponse(false).getStr("markdown"));
        assertTrue(text.startsWith("股权转让协议"));
        assertTrue(text.contains("期次\t付款条件\t付款金额（元)\t最迟付款日"));
        assertFalse(text.contains("<td"));
        assertFalse(text.contains("!["));
    }

    @Test
    void imageBecomesOnePagePdfAtTheRecognitionResolution() throws Exception {
        ByteArrayOutputStream png = new ByteArrayOutputStream();
        ImageIO.write(new BufferedImage(300, 600, BufferedImage.TYPE_INT_RGB), "png", png);
        try (PDDocument doc = Loader.loadPDF(OcrExportService.asPdf(png.toByteArray(), false))) {
            assertEquals(1, doc.getNumberOfPages());
            assertEquals(300 * 72f / 150, doc.getPage(0).getMediaBox().getWidth(), 0.01);
        }
    }
}
