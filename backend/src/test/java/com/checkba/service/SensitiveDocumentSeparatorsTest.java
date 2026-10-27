// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service;

import com.checkba.service.sensitive.SensitiveDocx;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.pdfbox.pdmodel.PDPageContentStream;
import org.apache.pdfbox.pdmodel.font.PDType1Font;
import org.apache.pdfbox.text.TextPosition;
import org.apache.pdfbox.util.Matrix;
import com.checkba.service.sensitive.SensitiveTextEngine;
import org.apache.pdfbox.pdmodel.font.Standard14Fonts;
import org.apache.poi.xwpf.usermodel.XWPFDocument;
import org.apache.poi.xwpf.usermodel.XWPFRun;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.zip.ZipFile;

import static org.junit.jupiter.api.Assertions.*;

class SensitiveDocumentSeparatorsTest {
    @TempDir Path dir;
    private final SensitiveService service = new SensitiveService();
    private static final String PASSWORD = "separators-test-2026";

    private SensitiveService.Options options(String mode, String... types) {
        return new SensitiveService.Options(List.of(types), mode, List.of(), List.of(), PASSWORD);
    }

    private void separator(XWPFRun run, String name) {
        switch (name) {
            case "br" -> run.addBreak();
            case "cr" -> run.addCarriageReturn();
            case "tab" -> run.addTab();
            default -> throw new IllegalArgumentException(name);
        }
    }

    @ParameterizedTest
    @ValueSource(strings = {"br", "cr", "tab"})
    void wordSeparatorsKeepNameAndAddressBoundariesAndRestoreOriginalLayout(String separator) throws Exception {
        Path source = dir.resolve(separator + ".docx");
        String original;
        try (var doc = new XWPFDocument()) {
            var paragraph = doc.createParagraph();
            var name = paragraph.createRun(); name.setBold(true); name.setText("被告一：徐");
            paragraph.createRun().setText("文清");
            separator(paragraph.createRun(), separator);
            paragraph.createRun().setText("住址：成都市武侯区星河路12号8栋608房");
            separator(paragraph.createRun(), separator);
            paragraph.createRun().setText("请求判令支付款项");
            original = paragraph.getText();
            try (var output = Files.newOutputStream(source)) { doc.write(output); }
        }
        var mask = options("MASK", "CHINESE_NAME", "ADDRESS");
        var preview = service.previewFile(source.toString(), mask);
        var result = service.processFile(source.toString(), mask);
        assertEquals(Map.of("CHINESE_NAME", 1, "ADDRESS", 1), preview.counts());
        assertEquals(preview.counts(), result.counts());
        assertEquals(preview.text(), String.join("\n", new SensitiveDocx(Path.of(result.path())).texts()));
        assertFalse(preview.text().contains("徐文清"));
        assertFalse(preview.text().contains("星河路"));
        assertTrue(preview.text().contains("请求判令支付款项"));
        var reversible = service.processFile(source.toString(), options("TOKEN", "CHINESE_NAME", "ADDRESS"));
        var restored = service.restoreFile(reversible.path(), reversible.recoveryKit(), PASSWORD);
        try (var doc = new XWPFDocument(Files.newInputStream(Path.of(restored.path())))) {
            assertEquals(original, doc.getParagraphs().get(0).getText());
            assertTrue(doc.getParagraphs().get(0).getRuns().get(0).isBold());
        }
        try (var zip = new ZipFile(restored.path())) {
            String xml = new String(zip.getInputStream(zip.getEntry("word/document.xml")).readAllBytes(), java.nio.charset.StandardCharsets.UTF_8);
            assertEquals(2, java.util.regex.Pattern.compile("<w:" + separator + "(?:\\s[^>]*)?\\s*/>").matcher(xml).results().count());
        }
    }

    @Test
    void wordLearningReusesNamesAcrossTableCellsAndParagraphs() throws Exception {
        Path source = dir.resolve("table.docx");
        try (var doc = new XWPFDocument()) {
            var table = doc.createTable(1, 2);
            table.getRow(0).getCell(0).setText("被告一");
            table.getRow(0).getCell(1).setText("徐文清");
            doc.createParagraph().createRun().setText("关于徐文清的证言。普通正文保持原样。");
            try (var output = Files.newOutputStream(source)) { doc.write(output); }
        }
        var opts = options("MASK", "CHINESE_NAME");
        var preview = service.previewFile(source.toString(), opts);
        var result = service.processFile(source.toString(), opts);
        assertEquals(2, result.counts().get("CHINESE_NAME"));
        assertEquals(preview.counts(), result.counts());
        assertEquals(preview.text(), String.join("\n", new SensitiveDocx(Path.of(result.path())).texts()));
        assertTrue(preview.text().endsWith("的证言。普通正文保持原样。"));
    }

