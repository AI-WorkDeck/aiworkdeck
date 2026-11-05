// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ocr;

import com.checkba.service.ocr.OcrLayout.*;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Element;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Local OCR (MinerU, via pptx-service {@code /api/pdf/ocr-markdown-local} with {@code layout:true})
 * → {@link OcrLayout}. MinerU already resolves reading order, headings and table structure; this only
 * maps its markdown (headings, paragraphs, HTML tables with row/col spans, image references) onto
 * the shared model so both OCR routes render through {@link LayoutDocxWriter}. Markdown carries no
 * page breaks, so the result is a single flowing page with standard margins.
 */
public final class MineruLayoutReader {

    /** One page of the service's {@code pages} array: size in PDF points and recognized lines. */
    public record PageLines(double width, double height, List<SearchablePdfWriter.Line> lines) {}

    private static final double MARGIN = 72;
    private static final Pattern IMAGE = Pattern.compile("^!\\[[^\\]]*]\\(([^)\\s]+)\\)\\s*$");
    private static final Pattern HEADING = Pattern.compile("^(#{1,6})\\s+(.*)$");
    private static final Pattern BLOCK_TAG = Pattern.compile("</?[a-zA-Z][a-zA-Z0-9]*(\\s[^>]*)?>");
    private static final Pattern ESCAPE = Pattern.compile("\\\\([\\\\`*_{}\\[\\]()#+\\-.!|<>~])");

    private MineruLayoutReader() {}

    /**
     * @param images markdown image reference → base64 bytes (as returned by the service; missing or
     *               undecodable images are skipped)
     */
    public static List<Page> read(String markdown, Map<String, String> images, double pageWidthPt, double pageHeightPt) {
        double textWidth = pageWidthPt - 2 * MARGIN;
        List<Block> blocks = new ArrayList<>();
        boolean titleSeen = false;
        for (String chunk : chunks(markdown == null ? "" : markdown)) {
            String t = chunk.strip();
            if (t.isEmpty()) continue;
            if (t.regionMatches(true, 0, "<details", 0, 8)) continue; // seal OCR block: the seal picture is kept
            if (t.regionMatches(true, 0, "<table", 0, 6)) {
                Table table = table(t, textWidth);
                if (table != null) blocks.add(table);
                continue;
            }
            Matcher img = IMAGE.matcher(t);
            if (img.matches()) {
                Picture pic = picture(images.get(img.group(1)), textWidth);
                if (pic != null) blocks.add(pic);
                continue;
            }
            Matcher h = HEADING.matcher(t);
            if (h.matches()) {
                boolean title = h.group(1).length() == 1 && !titleSeen;
                titleSeen |= title;
                blocks.add(new Para(unescape(h.group(2).strip()), title ? Kind.TITLE : Kind.HEADING,
                        title ? Align.CENTER : Align.LEFT, false));
                continue;
            }
            String text = unescape(String.join("", t.lines().map(String::strip).toList()));
            // A block that is HTML (starts with a tag) keeps only its text; a lone '<' in prose stays.
            if (BLOCK_TAG.matcher(text).lookingAt()) text = Jsoup.parseBodyFragment(text).text().strip();
            if (text.isEmpty()) continue;
            blocks.add(new Para(text, Kind.BODY, Align.LEFT, true));
        }
        return List.of(new Page(pageWidthPt, pageHeightPt, MARGIN, MARGIN, MARGIN, MARGIN, 12, 20, blocks));
    }

