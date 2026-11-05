// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ocr;

import java.util.List;

/**
 * Flowing reconstruction of a recognized document, shared by cloud OCR (Aliyun coordinates) and
 * local OCR (MinerU markdown): headings, paragraphs, tables with merged cells and pictures (seals),
 * page by page. Rendered to Word by {@link LayoutDocxWriter}. Not a pixel-exact facsimile — text
 * reflows; tables, reading order, alignment and seal positions are kept.
 */
public final class OcrLayout {

    private OcrLayout() {}

    public enum Kind { TITLE, HEADING, BODY }

    public enum Align { LEFT, CENTER, RIGHT }

    public sealed interface Block permits Para, Table, Picture {}

    public record Para(String text, Kind kind, Align align, boolean firstLineIndent) implements Block {}

    /** Cell spans are inclusive: a cell covering columns 0 and 1 has c0=0, c1=1. */
    public record Cell(int r0, int r1, int c0, int c1, String text) {}

    public record Table(int rows, int cols, List<Cell> cells, double[] colWidths) implements Block {}

    /**
     * @param xPt/yPt position from the page's top-left corner; null means inline in the text flow
     */
    public record Picture(byte[] png, double widthPt, double heightPt, Double xPt, Double yPt) implements Block {}

    /** Margins are measured from the text actually found on the page. */
    public record Page(double widthPt, double heightPt, double marginLeft, double marginRight,
                       double marginTop, double marginBottom, List<Block> blocks) {}
}
