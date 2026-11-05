// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.ocr;

import com.checkba.service.ocr.OcrLayout.*;
import org.junit.jupiter.api.Test;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/** Fixture: real MinerU 3.4.3 pipeline markdown for the fictional two-page sample scan. */
class MineruLayoutReaderTest {

    static String md() throws Exception {
        try (var in = MineruLayoutReaderTest.class.getResourceAsStream("/ocr/mineru-sample.md")) {
            return new String(in.readAllBytes(), StandardCharsets.UTF_8);
        }
    }

    static String pngB64() throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        ImageIO.write(new BufferedImage(300, 200, BufferedImage.TYPE_INT_RGB), "png", out);
        return Base64.getEncoder().encodeToString(out.toByteArray());
    }

    @Test
    void headingsParagraphsAndMergedTableCellsBecomeLayoutBlocks() throws Exception {
        Page page = MineruLayoutReader.read(md(), Map.of(), 594, 841).get(0);
        List<Block> blocks = page.blocks();
        Para title = (Para) blocks.get(0);
        assertEquals("股权转让协议", title.text());
        assertEquals(Kind.TITLE, title.kind());
        assertEquals(Align.CENTER, title.align());
        assertTrue(blocks.stream().anyMatch(b -> b instanceof Para p && p.kind() == Kind.HEADING
                && p.text().equals("第一条 转让标的与价款")));
        Para body = blocks.stream().filter(b -> b instanceof Para p && p.text().startsWith("甲方同意")).map(b -> (Para) b).findFirst().orElseThrow();
        assertEquals(Kind.BODY, body.kind());
        assertTrue(body.firstLineIndent());

        Table table = blocks.stream().filter(b -> b instanceof Table).map(b -> (Table) b).findFirst().orElseThrow();
        assertEquals(5, table.rows());
        assertEquals(4, table.cols());
        Cell total = table.cells().stream().filter(c -> c.text().equals("合计")).findFirst().orElseThrow();
        assertEquals(0, total.c0());
        assertEquals(1, total.c1());
        assertEquals(594 - 2 * 72, java.util.Arrays.stream(table.colWidths()).sum(), 0.5, "table spans the text width");
        assertTrue(blocks.stream().noneMatch(b -> b instanceof Para p && p.text().contains("<td")), "no raw HTML in text");
    }

    @Test
    void referencedImagesAreEmbeddedAndMissingOnesSkipped() throws Exception {
        String ref = "images/59bd7a7db9090b1b5591e1037e897d65b057563944bc742f1a53dbf53957240b.jpg";
        Page page = MineruLayoutReader.read(md(), Map.of(ref, pngB64()), 594, 841).get(0);
        List<Picture> pics = page.blocks().stream().filter(b -> b instanceof Picture).map(b -> (Picture) b).toList();
        assertEquals(1, pics.size());
        assertNull(pics.get(0).xPt(), "MinerU pictures stay inline in the flow");
        assertTrue(pics.get(0).widthPt() <= 594 - 2 * 72);
        assertEquals(0, MineruLayoutReader.read(md(), Map.of(), 594, 841).get(0).blocks().stream()
                .filter(b -> b instanceof Picture).count());
    }

    @Test
    void markdownEscapesAreUndoneAndUnderscoresKept() throws Exception {
        Page page = MineruLayoutReader.read("乙方（签字）：\\_\\_\\_\n\n# 标题\n", Map.of(), 594, 841).get(0);
        assertEquals("乙方（签字）：___", ((Para) page.blocks().get(0)).text());
    }

    @Test
    void pageLinesMapToSearchableText() {
        var lines = MineruLayoutReader.searchLines(List.of(
                new MineruLayoutReader.PageLines(594, 841, List.of(new SearchablePdfWriter.Line("股权转让协议", 218, 71, 372, 95)))));
        assertEquals(1, lines.size());
        assertEquals(594, lines.get(0).frameWidth());
        assertEquals("股权转让协议", lines.get(0).lines().get(0).text());
    }
}
