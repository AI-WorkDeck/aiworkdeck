// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ocr;

import com.checkba.service.ocr.OcrLayout.Align;
import com.checkba.service.ocr.OcrLayout.Block;
import com.checkba.service.ocr.OcrLayout.Kind;
import com.checkba.service.ocr.OcrLayout.Para;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.util.*;

/**
 * Rebuilds reading order and structure from an Aliyun RecognizeAllText result requested with
 * layout on (block points, table cells, stamps; see {@code AliyunOcrClient.buildRequest}).
 *
 * <p>Aliyun's own paragraph info merges the two columns of a two-column page line by line, and its
 * block order interleaves them, so reading order is derived here from coordinates:
 * <ol>
 *   <li>table cell blocks become a table; blocks that are the seal's own text are dropped;</li>
 *   <li>a vertical gutter is accepted only where at least three left/right line pairs sit side by
 *       side, so a centred "编号 … 签署地" line does not turn a page into two columns;</li>
 *   <li>blocks on the same line are joined, but never across the gutter;</li>
 *   <li>lines spanning the gutter, tables and one-sided lines with nothing beside them (section
 *       headings) cut the page into bands; each band is read left column first, then right;</li>
 *   <li>paragraphs break on indent, a short previous line, alignment change or a paragraph gap.</li>
 * </ol>
 * All thresholds are in units of the median line height so they do not depend on render DPI.
 */
public final class AliyunLayoutReader {

    /** The raw result has no coordinates (request made without layout, or an old gateway). */
    public static final class MissingLayoutException extends IllegalStateException {
        public MissingLayoutException(String message) { super(message); }
    }

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private AliyunLayoutReader() {}

    // ------------------------------------------------------------------ parsing

    record Box(double x0, double y0, double x1, double y1) {
        double w() { return x1 - x0; }
        double h() { return y1 - y0; }
        double cx() { return (x0 + x1) / 2; }
        double area() { return Math.max(0, w()) * Math.max(0, h()); }
        double overlapArea(Box o) {
            double w = Math.min(x1, o.x1) - Math.max(x0, o.x0), h = Math.min(y1, o.y1) - Math.max(y0, o.y0);
            return w > 0 && h > 0 ? w * h : 0;
        }
        boolean vOverlaps(double a, double b) { return y0 < b && a < y1; }
    }

    record Text(int id, String text, Box box) {}

    record Parsed(double width, double height, List<Text> blocks, List<TableSrc> tables, List<Stamp> stamps) {}

    record CellSrc(int r0, int r1, int c0, int c1, String text, Box box) {}

    record TableSrc(Box box, int rows, int cols, List<CellSrc> cells, Set<Integer> blockIds) {}

    record Stamp(Box box, List<String> texts) {}

    static Box box(JsonNode points) {
        if (!points.isArray() || points.isEmpty()) return null;
        double x0 = Double.MAX_VALUE, y0 = Double.MAX_VALUE, x1 = -Double.MAX_VALUE, y1 = -Double.MAX_VALUE;
        for (JsonNode p : points) {
            double x = p.path("x").asDouble(), y = p.path("y").asDouble();
            x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
        }
        return new Box(x0, y0, x1, y1);
    }

