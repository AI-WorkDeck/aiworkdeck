// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.ocr;

import com.checkba.service.ocr.OcrLayout.Align;
import com.checkba.service.ocr.OcrLayout.Kind;
import com.checkba.service.ocr.OcrLayout.Para;
import com.checkba.service.ocr.OcrLayout.Picture;
import com.checkba.service.ocr.OcrLayout.Table;
import org.junit.jupiter.api.Test;

import java.awt.image.BufferedImage;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.stream.Collectors;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Fixtures are real RecognizeAllText responses (layout on, 150 DPI render of a fictional two-page
 * scan, captured 2026-11-05): page 1 has a title, a table with a merged "合计" cell and a red seal
 * over the signature block; page 2 is two-column text.
 */
class AliyunLayoutReaderTest {

    static String raw(int page) throws Exception {
        try (var in = AliyunLayoutReaderTest.class.getResourceAsStream("/ocr/aliyun-layout-page" + page + ".json")) {
            return new String(in.readAllBytes(), StandardCharsets.UTF_8);
        }
    }

    /** A4 at 150 DPI is 1240x1754 px = 595x842 pt. */
    static OcrLayout.Page read(int page, BufferedImage image) throws Exception {
        return AliyunLayoutReader.read(raw(page), 595.3, 841.9, image);
    }

    static List<Para> paras(OcrLayout.Page page) {
        return page.blocks().stream().filter(b -> b instanceof Para).map(b -> (Para) b).collect(Collectors.toList());
    }

    @Test
    void twoColumnPageReadsLeftColumnThenRightColumnWithinEachSection() throws Exception {
        List<Para> p = paras(read(2, null));
        List<String> texts = p.stream().map(Para::text).toList();
        assertEquals("第三条　陈述与保证", texts.get(0));
        assertEquals(Kind.HEADING, p.get(0).kind());
        assertEquals("3.1甲方保证其合法持有标的股权，该股权之上不存在质押、查封、冻结或其他权利限制，亦不存在任何权属争议。", texts.get(1));
        assertTrue(p.get(1).firstLineIndent());
        assertTrue(texts.get(2).startsWith("3.2") && texts.get(2).endsWith("完整。"), texts.get(2));
        // the paragraph that flows from the bottom of the left column to the top of the right one
        assertEquals("3.3乙方保证其具有签署和履行本协议的完全民事行为能力，用于支付转让价款的资金来源合法。", texts.get(3));
        assertTrue(texts.get(4).startsWith("3.4") && texts.get(4).endsWith("差旅费。"), texts.get(4));
        assertTrue(texts.get(5).startsWith("3.5") && texts.get(5).endsWith("附件二。"), texts.get(5));
        assertTrue(texts.get(6).startsWith("3.6"), texts.get(6));
        assertEquals("第四条　违约责任与争议解决", texts.get(7));
        assertEquals(Kind.HEADING, p.get(7).kind());
        assertTrue(texts.get(8).startsWith("4.1") && texts.get(8).endsWith("解除本协议。"), texts.get(8));
        assertTrue(texts.get(9).startsWith("4.2"), texts.get(9));
        assertTrue(texts.get(10).startsWith("4.3") && texts.get(10).endsWith("提起诉讼。"), texts.get(10));
        assertTrue(texts.get(11).startsWith("4.4"), texts.get(11));
        assertEquals("乙方(签字)：", texts.get(12));
        assertEquals(Align.RIGHT, p.get(12).align());
        assertEquals("第2页共2页", texts.get(texts.size() - 1));
        assertEquals(Align.CENTER, p.get(texts.size() - 1).align());
    }

