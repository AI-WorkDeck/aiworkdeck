// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ocr;

import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.pdfbox.pdmodel.PDPageContentStream;
import org.apache.pdfbox.pdmodel.common.PDRectangle;
import org.apache.pdfbox.pdmodel.font.PDFont;
import org.apache.pdfbox.pdmodel.graphics.state.RenderingMode;
import org.apache.pdfbox.util.Matrix;

import java.io.IOException;
import java.util.List;

/**
 * Adds an invisible OCR text layer on top of existing page content ("searchable PDF").
 *
 * <p>Coordinates come in each page's own recognition frame (e.g. rendered-image pixels for cloud
 * OCR, MinerU's page points for local OCR) with a top-left origin <b>on the displayed page</b>
 * (rotation already applied, as the page was rendered). They are scaled to the displayed crop box
 * and mapped back to unrotated user space here. Text uses rendering mode 3 (neither fill nor
 * stroke) so the page looks exactly as before; each line is horizontally scaled to its box so
 * selection and search highlights line up with the scan. The original page content is appended to,
 * never replaced.
 */
public final class SearchablePdfWriter {

    /** One recognized line; box in the page's recognition frame, top-left origin. */
    public record Line(String text, double x0, double y0, double x1, double y1) {}

    /** Recognized lines of one page plus the size of the frame their coordinates are in. */
    public record PageText(double frameWidth, double frameHeight, List<Line> lines) {}

    private SearchablePdfWriter() {}

    /**
     * @return number of characters skipped because the font cannot encode them
     * @throws IllegalArgumentException when {@code pages} does not have one entry per PDF page
     */
    public static int addTextLayer(PDDocument doc, List<PageText> pages, PDFont font) throws IOException {
        if (pages.size() != doc.getNumberOfPages()) {
            throw new IllegalArgumentException("expected " + doc.getNumberOfPages() + " pages of OCR text, got " + pages.size());
        }
        int dropped = 0;
        for (int i = 0; i < pages.size(); i++) {
            PageText text = pages.get(i);
            if (text.lines().isEmpty() || text.frameWidth() <= 0 || text.frameHeight() <= 0) continue;
            PDPage page = doc.getPage(i);
            try (PDPageContentStream out = new PDPageContentStream(doc, page,
                    PDPageContentStream.AppendMode.APPEND, true, true)) {
                for (Line line : text.lines()) dropped += writeLine(out, page, text, line, font);
            }
        }
        return dropped;
    }

    private static int writeLine(PDPageContentStream out, PDPage page, PageText frame, Line line, PDFont font)
            throws IOException {
        StringBuilder kept = new StringBuilder();
        int dropped = 0;
        String raw = line.text() == null ? "" : line.text();
        for (int i = 0; i < raw.length(); ) {
            int cp = raw.codePointAt(i);
            String ch = new String(Character.toChars(cp));
            i += ch.length();
            if (Character.isISOControl(cp)) continue;
            try {
                font.encode(ch);
                kept.append(ch);
            } catch (IllegalArgumentException | IOException e) {
                dropped++;
            }
        }
        String text = kept.toString();
        if (text.isBlank()) return dropped;

        PDRectangle box = page.getCropBox();
        int rotation = ((page.getRotation() % 360) + 360) % 360;
        boolean sideways = rotation == 90 || rotation == 270;
        double dispW = sideways ? box.getHeight() : box.getWidth();
        double dispH = sideways ? box.getWidth() : box.getHeight();
        double sx = dispW / frame.frameWidth(), sy = dispH / frame.frameHeight();

        double u0 = Math.min(line.x0(), line.x1()) * sx, u1 = Math.max(line.x0(), line.x1()) * sx;
        double v0 = Math.min(line.y0(), line.y1()) * sy, v1 = Math.max(line.y0(), line.y1()) * sy;
        double height = Math.max(v1 - v0, 1);
        double width = Math.max(u1 - u0, 1);
        float fontSize = (float) (height * 0.85);
        // Baseline sits a little above the bottom of the box (descender room).
        double baseU = u0, baseV = v1 - height * 0.18;

        double[] origin = toUserSpace(baseU, baseV, box, rotation);
        float natural = font.getStringWidth(text) / 1000f * fontSize;
        float scale = natural > 0 ? (float) (width / natural * 100) : 100f;

        out.beginText();
        out.setRenderingMode(RenderingMode.NEITHER);
        out.setFont(font, fontSize);
        out.setHorizontalScaling(scale);
        out.setTextMatrix(Matrix.getRotateInstance(Math.toRadians(rotation), (float) origin[0], (float) origin[1]));
        out.showText(text);
        out.endText();
        return dropped;
    }

    /**
     * Characters whose glyph the font shares with a lower code point (e.g. 方 with the Kangxi
     * radical ⽅ U+2F45 in STHeiti). PDFBox writes the first code point of a glyph into ToUnicode, so
     * such characters would extract as the look-alike and a search for "甲方" would find nothing.
     * A font that returns any here must not be used for the text layer.
     */
    public static String aliasedCharacters(PDFont font, List<PageText> pages) throws IOException {
        if (!(font instanceof org.apache.pdfbox.pdmodel.font.PDType0Font type0)
                || !(type0.getDescendantFont() instanceof org.apache.pdfbox.pdmodel.font.PDCIDFontType2 cid)) return "";
        var cmap = cid.getTrueTypeFont().getUnicodeCmapLookup();
        java.util.Set<Integer> seen = new java.util.HashSet<>();
        StringBuilder aliased = new StringBuilder();
        for (PageText page : pages) for (Line line : page.lines()) {
            String text = line.text() == null ? "" : line.text();
            text.codePoints().filter(seen::add).forEach(cp -> {
                int gid = cmap.getGlyphId(cp);
                if (gid == 0) return;
                List<Integer> codes = cmap.getCharCodes(gid);
                if (codes != null && !codes.isEmpty() && codes.get(0) != cp) aliased.appendCodePoint(cp);
            });
        }
        return aliased.toString();
    }

    /** Displayed-page point (top-left origin) → unrotated PDF user space. */
    static double[] toUserSpace(double u, double v, PDRectangle box, int rotation) {
        double x0 = box.getLowerLeftX(), y0 = box.getLowerLeftY(), w = box.getWidth(), h = box.getHeight();
        return switch (rotation) {
            case 90 -> new double[]{x0 + v, y0 + u};
            case 180 -> new double[]{x0 + w - u, y0 + v};
            case 270 -> new double[]{x0 + w - v, y0 + h - u};
            default -> new double[]{x0 + u, y0 + h - v};
        };
    }
}