    static Parsed parse(String raw) {
        JsonNode root;
        try {
            root = MAPPER.readTree(raw == null ? "" : raw);
        } catch (Exception e) {
            throw new MissingLayoutException("OCR result is not JSON");
        }
        List<Text> blocks = new ArrayList<>();
        List<TableSrc> tables = new ArrayList<>();
        List<Stamp> stamps = new ArrayList<>();
        boolean anyText = false;
        for (JsonNode image : root.path("subImages")) {
            for (JsonNode b : image.path("blockInfo").path("blockDetails")) {
                String text = b.path("blockContent").asText("").strip();
                if (text.isEmpty()) continue;
                anyText = true;
                Box box = box(b.path("blockPoints"));
                if (box == null) continue;
                blocks.add(new Text(b.path("blockId").asInt(blocks.size()), text, box));
            }
            for (JsonNode t : image.path("tableInfo").path("tableDetails")) {
                List<CellSrc> cells = new ArrayList<>();
                Set<Integer> ids = new HashSet<>();
                int rows = 0, cols = 0;
                for (JsonNode c : t.path("cellDetails")) {
                    CellSrc cell = new CellSrc(c.path("rowStart").asInt(), c.path("rowEnd").asInt(),
                            c.path("columnStart").asInt(), c.path("columnEnd").asInt(),
                            c.path("cellContent").asText("").strip(), box(c.path("cellPoints")));
                    cells.add(cell);
                    rows = Math.max(rows, cell.r1() + 1);
                    cols = Math.max(cols, cell.c1() + 1);
                    for (JsonNode id : c.path("blockList")) ids.add(id.asInt());
                }
                Box tb = box(t.path("tablePoints"));
                if (tb == null) tb = union(cells.stream().map(CellSrc::box).filter(Objects::nonNull).toList());
                if (tb != null && !cells.isEmpty()) {
                    tables.add(new TableSrc(tb, Math.max(rows, t.path("rowCount").asInt(0)),
                            Math.max(cols, t.path("columnCount").asInt(0)), cells, ids));
                }
            }
            for (JsonNode s : image.path("stampInfo").path("stampDetails")) {
                Box sb = box(s.path("stampPoints"));
                if (sb == null) continue;
                List<String> texts = new ArrayList<>();
                s.path("data").fields().forEachRemaining(e -> {
                    String v = e.getValue().asText("").strip();
                    if (v.length() >= 2) texts.add(v);
                });
                stamps.add(new Stamp(sb, texts));
            }
        }
        if (anyText && blocks.isEmpty()) {
            throw new MissingLayoutException("OCR result has no text coordinates");
        }
        return new Parsed(root.path("width").asDouble(0), root.path("height").asDouble(0), blocks, tables, stamps);
    }

    static Box union(List<Box> boxes) {
        if (boxes.isEmpty()) return null;
        double x0 = Double.MAX_VALUE, y0 = Double.MAX_VALUE, x1 = -Double.MAX_VALUE, y1 = -Double.MAX_VALUE;
        for (Box b : boxes) { x0 = Math.min(x0, b.x0); y0 = Math.min(y0, b.y0); x1 = Math.max(x1, b.x1); y1 = Math.max(y1, b.y1); }
        return new Box(x0, y0, x1, y1);
    }

    /** Every recognized line, tables and seal text included, for the invisible PDF text layer. */
    public static SearchablePdfWriter.PageText searchLines(String raw) {
        Parsed p = parse(raw);
        if (p.width() <= 0 || p.height() <= 0) throw new MissingLayoutException("OCR result has no page size");
        List<SearchablePdfWriter.Line> lines = new ArrayList<>();
        for (Text t : p.blocks()) lines.add(new SearchablePdfWriter.Line(t.text(), t.box().x0, t.box().y0, t.box().x1, t.box().y1));
        return new SearchablePdfWriter.PageText(p.width(), p.height(), lines);
    }

    // ------------------------------------------------------------------ reconstruction

    /** A visual line: one or more blocks side by side, or a table. */
    static final class Row {
        final List<Text> parts = new ArrayList<>();
        Box box;
        TableSrc table;
        int side; // -1 left of gutter, 1 right, 0 spanning / no gutter
        double colLeft, colRight;
        String text(double lh) {
            parts.sort(Comparator.comparingDouble(t -> t.box().x0));
            StringBuilder sb = new StringBuilder();
            Text prev = null;
            for (Text t : parts) {
                if (prev != null && t.box().x0 - prev.box().x1 > 0.6 * lh) sb.append('　');
                sb.append(t.text());
                prev = t;
            }
            return sb.toString();
        }
    }