    /**
     * Blank-line separated chunks; an HTML table is always its own chunk even without blank lines,
     * and a {@code <details>…</details>} block (MinerU's seal OCR) stays one chunk across blank lines.
     */
    static List<String> chunks(String markdown) {
        List<String> out = new ArrayList<>();
        StringBuilder cur = new StringBuilder();
        StringBuilder details = null;
        for (String line : markdown.replace("\r\n", "\n").split("\n", -1)) {
            if (details == null && line.strip().regionMatches(true, 0, "<details", 0, 8)) {
                if (cur.length() > 0) { out.add(cur.toString()); cur.setLength(0); }
                details = new StringBuilder();
            }
            if (details != null) {
                details.append(line).append('\n');
                if (line.toLowerCase(java.util.Locale.ROOT).contains("</details>")) { out.add(details.toString()); details = null; }
                continue;
            }
            boolean tableLine = line.strip().regionMatches(true, 0, "<table", 0, 6);
            if (line.isBlank() || tableLine) {
                if (cur.length() > 0) { out.add(cur.toString()); cur.setLength(0); }
                if (tableLine) out.add(line);
                continue;
            }
            if (cur.length() > 0) cur.append('\n');
            cur.append(line);
        }
        if (cur.length() > 0) out.add(cur.toString());
        if (details != null) out.add(details.toString()); // unterminated: still dropped as a whole
        return out;
    }

    static String unescape(String s) {
        return ESCAPE.matcher(s).replaceAll("$1");
    }

    static Table table(String html, double textWidth) {
        Element table = Jsoup.parseBodyFragment(html).selectFirst("table");
        if (table == null) return null;
        List<Cell> cells = new ArrayList<>();
        // occupied[r] holds the columns already taken in row r by row spans from above
        List<Set<Integer>> occupied = new ArrayList<>();
        int r = 0, cols = 0;
        for (Element tr : table.select("tr")) {
            while (occupied.size() <= r) occupied.add(new HashSet<>());
            int c = 0;
            for (Element td : tr.select("> td, > th")) {
                while (occupied.get(r).contains(c)) c++;
                int rs = Math.max(1, intAttr(td, "rowspan")), cs = Math.max(1, intAttr(td, "colspan"));
                cells.add(new Cell(r, r + rs - 1, c, c + cs - 1, td.text().strip()));
                for (int dr = 0; dr < rs; dr++) {
                    while (occupied.size() <= r + dr) occupied.add(new HashSet<>());
                    for (int dc = 0; dc < cs; dc++) occupied.get(r + dr).add(c + dc);
                }
                c += cs;
                cols = Math.max(cols, c);
            }
            r++;
        }
        int rows = Math.max(r, occupied.size());
        if (cells.isEmpty() || cols == 0) return null;
        double[] widths = new double[cols];
        Arrays.fill(widths, textWidth / cols);
        return new Table(rows, cols, cells, widths);
    }

    static int intAttr(Element e, String name) {
        try {
            return Integer.parseInt(e.attr(name).strip());
        } catch (NumberFormatException ex) {
            return 1;
        }
    }

    static Picture picture(String base64, double textWidth) {
        if (base64 == null || base64.isBlank()) return null;
        try {
            String payload = base64.startsWith("data:") ? base64.substring(base64.indexOf(',') + 1) : base64;
            byte[] bytes = Base64.getDecoder().decode(payload.strip());
            BufferedImage img = ImageIO.read(new ByteArrayInputStream(bytes));
            if (img == null) return null;
            // MinerU crops from a ~200 DPI render; scale to points and never exceed the text width
            double w = img.getWidth() * 72.0 / 200, h = img.getHeight() * 72.0 / 200;
            if (w > textWidth) { h = h * textWidth / w; w = textWidth; }
            java.io.ByteArrayOutputStream png = new java.io.ByteArrayOutputStream();
            ImageIO.write(img, "png", png);
            return new Picture(png.toByteArray(), w, h, null, null);
        } catch (Exception e) {
            return null;
        }
    }

    public static List<SearchablePdfWriter.PageText> searchLines(List<PageLines> pages) {
        List<SearchablePdfWriter.PageText> out = new ArrayList<>();
        for (PageLines p : pages) out.add(new SearchablePdfWriter.PageText(p.width(), p.height(), p.lines()));
        return out;
    }
}