    @Test
    void firstPageKeepsTitleTableAndDropsSealTextFromBody() throws Exception {
        OcrLayout.Page page = read(1, new BufferedImage(1240, 1754, BufferedImage.TYPE_INT_RGB));
        List<Para> p = paras(page);
        assertEquals("股权转让协议", p.get(0).text());
        assertEquals(Kind.TITLE, p.get(0).kind());
        assertEquals(Align.CENTER, p.get(0).align());
        assertEquals("协议编号：XQ-2026-0815　签署地：江州市临川区", p.get(1).text());
        assertEquals(Align.CENTER, p.get(1).align());
        assertTrue(p.get(2).text().startsWith("转让方(甲方)") && p.get(2).text().endsWith("望湖路88号。"), p.get(2).text());
        assertTrue(p.stream().anyMatch(x -> x.text().equals("第一条　转让标的与价款") && x.kind() == Kind.HEADING));

        Table table = page.blocks().stream().filter(b -> b instanceof Table).map(b -> (Table) b).findFirst().orElseThrow();
        assertEquals(5, table.rows());
        assertEquals(4, table.cols());
        OcrLayout.Cell total = table.cells().stream().filter(c -> c.text().equals("合计")).findFirst().orElseThrow();
        assertEquals(0, total.c0());
        assertEquals(1, total.c1());
        assertEquals(4, table.colWidths().length);
        // the table sits between the payment paragraph and 第二条, not at the end
        int tableAt = page.blocks().indexOf(table);
        assertTrue(page.blocks().get(tableAt - 1) instanceof Para prev && prev.text().endsWith("按下表分期支付。"));
        // table cell text is not repeated as body paragraphs
        assertTrue(p.stream().noneMatch(x -> x.text().equals("期次")));

        // seal: its own text is not body text, the signature line under it is
        assertTrue(p.stream().noneMatch(x -> x.text().equals("江州青禾投资管理有限公")));
        assertTrue(p.stream().noneMatch(x -> x.text().equals("合同专用章")));
        assertTrue(p.stream().anyMatch(x -> x.text().startsWith("甲方(盖章)")));
        Picture seal = page.blocks().stream().filter(b -> b instanceof Picture).map(b -> (Picture) b).findFirst().orElseThrow();
        assertNotNull(seal.xPt(), "seal floats at its horizontal page position");
        assertEquals(715 * 595.3 / 1240, seal.xPt(), 1.0);
        assertEquals((1474 - 1177) * 841.9 / 1754, seal.heightPt(), 1.0);
        // anchored to the signature paragraph it covers, so it follows that text when the page reflows
        int sealAt = page.blocks().indexOf(seal);
        assertTrue(page.blocks().get(sealAt + 1) instanceof Para next && next.text().startsWith("甲方(盖章)"),
                "seal sits right before the paragraph it is anchored to");
        assertEquals((1177 - 1286) * 841.9 / 1754, seal.yPt(), 1.0, "vertical offset from that paragraph's top");

        // body size and line pitch measured from the scan so a page stays one page
        assertEquals(10.5, page.bodyPt(), 1.0);
        assertEquals(37 * 841.9 / 1754, page.linePitchPt(), 2.0);
    }

    @Test
    void withoutAPageImageTheSealIsSimplyNotDrawn() throws Exception {
        OcrLayout.Page page = read(1, null);
        assertTrue(page.blocks().stream().noneMatch(b -> b instanceof Picture));
    }

    @Test
    void searchLinesCoverEveryRecognizedBlockInPixelFrame() throws Exception {
        SearchablePdfWriter.PageText text = AliyunLayoutReader.searchLines(raw(1));
        assertEquals(1240, text.frameWidth());
        assertEquals(1754, text.frameHeight());
        assertEquals(42, text.lines().size(), "tables and seal text stay searchable");
        SearchablePdfWriter.Line title = text.lines().get(0);
        assertEquals("股权转让协议", title.text());
        assertEquals(456, title.x0(), 0.1);
        assertEquals(148, title.y0(), 0.1);
        assertEquals(775, title.x1(), 0.1);
        assertEquals(197, title.y1(), 0.1);
    }

    @Test
    void rawWithoutCoordinatesIsReportedNotGuessed() {
        String noCoords = "{\"width\":100,\"height\":100,\"subImages\":[{\"blockInfo\":{\"blockDetails\":[{\"blockContent\":\"x\"}]}}]}";
        assertThrows(AliyunLayoutReader.MissingLayoutException.class, () -> AliyunLayoutReader.searchLines(noCoords));
        assertThrows(AliyunLayoutReader.MissingLayoutException.class, () -> AliyunLayoutReader.read(noCoords, 595, 842, null));
    }

    @Test
    void sealCropKeepsOnlyTheRedInkSoPrintedTextUnderItIsNotDuplicated() throws Exception {
        BufferedImage page = new BufferedImage(100, 100, BufferedImage.TYPE_INT_RGB);
        var g = page.createGraphics();
        g.setColor(new java.awt.Color(246, 244, 238)); g.fillRect(0, 0, 100, 100);   // paper
        g.setColor(new java.awt.Color(20, 20, 20)); g.fillRect(10, 45, 80, 10);       // printed text under the seal
        g.setColor(new java.awt.Color(215, 30, 30)); g.drawOval(5, 5, 90, 90);        // seal ring
        g.dispose();
        byte[] png = AliyunLayoutReader.crop(page, new AliyunLayoutReader.Box(0, 0, 100, 100), 100, 100);
        BufferedImage seal = javax.imageio.ImageIO.read(new java.io.ByteArrayInputStream(png));
        assertTrue(seal.getColorModel().hasAlpha());
        assertEquals(0, seal.getRGB(50, 50) >>> 24, "printed text is transparent");
        assertEquals(0, seal.getRGB(30, 30) >>> 24, "paper is transparent");
        assertEquals(255, seal.getRGB(50, 5) >>> 24, "red ink stays opaque");
    }

    @Test
    void nonRedStampIsKeptAsIs() throws Exception {
        BufferedImage page = new BufferedImage(50, 50, BufferedImage.TYPE_INT_RGB);
        var g = page.createGraphics();
        g.setColor(java.awt.Color.WHITE); g.fillRect(0, 0, 50, 50);
        g.setColor(java.awt.Color.BLUE); g.drawOval(2, 2, 46, 46);
        g.dispose();
        BufferedImage seal = javax.imageio.ImageIO.read(new java.io.ByteArrayInputStream(
                AliyunLayoutReader.crop(page, new AliyunLayoutReader.Box(0, 0, 50, 50), 50, 50)));
        assertEquals(255, seal.getRGB(25, 25) >>> 24, "no red ink found: crop is not hollowed out");
    }
}