    /**
     * @param pageImage the rendered page the raw was recognized from (any resolution), used to crop
     *                  the seal; null skips the seal picture
     */
    public static OcrLayout.Page read(String raw, double pageWidthPt, double pageHeightPt, BufferedImage pageImage) {
        Parsed p = parse(raw);
        if (p.width() <= 0 || p.height() <= 0) throw new MissingLayoutException("OCR result has no page size");
        double sx = pageWidthPt / p.width(), sy = pageHeightPt / p.height();

        Set<Integer> inTables = new HashSet<>();
        p.tables().forEach(t -> inTables.addAll(t.blockIds()));
        List<Text> body = new ArrayList<>();
        for (Text t : p.blocks()) {
            if (inTables.contains(t.id())) continue;
            if (p.tables().stream().anyMatch(tb -> t.box().overlapArea(tb.box()) >= 0.8 * t.box().area())) continue;
            if (isSealText(t, p.stamps())) continue;
            body.add(t);
        }
        double lh = medianHeight(body.isEmpty() ? p.blocks() : body);

        Double gutter = gutter(body, p.width(), lh);
        List<Row> rows = rows(body, gutter, lh);
        for (TableSrc t : p.tables()) {
            Row r = new Row();
            r.box = t.box();
            r.table = t;
            rows.add(r);
        }
        rows.sort(Comparator.comparingDouble(r -> r.box.y0));

        double pageLeft = rows.stream().mapToDouble(r -> r.box.x0).min().orElse(0);
        double pageRight = rows.stream().mapToDouble(r -> r.box.x1).max().orElse(p.width());
        List<Row> ordered = order(rows, gutter, lh, pageLeft, pageRight);

        Map<Block, Box> paraBoxes = new IdentityHashMap<>();
        List<Double> pitches = new ArrayList<>();
        List<Block> blocks = paragraphs(ordered, lh, sx, pageLeft, pageRight, paraBoxes, pitches);
        if (pageImage != null) {
            for (Stamp s : p.stamps()) {
                byte[] png = crop(pageImage, s.box(), p.width(), p.height());
                if (png == null) continue;
                Block host = null;
                double best = 0;
                for (Map.Entry<Block, Box> e : paraBoxes.entrySet()) {
                    double overlap = e.getValue().overlapArea(s.box());
                    if (overlap > best) { best = overlap; host = e.getKey(); }
                }
                int at = host == null ? blocks.size() : blocks.indexOf(host);
                double dy = host == null ? 0 : (s.box().y0 - paraBoxes.get(host).y0) * sy;
                blocks.add(at, new OcrLayout.Picture(png, s.box().w() * sx, s.box().h() * sy, s.box().x0 * sx, dy));
            }
        }
        double bodyPt = Math.max(8, Math.min(16, Math.round(lh * sy / 1.25 * 2) / 2.0));
        double pitch = pitches.isEmpty() ? lh * 1.4 : pitches.stream().sorted().toList().get(pitches.size() / 2);
        double linePitchPt = Math.max(bodyPt * 1.1, Math.min(bodyPt * 2.5, pitch * sy));
        double top = rows.stream().mapToDouble(r -> r.box.y0).min().orElse(0);
        double bottom = rows.stream().mapToDouble(r -> r.box.y1).max().orElse(p.height());
        return new OcrLayout.Page(pageWidthPt, pageHeightPt,
                clampMargin(pageLeft * sx), clampMargin((p.width() - pageRight) * sx),
                clampMargin(top * sy), clampMargin((p.height() - bottom) * sy), bodyPt, linePitchPt, blocks);
    }

    static double clampMargin(double pt) { return Math.max(18, Math.min(144, pt)); }

    static boolean isSealText(Text t, List<Stamp> stamps) {
        for (Stamp s : stamps) {
            if (t.box().overlapArea(s.box()) < 0.8 * t.box().area()) continue;
            for (String st : s.texts()) {
                if (st.contains(t.text()) || t.text().contains(st)) return true;
            }
        }
        return false;
    }

    static double medianHeight(List<Text> blocks) {
        if (blocks.isEmpty()) return 20;
        double[] hs = blocks.stream().mapToDouble(b -> b.box().h()).sorted().toArray();
        return Math.max(1, hs[hs.length / 2]);
    }