    private Path pdf(String... lines) throws Exception {
        Path source = dir.resolve("sample-" + java.util.UUID.randomUUID() + ".pdf");
        try (var doc = new PDDocument()) {
            var page = new PDPage(); doc.addPage(page);
            try (var cs = new PDPageContentStream(doc, page)) {
                int y = 700;
                for (String line : lines) {
                    cs.beginText(); cs.setFont(new PDType1Font(Standard14Fonts.FontName.HELVETICA), 12);
                    cs.newLineAtOffset(60, y); cs.showText(line); cs.endText(); y -= 24;
                }
            }
            doc.save(source.toFile());
        }
        return source;
    }

    @Test
    void pdfEmailRectangleCoversDescendersAndAllRenderedInk() throws Exception {
        Path source = pdf("gyp@example.com");
        try (var doc = Loader.loadPDF(source.toFile())) {
            var areas = service.computeRedactionAreas(doc, List.of("EMAIL"));
            assertEquals(1, areas.size());
            var area = areas.get(0);
            float scale = 2;
            var image = new org.apache.pdfbox.rendering.PDFRenderer(doc).renderImage(0, scale);
            float pageHeight = doc.getPage(0).getMediaBox().getHeight();
            int ink = 0, uncovered = 0;
            for (int y = 0; y < image.getHeight(); y++) {
                for (int x = 0; x < image.getWidth(); x++) {
                    if ((image.getRGB(x, y) & 0xFFFFFF) == 0xFFFFFF) continue;
                    ink++;
                    float pdfX = (x + 0.5f) / scale, pdfY = pageHeight - (y + 0.5f) / scale;
                    if (pdfX < area.x || pdfX > area.x + area.width || pdfY < area.y || pdfY > area.y + area.height) uncovered++;
                }
            }
            assertTrue(ink > 0);
            assertEquals(0, uncovered, "Sensitive glyph pixels outside the redaction rectangle");
            assertTrue(area.height < 24, "One line must not produce a box spanning adjacent lines");
        }
    }

    @Test
    void pdfIndependentPhonesRemainSeparateInPreviewAndActualBlackBoxes() throws Exception {
        Path source = pdf("13800001111", "13900002222");
        var opts = options("MASK", "PHONE");
        var preview = service.previewFile(source.toString(), opts);
        var result = service.processFile(source.toString(), opts);
        assertEquals(Map.of("PHONE", 2), preview.counts());
        assertEquals(preview.counts(), result.counts());
        assertFalse(preview.text().contains("13800001111"));
        assertFalse(preview.text().contains("13900002222"));
        try (var doc = Loader.loadPDF(source.toFile())) {
            var areas = service.computeRedactionAreas(doc, List.of("PHONE"));
            assertEquals(2, areas.size());
            assertTrue(areas.stream().allMatch(area -> area.width > 0 && area.height > 0 && area.height < 24));
            assertTrue(Math.abs(areas.get(0).y - areas.get(1).y) > 20);
        }
    }

    @Test
    void pdfSplitPhoneCompatibilityUsesTheSamePreviewAndGenerationCounts() throws Exception {
        Path source = pdf("1380000", "1111");
        var opts = options("MASK", "PHONE");
        var preview = service.previewFile(source.toString(), opts);
        var result = service.processFile(source.toString(), opts);
        assertEquals(Map.of("PHONE", 1), preview.counts());
        assertEquals(preview.counts(), result.counts());
        try (var doc = Loader.loadPDF(source.toFile())) {
            var areas = service.computeRedactionAreas(doc, List.of("PHONE"));
            assertEquals(2, areas.size());
            assertTrue(areas.stream().allMatch(area -> area.height > 0 && area.height < 24));
        }
    }

    @Test
    void pdfSplitPhoneBeforeCompletePhoneDoesNotSwallowFollowingNumber() throws Exception {
        Path source = pdf("1380000", "1111", "13900002222");
        var opts = options("MASK", "PHONE");
        var preview = service.previewFile(source.toString(), opts);
        var result = service.processFile(source.toString(), opts);
        assertEquals(Map.of("PHONE", 2), preview.counts());
        assertEquals(preview.counts(), result.counts());
        try (var doc = Loader.loadPDF(source.toFile())) {
            assertEquals(3, service.computeRedactionAreas(doc, List.of("PHONE")).size());
        }
    }

