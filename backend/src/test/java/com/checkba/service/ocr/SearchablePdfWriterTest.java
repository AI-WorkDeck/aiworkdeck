// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.ocr;

import org.apache.pdfbox.Loader;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.pdfbox.pdmodel.PDPageContentStream;
import org.apache.pdfbox.pdmodel.common.PDRectangle;
import org.apache.pdfbox.pdmodel.font.PDFont;
import org.apache.pdfbox.pdmodel.font.PDType0Font;
import org.apache.pdfbox.rendering.PDFRenderer;
import org.apache.pdfbox.text.PDFTextStripper;
import org.apache.pdfbox.text.TextPosition;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class SearchablePdfWriterTest {

    /** Ships inside the PDFBox jar (TrueType, Latin only), so these tests run on any CI machine. */
    static final String LATIN = "/org/apache/pdfbox/resources/ttf/LiberationSans-Regular.ttf";
    /** macOS system CJK TrueType collection; the CJK test is skipped where it does not exist. */
    static final File CJK = new File("/System/Library/Fonts/STHeiti Light.ttc");

    /** A "scanned" page: a filled grey rectangle standing in for the page image. */
    static PDDocument scan(int rotation) throws Exception {
        PDDocument doc = new PDDocument();
        PDPage page = new PDPage(PDRectangle.A4);
        page.setRotation(rotation);
        doc.addPage(page);
        try (var c = new PDPageContentStream(doc, page)) {
            c.setNonStrokingColor(new java.awt.Color(200, 200, 200));
            c.addRect(50, 50, 200, 100);
            c.fill();
        }
        return doc;
    }

    /** First glyph of {@code needle} in displayed (rotation-applied, top-left origin) coordinates. */
    static float[] locate(PDDocument doc, String needle) throws Exception {
        List<TextPosition> all = new ArrayList<>();
        PDFTextStripper stripper = new PDFTextStripper() {
            @Override protected void writeString(String text, List<TextPosition> positions) {
                all.addAll(positions);
            }
        };
        stripper.getText(doc);
        StringBuilder joined = new StringBuilder();
        for (TextPosition p : all) joined.append(p.getUnicode());
        int at = joined.indexOf(needle);
        assertTrue(at >= 0, "text layer should contain " + needle + " but was " + joined);
        TextPosition first = all.get(at);
        return new float[]{first.getXDirAdj(), first.getYDirAdj()};
    }

    static BufferedImage render(PDDocument doc) throws Exception {
        return new PDFRenderer(doc).renderImageWithDPI(0, 72);
    }

    static PDFont font(PDDocument doc) throws Exception {
        try (var in = SearchablePdfWriterTest.class.getResourceAsStream(LATIN)) {
            return PDType0Font.load(doc, in);
        }
    }

    @ParameterizedTest
    @ValueSource(ints = {0, 90, 180, 270})
    void textLandsWhereTheLineWasRecognizedOnTheDisplayedPage(int rotation) throws Exception {
        try (PDDocument doc = scan(rotation)) {
            PDRectangle box = doc.getPage(0).getCropBox();
            boolean sideways = rotation == 90 || rotation == 270;
            double dispW = sideways ? box.getHeight() : box.getWidth();
            double dispH = sideways ? box.getWidth() : box.getHeight();
            // Recognized in a 1000-unit wide frame (e.g. image pixels); writer must scale to the page.
            double frameW = 1000, frameH = 1000 * dispH / dispW;
            var line = new SearchablePdfWriter.Line("Share Transfer", 100, 200, 400, 240);
            int dropped = SearchablePdfWriter.addTextLayer(doc,
                    List.of(new SearchablePdfWriter.PageText(frameW, frameH, List.of(line))), font(doc));
            assertEquals(0, dropped);

            float[] xy = locate(doc, "Share Transfer");
            double scale = dispW / frameW;
            assertEquals(100 * scale, xy[0], 3.0, "x of first glyph (rotation " + rotation + ")");
            // YDirAdj is the baseline, measured from the top of the displayed page
            assertTrue(xy[1] > 200 * scale && xy[1] <= 240 * scale + 1,
                    "baseline inside the line box (rotation " + rotation + "): " + xy[1]);
        }
    }

    @Test
    void layerIsInvisibleAndOriginalContentIsKept() throws Exception {
        try (PDDocument doc = scan(0)) {
            BufferedImage before = render(doc);
            SearchablePdfWriter.addTextLayer(doc, List.of(new SearchablePdfWriter.PageText(595, 842,
                    List.of(new SearchablePdfWriter.Line("Party A warrants title", 60, 700, 400, 720)))), font(doc));
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            doc.save(out);
            try (PDDocument reread = Loader.loadPDF(out.toByteArray())) {
                assertEquals(1, reread.getNumberOfPages());
                BufferedImage after = render(reread);
                for (int y = 0; y < before.getHeight(); y++)
                    for (int x = 0; x < before.getWidth(); x++)
                        assertEquals(before.getRGB(x, y), after.getRGB(x, y), "pixel changed at " + x + "," + y);
                assertTrue(new PDFTextStripper().getText(reread).contains("Party A warrants title"));
            }
        }
    }

    @Test
    void charactersTheFontCannotEncodeAreDroppedNotFatal() throws Exception {
        try (PDDocument doc = scan(0)) {
            int dropped = SearchablePdfWriter.addTextLayer(doc, List.of(new SearchablePdfWriter.PageText(595, 842,
                    List.of(new SearchablePdfWriter.Line("Seal 合同 ok", 60, 100, 300, 120)))), font(doc));
            assertEquals(2, dropped, "the Latin font has no CJK glyphs");
            assertTrue(new PDFTextStripper().getText(doc).contains("Seal  ok"));
        }
    }

    @Test
    void pagesWithoutLinesAreLeftUntouched() throws Exception {
        try (PDDocument doc = scan(0)) {
            doc.addPage(new PDPage(PDRectangle.A4));
            SearchablePdfWriter.addTextLayer(doc, List.of(
                    new SearchablePdfWriter.PageText(595, 842, List.of()),
                    new SearchablePdfWriter.PageText(595, 842, List.of(new SearchablePdfWriter.Line("Page two", 60, 100, 200, 120)))),
                    font(doc));
            PDFTextStripper stripper = new PDFTextStripper();
            stripper.setStartPage(1); stripper.setEndPage(1);
            assertEquals("", stripper.getText(doc).strip());
            stripper.setStartPage(2); stripper.setEndPage(2);
            assertTrue(stripper.getText(doc).contains("Page two"));
        }
    }

    @Test
    void mismatchedPageCountIsRejected() throws Exception {
        try (PDDocument doc = scan(0)) {
            assertThrows(IllegalArgumentException.class, () -> SearchablePdfWriter.addTextLayer(doc, List.of(), font(doc)));
        }
    }

    @Test
    void chineseLinesAreSearchableWithAnEmbeddedCjkTrueTypeFont() throws Exception {
        org.junit.jupiter.api.Assumptions.assumeTrue(CJK.isFile(), "needs a CJK TrueType font on this machine");
        try (PDDocument doc = scan(0);
             var collection = new org.apache.fontbox.ttf.TrueTypeCollection(CJK)) {
            org.apache.fontbox.ttf.TrueTypeFont[] first = new org.apache.fontbox.ttf.TrueTypeFont[1];
            collection.processAllFonts(f -> { if (first[0] == null) first[0] = f; });
            PDFont cjk = PDType0Font.load(doc, first[0], true);
            int dropped = SearchablePdfWriter.addTextLayer(doc, List.of(new SearchablePdfWriter.PageText(595, 842,
                    List.of(new SearchablePdfWriter.Line("股权转让协议", 60, 100, 300, 130)))), cjk);
            assertEquals(0, dropped);
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            doc.save(out);
            try (PDDocument reread = Loader.loadPDF(out.toByteArray())) {
                assertTrue(new PDFTextStripper().getText(reread).contains("股权转让协议"));
            }
        }
    }

    @Test
    void fontsThatShareGlyphsWithRadicalsAreDetected() throws Exception {
        var pages = List.of(new SearchablePdfWriter.PageText(595, 842,
                List.of(new SearchablePdfWriter.Line("甲方乙方 Party", 0, 0, 100, 20))));
        try (PDDocument doc = new PDDocument()) {
            assertEquals("", SearchablePdfWriter.aliasedCharacters(font(doc), pages), "Latin font has no aliases");
        }
        org.junit.jupiter.api.Assumptions.assumeTrue(CJK.isFile(), "needs the macOS STHeiti collection");
        try (PDDocument doc = new PDDocument();
             var collection = new org.apache.fontbox.ttf.TrueTypeCollection(CJK)) {
            org.apache.fontbox.ttf.TrueTypeFont[] first = new org.apache.fontbox.ttf.TrueTypeFont[1];
            collection.processAllFonts(f -> { if (first[0] == null) first[0] = f; });
            String aliased = SearchablePdfWriter.aliasedCharacters(PDType0Font.load(doc, first[0], true), pages);
            assertTrue(aliased.contains("方"), "方 shares its glyph with the radical U+2F45: " + aliased);
            assertFalse(aliased.contains("甲"));
        }
    }
}