    /** x of a column gutter, or null for a single-column page. */
    static Double gutter(List<Text> blocks, double width, double lh) {
        Double best = null;
        int bestCover = Integer.MAX_VALUE, bestBalance = -1;
        for (double x = width * 0.35; x <= width * 0.65; x += Math.max(1, width / 400)) {
            int cover = 0, left = 0, right = 0;
            for (Text b : blocks) {
                if (b.box().x0 < x && x < b.box().x1) cover++;
                else if (b.box().x1 <= x) left++;
                else right++;
            }
            int balance = Math.min(left, right);
            if (cover < bestCover || (cover == bestCover && balance > bestBalance)) {
                bestCover = cover; bestBalance = balance; best = x;
            }
        }
        if (best == null) return null;
        double g = best;
        int pairs = 0;
        for (Text l : blocks) {
            if (l.box().x1 > g) continue;
            for (Text r : blocks) {
                if (r.box().x0 < g) continue;
                if (l.box().vOverlaps(r.box().y0, r.box().y1)) { pairs++; break; }
            }
        }
        return pairs >= 3 ? g : null;
    }

    static int side(Box b, Double gutter) {
        if (gutter == null) return 0;
        if (b.x1 <= gutter) return -1;
        if (b.x0 >= gutter) return 1;
        return 0;
    }

    static List<Row> rows(List<Text> blocks, Double gutter, double lh) {
        List<Text> sorted = new ArrayList<>(blocks);
        sorted.sort(Comparator.comparingDouble(t -> (t.box().y0 + t.box().y1) / 2));
        List<Row> rows = new ArrayList<>();
        for (Text t : sorted) {
            int side = side(t.box(), gutter);
            Row target = null;
            for (int i = rows.size() - 1; i >= 0 && i >= rows.size() - 4; i--) {
                Row r = rows.get(i);
                if (gutter != null && r.side != side) continue;
                double overlap = Math.min(r.box.y1, t.box().y1) - Math.max(r.box.y0, t.box().y0);
                if (overlap >= 0.5 * Math.min(r.box.h(), t.box().h())) { target = r; break; }
            }
            if (target == null) {
                target = new Row();
                target.side = side;
                rows.add(target);
            }
            target.parts.add(t);
            target.box = union(target.parts.stream().map(Text::box).toList());
            if (gutter != null) target.side = side(target.box, gutter);
        }
        return rows;
    }

    /** Reading order: bands cut by spanning rows, tables and isolated one-sided rows. */
    static List<Row> order(List<Row> rows, Double gutter, double lh, double pageLeft, double pageRight) {
        List<Row> out = new ArrayList<>();
        if (gutter == null) {
            for (Row r : rows) { r.colLeft = pageLeft; r.colRight = pageRight; out.add(r); }
            return out;
        }
        List<Row> band = new ArrayList<>();
        for (Row r : rows) {
            boolean breaker = r.table != null || r.side == 0 || isolated(r, rows, band, lh);
            if (breaker) {
                flushBand(band, out);
                r.colLeft = pageLeft; r.colRight = pageRight;
                out.add(r);
            } else {
                band.add(r);
            }
        }
        flushBand(band, out);
        return out;
    }

    /** A one-sided row with nothing beside it and a paragraph gap above it (a section heading). */
    static boolean isolated(Row r, List<Row> all, List<Row> band, double lh) {
        for (Row o : all) {
            if (o == r || o.table != null || o.side == 0 || o.side == r.side) continue;
            if (o.box.vOverlaps(r.box.y0 - 0.5 * lh, r.box.y1 + 0.5 * lh)) return false;
        }
        Row above = null;
        for (Row b : band) if (b.side == r.side) above = b;
        return above == null || r.box.y0 - above.box.y1 >= 0.8 * lh;
    }

    static void flushBand(List<Row> band, List<Row> out) {
        for (int side : new int[]{-1, 1}) {
            List<Row> col = band.stream().filter(r -> r.side == side).toList();
            if (col.isEmpty()) continue;
            double left = col.stream().mapToDouble(r -> r.box.x0).min().orElse(0);
            double right = col.stream().mapToDouble(r -> r.box.x1).max().orElse(0);
            for (Row r : col) { r.colLeft = left; r.colRight = right; out.add(r); }
        }
        band.clear();
    }