    @Test
    void pdfDisabledPhoneRuleLeavesSplitDigitsAndLineBreaksInPreview() throws Exception {
        Path source = pdf("1380000", "1111");
        var opts = options("MASK", "ADDRESS");
        var preview = service.previewFile(source.toString(), opts);
        var result = service.processFile(source.toString(), opts);
        assertTrue(preview.counts().isEmpty());
        assertEquals(preview.counts(), result.counts());
        assertTrue(preview.text().contains("1380000\n1111"), preview.text());
    }

    @Test
    void pdfExcludedPhoneLeavesSplitDigitsAndLineBreaksInPreview() throws Exception {
        Path source = pdf("1380000", "1111");
        var opts = new SensitiveService.Options(List.of("PHONE"), "MASK", List.of(), List.of("13800001111"), null);
        var preview = service.previewFile(source.toString(), opts);
        var result = service.processFile(source.toString(), opts);
        assertTrue(preview.counts().isEmpty());
        assertEquals(preview.counts(), result.counts());
        assertTrue(preview.text().contains("1380000\n1111"), preview.text());
    }

    @ParameterizedTest
    @ValueSource(strings = {"被告一：徐文清", "被告⼀：徐⽂清"})
    void pdfChineseCoordinateCallbacksKeepFieldsSeparateFromFollowingProse(String party) throws Exception {
        // Exercise PDFBox's text/line callback contract without a machine-specific CJK font.
        var engine = new SensitiveTextEngine(List.of("CHINESE_NAME", "ADDRESS"), false, List.of(), List.of());
        var lines = List.of(party, "住址：成都市武侯区星河路12号8栋608房", "请求判令支付款项");
        engine.learn(String.join("\n", lines));
        Class<?> type = Class.forName("com.checkba.service.SensitiveService$SensitiveTextStripper");
        var constructor = type.getDeclaredConstructor(SensitiveService.class, SensitiveTextEngine.class);
        constructor.setAccessible(true);
        Object stripper = constructor.newInstance(service, engine);
        var write = type.getDeclaredMethod("writeString", String.class, List.class); write.setAccessible(true);
        var newline = type.getDeclaredMethod("writeLineSeparator"); newline.setAccessible(true);
        var finish = type.getDeclaredMethod("finishPage"); finish.setAccessible(true);
        for (int row = 0; row < lines.size(); row++) {
            String line = lines.get(row);
            var positions = new java.util.ArrayList<TextPosition>();
            for (int at = 0; at < line.length(); at++) {
                float x = 60 + at * 12, y = 700 - row * 24;
                positions.add(new TextPosition(0, 612, 792, Matrix.getTranslateInstance(x, y),
                        x + 12, y, 12, 12, 6, line.substring(at, at + 1), new int[]{at}, null, 12, 12));
            }
            write.invoke(stripper, line, positions);
            newline.invoke(stripper);
        }
        finish.invoke(stripper);
        assertEquals(Map.of("CHINESE_NAME", 1, "ADDRESS", 1), engine.counts());
        var preview = type.getDeclaredField("previewText"); preview.setAccessible(true);
        String text = preview.get(stripper).toString();
        assertFalse(text.contains("徐文清"));
        assertFalse(text.contains("徐⽂清"));
        assertFalse(text.contains("星河路"));
        assertTrue(text.contains("请求判令支付款项"));
        var result = type.getDeclaredMethod("getRedactionAreas"); result.setAccessible(true);
        @SuppressWarnings("unchecked")
        var areas = (List<SensitiveService.RedactionArea>) result.invoke(stripper);
        assertEquals(2, areas.size());
        assertTrue(areas.stream().allMatch(area -> area.width > 0 && area.height > 0 && area.height < 24));
    }

    @Test
    void pdfDoesNotJoinUnrelatedLinesIntoACredentialOrCustomTerm() throws Exception {
        Path source = pdf("1101051949", "1231002X", "Alice", "Cooper");
        var opts = new SensitiveService.Options(List.of("ID_CARD"), "MASK", List.of("AliceCooper"), List.of(), null);
        var preview = service.previewFile(source.toString(), opts);
        var result = service.processFile(source.toString(), opts);
        assertTrue(preview.counts().isEmpty(), preview.counts().toString());
        assertEquals(preview.counts(), result.counts());
        assertTrue(preview.text().contains("Alice\nCooper"));
    }
}
