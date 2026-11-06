// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.ocr;

import com.checkba.service.ocr.OcrLayout.Para;
import com.checkba.service.ocr.OcrLayout.Table;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Aliyun RecognizeAllText turns thousands separators into full-width commas ("4，200，000"). Every
 * route that reads its text (plain lines, layout paragraphs, table cells, searchable-PDF layer) puts
 * them back to "4,200,000"; a full-width comma that is ordinary punctuation stays.
 */
class OcrDigitGroupingTest {

    @Test
    void onlyCommasBetweenDigitGroupsAreNormalized() {
        assertEquals("合计人民币4,200,000元", OcrResult.digitGroups("合计人民币4，200，000元"));
        assertEquals("注册资本人民币 1,000 万元。", OcrResult.digitGroups("注册资本人民币 1，000 万元。"));
        assertEquals("第1，2条", OcrResult.digitGroups("第1，2条"), "not a 3-digit group");
        assertEquals("共12，3456", OcrResult.digitGroups("共12，3456"), "group longer than 3 digits");
        assertEquals("甲方，乙方", OcrResult.digitGroups("甲方，乙方"));
        assertNull(OcrResult.digitGroups(null));
    }

    @Test
    void plainTextLinesUseHalfWidthSeparators() throws Exception {
        String text = OcrResult.lines(AliyunLayoutReaderTest.raw(1), "");
        assertTrue(text.contains("4,200,000"), text);
        assertFalse(text.matches("(?s).*\\d，\\d{3}.*"), text);
    }

    @Test
    void layoutParagraphsAndTableCellsUseHalfWidthSeparators() throws Exception {
        OcrLayout.Page page = AliyunLayoutReaderTest.read(1, null);
        List<Para> paras = AliyunLayoutReaderTest.paras(page);
        assertTrue(paras.stream().anyMatch(p -> p.text().contains("4,200,000")));
        Table table = page.blocks().stream().filter(b -> b instanceof Table).map(b -> (Table) b).findFirst().orElseThrow();
        assertTrue(table.cells().stream().anyMatch(c -> c.text().equals("1,260,000")));
        assertTrue(table.cells().stream().noneMatch(c -> c.text().matches(".*\\d，\\d{3}.*")));
    }

    @Test
    void searchablePdfLayerUsesHalfWidthSeparators() throws Exception {
        var lines = AliyunLayoutReader.searchLines(AliyunLayoutReaderTest.raw(1)).lines();
        assertTrue(lines.stream().anyMatch(l -> l.text().contains("4,200,000")));
    }
}