    static Align align(Row r, double lh) {
        double width = r.colRight - r.colLeft;
        double left = r.box.x0 - r.colLeft, right = r.colRight - r.box.x1;
        if (left > 2 * lh && Math.abs(r.box.cx() - (r.colLeft + r.colRight) / 2) < 1.5 * lh) return Align.CENTER;
        if (left > 0.4 * width && right < left) return Align.RIGHT;
        return Align.LEFT;
    }

    static List<Block> paragraphs(List<Row> ordered, double lh, double sx, double pageLeft, double pageRight,
                                  Map<Block, Box> paraBoxes, List<Double> pitches) {
        List<Block> out = new ArrayList<>();
        List<Box> rowsOfPara = new ArrayList<>();
        StringBuilder text = null;
        Row first = null, prev = null;
        Align align = Align.LEFT;
        int lines = 0;
        boolean gapAbove = true;
        List<Object[]> pending = new ArrayList<>(); // [Para builder state] finished paragraphs needing heading check

        for (Row r : ordered) {
            if (r.table != null) {
                closePara(out, text, first, prev, align, lines, gapAbove, true, lh);
                record(out, paraBoxes, rowsOfPara);
                text = null; prev = null;
                out.add(table(r.table, sx));
                gapAbove = true;
                continue;
            }
            String rowText = r.text(lh);
            Align a = align(r, lh);
            boolean indent = r.box.x0 - r.colLeft > 1.2 * lh && a == Align.LEFT;
            boolean title = r.box.h() >= 1.4 * lh;
            boolean sameColumn = prev != null && prev.colLeft == r.colLeft && prev.colRight == r.colRight;
            double gap = prev == null ? Double.MAX_VALUE : r.box.y0 - prev.box.y1;
            boolean newPara = prev == null || title || prev.box.h() >= 1.4 * lh
                    || a != Align.LEFT || align != Align.LEFT || indent
                    || prev.box.x1 < prev.colRight - 1.5 * lh
                    || (sameColumn && gap > 0.8 * lh);
            if (newPara) {
                boolean gapBelowPrev = prev == null || !sameColumn || gap > 0.8 * lh || indent;
                closePara(out, text, first, prev, align, lines, gapAbove, gapBelowPrev, lh);
                record(out, paraBoxes, rowsOfPara);
                gapAbove = prev == null || !sameColumn || gap > 0.8 * lh;
                text = new StringBuilder(rowText);
                first = r; align = a; lines = 1;
            } else {
                appendLine(text, rowText);
                lines++;
                if (sameColumn) pitches.add(r.box.y0 - prev.box.y0);
            }
            rowsOfPara.add(r.box);
            prev = r;
        }
        closePara(out, text, first, prev, align, lines, gapAbove, true, lh);
        record(out, paraBoxes, rowsOfPara);
        return out;
    }

    /** Remembers where the paragraph just closed sat on the page (for anchoring seals). */
    static void record(List<Block> out, Map<Block, Box> paraBoxes, List<Box> rowsOfPara) {
        if (!rowsOfPara.isEmpty() && !out.isEmpty() && out.get(out.size() - 1) instanceof Para para
                && !paraBoxes.containsKey(para)) {
            paraBoxes.put(para, union(rowsOfPara));
        }
        rowsOfPara.clear();
    }

    static void appendLine(StringBuilder sb, String next) {
        if (sb.length() > 0 && !next.isEmpty()
                && isAsciiWord(sb.charAt(sb.length() - 1)) && isAsciiWord(next.charAt(0))) sb.append(' ');
        sb.append(next);
    }

    static boolean isAsciiWord(char c) { return c < 128 && Character.isLetterOrDigit(c); }

