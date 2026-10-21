// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.ai;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.pdmodel.*;
import org.apache.pdfbox.pdmodel.font.*;
import org.apache.pdfbox.text.PDFTextStripper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.test.util.ReflectionTestUtils;
import java.nio.file.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

class PdfEditFontSafetyTest {
    @TempDir Path dir;
    Path input() throws Exception {
        Path input = dir.resolve("input.pdf");
        try (var doc = new PDDocument()) {
            doc.addPage(new PDPage());
            try (var stream = new PDPageContentStream(doc, doc.getPage(0))) {
                stream.beginText(); stream.setFont(new PDType1Font(Standard14Fonts.FontName.HELVETICA), 12);
                stream.newLineAtOffset(40, 700); stream.showText("CONTRACT"); stream.endText();
            }
            doc.save(input.toFile());
        }
        return input;
    }
    @Test void missingFontDoesNotChangeOriginalOrCreateNumberedOutput() throws Exception {
        var service = spy(new PdfEditService()); doReturn(null).when(service).resolveCjkFontFile();
        Path input = input(), output = dir.resolve("out.pdf"); byte[] original = Files.readAllBytes(input);
        assertThrows(PdfEditService.PdfEditException.class, () -> service.replaceText(input, "CONTRACT", "合同", null));
        assertThrows(PdfEditService.PdfEditException.class, () -> service.addPageNumbers(input, output, "bottom-center", 1, "第{n}页"));
        assertArrayEquals(original, Files.readAllBytes(input)); assertFalse(Files.exists(output));
    }
    @Test void fontWithoutRequiredGlyphsDoesNotChangeOriginal() throws Exception {
        var service = spy(new PdfEditService());
        doReturn(dir.resolve("unusable.ttf").toFile()).when(service).resolveCjkFontFile();
        doReturn(new PDType1Font(Standard14Fonts.FontName.HELVETICA)).when(service).loadEmbeddedCjkFont(any(), any(), any());
        Path input = input(); byte[] original = Files.readAllBytes(input);
        var error = assertThrows(PdfEditService.PdfEditException.class, () -> service.replaceText(input, "CONTRACT", "合同", null));
        assertTrue(error.getMessage().contains("未修改")); assertArrayEquals(original, Files.readAllBytes(input));
    }
    @Test void bundledTrueTypeFontEmbedsAndPreservesChinesePageNumbers() throws Exception {
        String font = System.getenv("AWD_TEST_CJK_FONT");
        org.junit.jupiter.api.Assumptions.assumeTrue(font != null && Files.isRegularFile(Path.of(font)), "Pass bundled cjk-kai.ttf to exercise the real font");
        var service = new PdfEditService(); ReflectionTestUtils.setField(service, "configuredCjkFontPath", font);
        assertEquals(Path.of(font).toFile(), service.resolveCjkFontFile());
        Path input = input(), output = dir.resolve("out.pdf"); byte[] original = Files.readAllBytes(input);
        assertEquals(1, service.addPageNumbers(input, output, "bottom-center", 1, "第{n}页 共{total}页"));
        try (var doc = Loader.loadPDF(output.toFile())) {
            String text = new PDFTextStripper().getText(doc);
            assertTrue(text.contains("第1页 共1页"), text); assertTrue(text.contains("CONTRACT"), text);
        }
        assertArrayEquals(original, Files.readAllBytes(input));
    }
}
