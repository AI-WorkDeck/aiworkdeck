// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ai.review;

import com.checkba.service.ai.review.ParagraphDiff.Change;
import com.checkba.service.ai.review.ParagraphDiff.Kind;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** compare_docx_summary 的段落级差异（tool-system-v2 V7 D1）。 */
class ParagraphDiffTest {

    private static final List<String> V1 = List.of(
            "股权转让协议",
            "第一条 转让标的",
            "甲方将其持有的目标公司 30% 股权转让给乙方。",
            "第二条 转让价款",
            "转让价款为人民币 1000 万元，乙方应于合同签订之日起 10 日内支付。",
            "第三条 违约责任",
            "任何一方违约的，应向守约方支付违约金，违约金为转让价款的 10%。",
            "第四条 争议解决",
            "因本协议引起的争议，提交北京仲裁委员会仲裁。");

    @Test
    @DisplayName("完全相同：没有差异")
    void identical() {
        assertTrue(ParagraphDiff.diff(V1, V1).isEmpty());
    }

    @Test
    @DisplayName("只差空白、全角空格、换行：不算差异")
    void whitespaceOnlyIgnored() {
        List<String> v2 = List.of(
                "股权转让协议 ",
                "第一条　转让标的",
                "甲方将其持有的目标公司30%股权转让给乙方。\n",
                "第二条 转让价款",
                "转让价款为人民币  1000  万元，乙方应于合同签订之日起10日内支付。",
                "",
                "第三条 违约责任",
                "任何一方违约的，应向守约方支付违约金，违约金为转让价款的 10%。",
                "第四条 争议解决",
                "因本协议引起的争议，提交北京仲裁委员会仲裁。");
        assertTrue(ParagraphDiff.diff(V1, v2).isEmpty(), "空白差异被报成了修改");
    }

    @Test
    @DisplayName("修改：同一段改了数字，归到所在的「第X条」")
    void modifyCarriesClause() {
        List<String> v2 = new java.util.ArrayList<>(V1);
        v2.set(6, "任何一方违约的，应向守约方支付违约金，违约金为转让价款的 20%。");
        List<Change> changes = ParagraphDiff.diff(V1, v2);
        assertEquals(1, changes.size());
        Change c = changes.get(0);
        assertEquals(Kind.CHANGED, c.kind());
        assertEquals("第三条", c.clause());
        assertTrue(c.baseText().contains("10%") && c.revisedText().contains("20%"));
        assertEquals(6, c.baseIndex());
        assertEquals(6, c.revisedIndex());
    }

    @Test
    @DisplayName("新增：整条新条款，条款标题与正文各是一处新增，都归到新条款")
    void insertClause() {
        List<String> v2 = new java.util.ArrayList<>(V1);
        v2.add(7, "第四条 保密义务");
        v2.add(8, "双方应对本协议内容及商业信息严格保密。");
        v2.set(9, "第五条 争议解决");
        List<Change> changes = ParagraphDiff.diff(V1, v2);
        long added = changes.stream().filter(c -> c.kind() == Kind.ADDED).count();
        assertEquals(2, added);
        assertTrue(changes.stream().filter(c -> c.kind() == Kind.ADDED).allMatch(c -> "第四条".equals(c.clause())));
        // 原「第四条 争议解决」改成「第五条 争议解决」是一处修改
        Change renumbered = changes.stream().filter(c -> c.kind() == Kind.CHANGED).findFirst().orElseThrow();
        assertEquals("第五条", renumbered.clause());
        assertEquals(3, changes.size());
    }

    @Test
    @DisplayName("删除：删掉整条，标题与正文都是删除，条款取基准稿里的")
    void deleteClause() {
        List<String> v2 = new java.util.ArrayList<>(V1);
        v2.remove(8);
        v2.remove(7);
        List<Change> changes = ParagraphDiff.diff(V1, v2);
        assertEquals(2, changes.size());
        assertTrue(changes.stream().allMatch(c -> c.kind() == Kind.REMOVED && "第四条".equals(c.clause())));
    }

    @Test
    @DisplayName("条款号用中文数字和阿拉伯数字都能识别，空白折掉")
    void clauseNumbering() {
        assertEquals("第十二条", ParagraphDiff.clauseOf("第十二条 保密"));
        assertEquals("第12条", ParagraphDiff.clauseOf("第 12 条　保密"));
        assertEquals("第一百零五條", ParagraphDiff.clauseOf("第一百零五條 其他"));
        assertEquals(null, ParagraphDiff.clauseOf("依据第三条的约定，乙方应当付款。"));
    }

    @Test
    @DisplayName("相似度不够的一删一增不配成修改")
    void unrelatedParagraphsNotPaired() {
        List<Change> changes = ParagraphDiff.diff(
                List.of("第一条 标的", "甲方是北京公司。"),
                List.of("第一条 标的", "本合同适用中华人民共和国法律并按其解释。"));
        assertEquals(2, changes.size());
        assertEquals(Kind.REMOVED, changes.get(0).kind());
        assertEquals(Kind.ADDED, changes.get(1).kind());
    }

    @Test
    @DisplayName("差异按文档顺序输出，多处修改互不串位")
    void orderedMultipleChanges() {
        List<String> v2 = new java.util.ArrayList<>(V1);
        v2.set(2, "甲方将其持有的目标公司 51% 股权转让给乙方。");
        v2.set(4, "转让价款为人民币 1200 万元，乙方应于合同签订之日起 15 日内支付。");
        v2.set(8, "因本协议引起的争议，提交上海国际仲裁中心仲裁。");
        List<Change> changes = ParagraphDiff.diff(V1, v2);
        assertEquals(List.of("第一条", "第二条", "第四条"), changes.stream().map(Change::clause).toList());
        assertTrue(changes.stream().allMatch(c -> c.kind() == Kind.CHANGED));
    }
}