    static void closePara(List<Block> out, StringBuilder text, Row first, Row last, Align align, int lines,
                          boolean gapAbove, boolean gapBelow, double lh) {
        if (text == null || first == null) return;
        Kind kind = Kind.BODY;
        boolean indent = first.box.x0 - first.colLeft > 1.2 * lh && align == Align.LEFT;
        if (first.box.h() >= 1.4 * lh) kind = Kind.TITLE;
        else if (lines == 1 && align == Align.LEFT && !indent && gapAbove && gapBelow
                && first.box.x1 < first.colRight - 0.3 * (first.colRight - first.colLeft)) kind = Kind.HEADING;
        out.add(new Para(text.toString(), kind, align, indent));
    }

    static OcrLayout.Table table(TableSrc t, double sx) {
        double[] lefts = new double[t.cols() + 1];
        Arrays.fill(lefts, Double.NaN);
        for (CellSrc c : t.cells()) {
            if (c.box() == null) continue;
            if (Double.isNaN(lefts[c.c0()]) || c.box().x0 < lefts[c.c0()]) lefts[c.c0()] = c.box().x0;
            if (Double.isNaN(lefts[c.c1() + 1]) || c.box().x1 > lefts[c.c1() + 1]) lefts[c.c1() + 1] = c.box().x1;
        }
        lefts[0] = Double.isNaN(lefts[0]) ? t.box().x0 : lefts[0];
        lefts[t.cols()] = Double.isNaN(lefts[t.cols()]) ? t.box().x1 : lefts[t.cols()];
        double[] widths = new double[t.cols()];
        double fallback = t.box().w() / Math.max(1, t.cols()) * sx;
        for (int i = 0; i < t.cols(); i++) {
            int j = i + 1;
            while (j < t.cols() && Double.isNaN(lefts[j])) j++;
            double w = Double.isNaN(lefts[i]) ? Double.NaN : (lefts[j] - lefts[i]) / (j - i) * sx;
            widths[i] = Double.isNaN(w) || w <= 0 ? fallback : w;
        }
        List<OcrLayout.Cell> cells = t.cells().stream()
                .map(c -> new OcrLayout.Cell(c.r0(), c.r1(), c.c0(), c.c1(), c.text())).toList();
        return new OcrLayout.Table(t.rows(), t.cols(), cells, widths);
    }

    /**
     * Keeps only the seal's red ink (everything else transparent): the printed lines under the seal
     * are already rebuilt as text, and leaving their pixels in the picture would print them twice.
     * Returns null when the region has almost no red (e.g. a blue or black stamp), so the caller
     * keeps the plain crop instead of an empty picture.
     */
    static BufferedImage redInk(BufferedImage region) {
        int w = region.getWidth(), h = region.getHeight(), red = 0;
        BufferedImage out = new BufferedImage(w, h, BufferedImage.TYPE_INT_ARGB);
        for (int yy = 0; yy < h; yy++) {
            for (int xx = 0; xx < w; xx++) {
                int rgb = region.getRGB(xx, yy);
                int r = (rgb >> 16) & 0xff, g = (rgb >> 8) & 0xff, b = rgb & 0xff;
                if (r > 120 && r - Math.max(g, b) > 50) {
                    out.setRGB(xx, yy, 0xff000000 | (rgb & 0xffffff));
                    red++;
                }
            }
        }
        return red >= Math.max(1, w * h / 200) ? out : null;
    }

    static byte[] crop(BufferedImage image, Box b, double frameW, double frameH) {
        double kx = image.getWidth() / frameW, ky = image.getHeight() / frameH;
        int x = (int) Math.max(0, Math.floor(b.x0 * kx)), y = (int) Math.max(0, Math.floor(b.y0 * ky));
        int w = (int) Math.min(image.getWidth() - x, Math.ceil(b.w() * kx));
        int h = (int) Math.min(image.getHeight() - y, Math.ceil(b.h() * ky));
        if (w <= 0 || h <= 0) return null;
        BufferedImage region = image.getSubimage(x, y, w, h);
        BufferedImage ink = redInk(region);
        try (ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            ImageIO.write(ink != null ? ink : region, "png", out);
            return out.toByteArray();
        } catch (Exception e) {
            return null;
        }
    }
}
