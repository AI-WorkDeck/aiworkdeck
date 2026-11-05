// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.ocr;

import com.checkba.service.ocr.OcrLayout.*;
import org.docx4j.TextUtils;
import org.docx4j.XmlUtils;
import org.docx4j.openpackaging.packages.WordprocessingMLPackage;
import org.junit.jupiter.api.Test;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class LayoutDocxWriterTest {

    static byte[] png() throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        ImageIO.write(new BufferedImage(40, 40, BufferedImage.TYPE_INT_RGB), "png", out);
        return out.toByteArray();
    }

    static Page page(List<Block> blocks) {
        return new Page(595.3, 841.9, 60, 50, 70, 80, blocks);
    }

    static String xml(byte[] docx) throws Exception {
        var pkg = WordprocessingMLPackage.load(new ByteArrayInputStream(docx));
        return XmlUtils.marshaltoString(pkg.getMainDocumentPart().getJaxbElement(), true, false);
    }

    @Test
    void writesStructureInReadingOrderWithAlignmentAndIndent() throws Exception {
        byte[] docx = LayoutDocxWriter.write(List.of(page(List.of(
                new Para("股权转让协议", Kind.TITLE, Align.CENTER, false),
                new Para("第一条　转让标的与价款", Kind.HEADING, Align.LEFT, false),
                new Para("甲方同意将其持有的目标公司35%股权转让给乙方。", Kind.BODY, Align.LEFT, true),
                new Para("日期：2026年8月15日", Kind.BODY, Align.RIGHT, false)))));
        var pkg = WordprocessingMLPackage.load(new ByteArrayInputStream(docx));
        String text = TextUtils.getText(pkg.getMainDocumentPart().getJaxbElement());
        assertTrue(text.indexOf("股权转让协议") < text.indexOf("第一条") && text.indexOf("第一条") < text.indexOf("甲方同意"));
        String x = xml(docx);
        assertTrue(x.contains("w:val=\"center\""), "title centered");
        assertTrue(x.contains("w:val=\"right\""), "date right aligned");
        assertTrue(x.contains("w:firstLineChars=\"200\""), "body first-line indent of two characters");
        assertTrue(x.contains("w:val=\"Heading2\""), "section heading uses a heading style (navigation pane)");
        assertTrue(x.contains("w:val=\"Title\""));
    }

    @Test
    void tableKeepsMergedCellsAndColumnWidths() throws Exception {
        var table = new Table(3, 3, List.of(
                new Cell(0, 0, 0, 0, "期次"), new Cell(0, 0, 1, 1, "金额"), new Cell(0, 1, 2, 2, "备注"),
                new Cell(1, 1, 0, 0, "第一期"), new Cell(1, 1, 1, 1, "1,260,000"),
                new Cell(2, 2, 0, 1, "合计"), new Cell(2, 2, 2, 2, "")),
                new double[]{60, 200, 100});
        String x = xml(LayoutDocxWriter.write(List.of(page(List.of(table)))));
        assertTrue(x.contains("<w:gridSpan w:val=\"2\"/>"), "合计 spans two columns");
        assertTrue(x.contains("<w:vMerge w:val=\"restart\"/>"), "备注 starts a vertical merge");
        assertTrue(x.contains("<w:vMerge/>"), "and continues it in the next row");
        assertTrue(x.contains("w:w=\"1200\""), "60pt column = 1200 twips");
        assertEquals(3, x.split("<w:tr[ >]", -1).length - 1, "three rows");
        assertTrue(x.contains("1,260,000"));
    }

    @Test
    void floatingPictureIsAnchoredToThePageBehindText() throws Exception {
        String x = xml(LayoutDocxWriter.write(List.of(page(List.of(
                new Para("甲方（盖章）", Kind.BODY, Align.RIGHT, false),
                new Picture(png(), 140, 140, 340.0, 560.0))))));
        assertTrue(x.contains("<wp:anchor"), "seal floats");
        assertTrue(x.matches("(?s).*behindDoc=\"(1|true)\".*"), "behind the signature text");
        assertTrue(x.contains("relativeFrom=\"page\""));
        assertTrue(x.contains("<wp:posOffset>" + (340L * 12700) + "</wp:posOffset>"), "x offset in EMU");
        assertTrue(x.contains("cx=\"" + (140L * 12700) + "\""));
    }

    @Test
    void inlinePictureStaysInTheFlow() throws Exception {
        String x = xml(LayoutDocxWriter.write(List.of(page(List.of(new Picture(png(), 100, 50, null, null))))));
        assertTrue(x.contains("<wp:inline"));
        assertFalse(x.contains("<wp:anchor"));
    }

    @Test
    void pagesAreSeparatedAndPageSetupFollowsTheSource() throws Exception {
        String x = xml(LayoutDocxWriter.write(List.of(
                page(List.of(new Para("第一页", Kind.BODY, Align.LEFT, false))),
                page(List.of(new Para("第二页", Kind.BODY, Align.LEFT, false))))));
        assertEquals(1, x.split("w:type=\"page\"", -1).length - 1, "one page break between two pages");
        assertTrue(x.contains("w:w=\"11906\""), "A4 width in twips");
        assertTrue(x.contains("w:left=\"1200\""), "left margin 60pt");
        assertTrue(x.contains("w:top=\"1400\""), "top margin 70pt");
    }

    @Test
    void controlCharactersFromOcrNeverBreakTheDocument() throws Exception {
        byte[] docx = LayoutDocxWriter.write(List.of(page(List.of(new Para("坏\u0002字", Kind.BODY, Align.LEFT, false)))));
        var pkg = WordprocessingMLPackage.load(new ByteArrayInputStream(docx));
        assertTrue(TextUtils.getText(pkg.getMainDocumentPart().getJaxbElement()).contains("坏字"));
    }
}
