// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ai.review;

import com.checkba.service.ai.review.ContractStructureAudit.Numbering;
import com.checkba.service.ai.review.ContractStructureAudit.Paragraph;
import org.junit.jupiter.api.Test;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.UnaryOperator;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 写后核对（gap P5）的三项检查。误报比漏报贵：用仓库里真实的 docx 夹具（合同、补充协议、起诉状、
 * 意见书……）各做一组「正确的多处修改」断言一条都不报，再做「改坏了」断言报出来。
 */
class PostWriteAuditTest {

    private static final List<String> FIXTURES = List.of(
            "../scripts/eval/fixtures/contract.docx",
            "../scripts/eval/fixtures/contract-long.docx",
            "../scripts/eval/fixtures/contract-tracked.docx",
            "../scripts/eval/fixtures/contract-table.docx",
            "../scripts/eval/fixtures/contract-commented.docx",
            "../scripts/eval/fixtures/compare-v1.docx",
            "../scripts/eval/fixtures/compare-v2.docx",
            "../scripts/eval/fixtures/opinion.docx",
            "../scripts/eval/fixtures/penalty-east.docx",
            "../scripts/eval/fixtures/penalty-south.docx",
            "../scripts/eval/fixtures/penalty-north.docx",
            "../scripts/eval/fixtures/plain-notes.docx",
            "../fixtures/evidence-demo-1076/01-购销合同.docx",
            "../fixtures/evidence-demo-1076/02-补充协议.docx",
            "../fixtures/evidence-demo-1076/03-签收单.docx",
            "../fixtures/evidence-demo-1076/04-沟通记录.docx",
            "../fixtures/contracts/zh-en-mixed.docx",
            "../fixtures/contracts/with-revisions.docx",
            "../litviz/skills/mqc-timeline-master/tests/fixtures/m3-complaint.docx",
            "src/test/resources/fixtures/template-sample.docx");

    private static final Pattern TIAO = Pattern.compile("^\\s*第([一二三四五六七八九十]+)条");

    // ------------------------------------------------------------------ 误报：真实夹具上的正确修改

    @Test
    void correctMultiEditsOnRealFixturesRaiseNothing() throws Exception {
        Map<String, List<String>> docs = loadFixtures();
        assertTrue(docs.size() >= 15, "夹具没读到几份: " + docs.keySet());
        int scenarios = 0;
        for (var e : docs.entrySet()) {
            List<String> base = e.getValue();
            for (var s : correctEdits(base).entrySet()) {
                List<String> after = s.getValue().apply(new ArrayList<>(base));
                PostWriteAudit.Result r = PostWriteAudit.check(paras(base), paras(after));
                assertTrue(r.clean(), e.getKey() + " / " + s.getKey() + " 误报: " + r.issues());
                scenarios++;
            }
        }
        assertTrue(scenarios >= 60, "场景太少: " + scenarios);
    }

    /** 每份文档上都做得到的正确修改；有「第X条」时再加插入/删除条款并顺延编号。 */
    private static Map<String, UnaryOperator<List<String>>> correctEdits(List<String> base) {
        Map<String, UnaryOperator<List<String>>> m = new LinkedHashMap<>();
        int mid = Math.max(0, base.size() / 2);
        m.put("no-op", d -> d);
        m.put("change-numbers-in-two-paragraphs", d -> {
            int done = 0;
            for (int i = 0; i < d.size() && done < 2; i++) {
                String t = d.get(i).replaceFirst("(\\d+)", "4$1");
                if (!t.equals(d.get(i))) { d.set(i, t); done++; }
            }
            return d;
        });
        m.put("append-sentence-to-two-paragraphs", d -> {
            // 同一条但书加进两个不同段落（哪怕相邻）是正常起草
            for (int i : new java.util.TreeSet<>(List.of(Math.min(1, d.size() - 1), d.size() - 1))) {
                if (!d.get(i).isBlank()) d.set(i, d.get(i) + "双方另有书面约定的除外。");
            }
            return d;
        });
        m.put("insert-unnumbered-paragraph", d -> {
            d.add(mid, "不可抗力：因不可抗力不能履行合同的，根据不可抗力的影响，部分或者全部免除责任。");
            return d;
        });
        m.put("insert-two-different-paragraphs", d -> {
            d.add(mid, "保密：双方对本合同内容负有保密义务，未经对方同意不得向第三方披露。");
            d.add(Math.min(d.size(), mid + 2), "通知：本合同项下的通知以书面形式送达对方确认的地址。");
            return d;
        });
        m.put("delete-a-body-paragraph", d -> {
            for (int i = d.size() - 1; i > 0; i--) {
                if (!d.get(i).isBlank() && !TIAO.matcher(d.get(i)).find()) { d.remove(i); break; }
            }
            return d;
        });
        m.put("replace-party-name-everywhere", d -> {
            d.replaceAll(t -> t.replace("有限公司", "股份有限公司"));
            return d;
        });
        List<Integer> clauses = new ArrayList<>();
        for (int i = 0; i < base.size(); i++) if (TIAO.matcher(base.get(i)).find()) clauses.add(i);
        if (clauses.size() >= 3) {
            int k = clauses.get(clauses.size() / 2);
            m.put("insert-clause-and-renumber", d -> {
                int n = number(d.get(k));
                renumberFrom(d, k + 1, +1);
                d.add(k + 1, "第" + ChineseNumeralsTestHelper.cn(n + 1) + "条 不可抗力：因不可抗力不能履行合同的，部分或者全部免除责任。");
                return d;
            });
            m.put("delete-clause-and-renumber", d -> {
                d.remove(k);
                renumberFrom(d, k, -1);
                return d;
            });
        }
        return m;
    }

    // ------------------------------------------------------------------ 检出：改坏了

    @Test
    void insertedClauseWithoutRenumberingIsANumberingBreak() throws Exception {
        List<String> base = loadFixtures().get("contract-long.docx");
        List<String> after = new ArrayList<>(base);
        int six = indexOf(after, "第六条");
        after.add(six + 1, "第七条 不可抗力：因不可抗力不能履行合同的，部分或者全部免除责任。");
        PostWriteAudit.Result r = PostWriteAudit.check(paras(base), paras(after));
        assertEquals(1, r.issues().size(), r.issues().toString());
        assertEquals(PostWriteAudit.Kind.NUMBERING, r.issues().get(0).kind());
        assertEquals(six + 2, r.issues().get(0).paragraph());
    }

    @Test
    void inlineInsertThenRenumberLeavesAGap() throws Exception {
        // v02 的病灶：新条款落进第六条那一段，原第七条以后又被顺延成第八条起
        List<String> base = loadFixtures().get("contract-long.docx");
        List<String> after = new ArrayList<>(base);
        int six = indexOf(after, "第六条");
        after.set(six, after.get(six) + "第七条 不可抗力：因不可抗力不能履行合同的，部分或者全部免除责任。");
        renumberFrom(after, six + 1, +1);
        PostWriteAudit.Result r = PostWriteAudit.check(paras(base), paras(after));
        assertTrue(r.issues().stream().anyMatch(i -> i.kind() == PostWriteAudit.Kind.NUMBERING
                && i.paragraph() == six + 1 && i.detail().contains("缺 1 条")), r.issues().toString());
    }

    @Test
    void deletedClauseWithoutRenumberingIsAGap() throws Exception {
        List<String> base = loadFixtures().get("contract-long.docx");
        List<String> after = new ArrayList<>(base);
        after.remove(indexOf(after, "第四条"));
        PostWriteAudit.Result r = PostWriteAudit.check(paras(base), paras(after));
        assertEquals(1, r.issues().size(), r.issues().toString());
        assertEquals(PostWriteAudit.Kind.NUMBERING, r.issues().get(0).kind());
    }

    @Test
    void preExistingNumberingGapIsNotReported() {
        List<String> base = List.of("第一条 标的：设备。", "第二条 付款：30 日内付款。", "第四条 验收：10 日内验收。",
                "第五条 争议：提交仲裁。");
        List<String> after = new ArrayList<>(base);
        after.set(1, "第二条 付款：45 日内付款。");
        after.set(3, "第五条 争议：提交示范仲裁委员会仲裁。");
        assertTrue(PostWriteAudit.check(paras(base), paras(after)).clean());
    }

    @Test
    void emptyParagraphAndLabelOnlyHeadingAreReported() throws Exception {
        List<String> base = loadFixtures().get("contract-long.docx");
        List<String> after = new ArrayList<>(base);
        int six = indexOf(after, "第六条");
        after.add(six + 1, "");
        after.add(six + 2, "第十条");
        PostWriteAudit.Result r = PostWriteAudit.check(paras(base), paras(after));
        assertTrue(r.issues().stream().anyMatch(i -> i.kind() == PostWriteAudit.Kind.EMPTY_PARAGRAPH), r.issues().toString());
        assertTrue(r.issues().stream().anyMatch(i -> i.kind() == PostWriteAudit.Kind.EMPTY_HEADING), r.issues().toString());
    }

    @Test
    void blankSpacerMatchingTheDocumentStyleIsNotReported() {
        List<String> base = List.of("合同", "", "第一条 标的：设备。", "", "第二条 付款：30 日内付款。", "", "第三条 争议：仲裁。");
        List<String> after = new ArrayList<>(base);
        after.add(5, "");
        after.add(6, "不可抗力：因不可抗力不能履行合同的，部分或者全部免除责任。");
        assertTrue(PostWriteAudit.check(paras(base), paras(after)).clean());
    }

    @Test
    void emptyNativeNumberedItemIsReported() {
        Numbering list = new Numbering(true, "8.", "L1", 0, true);
        List<Paragraph> before = List.of(new Paragraph(0, "甲方义务", null), new Paragraph(1, "按时付款。", list));
        List<Paragraph> after = List.of(new Paragraph(0, "甲方义务", null), new Paragraph(1, "按时付款。", list),
                new Paragraph(2, "", new Numbering(true, "9.", "L1", 0, true)));
        PostWriteAudit.Result r = PostWriteAudit.check(before, after);
        assertEquals(PostWriteAudit.Kind.EMPTY_HEADING, r.issues().get(0).kind(), r.issues().toString());
    }

    @Test
    void duplicatedParagraphAndSentenceAreReported() throws Exception {
        List<String> base = loadFixtures().get("contract-long.docx");
        int six = indexOf(base, "第六条");
        List<String> twice = new ArrayList<>(base);
        String clause = "第七条 不可抗力：因不可抗力不能履行合同的，部分或者全部免除责任。";
        twice.add(six + 1, clause);
        twice.add(six + 2, clause);
        renumberFrom(twice, six + 3, +1);
        PostWriteAudit.Result r = PostWriteAudit.check(paras(base), paras(twice));
        assertTrue(r.issues().stream().anyMatch(i -> i.kind() == PostWriteAudit.Kind.DUPLICATE), r.issues().toString());

        List<String> sentence = new ArrayList<>(base);
        int two = indexOf(sentence, "第二条");
        sentence.set(two, sentence.get(two) + "甲方应在收到乙方开具的增值税专用发票后 30 日内支付全部货款。");
        PostWriteAudit.Result r2 = PostWriteAudit.check(paras(base), paras(sentence));
        assertEquals(1, r2.issues().size(), r2.issues().toString());
        assertEquals(PostWriteAudit.Kind.DUPLICATE, r2.issues().get(0).kind());
    }

    @Test
    void repeatedBoilerplateThatWasAlreadyThereIsNotReported() {
        List<String> base = List.of("甲方（盖章）：", "法定代表人或授权代表（签字）：", "乙方（盖章）：", "法定代表人或授权代表（签字）：");
        List<String> after = new ArrayList<>(base);
        after.set(0, "甲方（盖章）：示范精密制造有限公司");
        after.set(2, "乙方（盖章）：样例智能装备股份有限公司");
        assertTrue(PostWriteAudit.check(paras(base), paras(after)).clean());
    }

    // ------------------------------------------------------------------ 夹具

    static Map<String, List<String>> loadFixtures() throws Exception {
        Map<String, List<String>> out = new LinkedHashMap<>();
        for (String f : FIXTURES) {
            Path p = Path.of(f);
            if (!Files.exists(p)) continue;
            out.put(p.getFileName().toString(), docxParagraphs(Files.readAllBytes(p)));
        }
        return out;
    }

    private static final Pattern W_P = Pattern.compile("<w:p[ >][\\s\\S]*?</w:p>|<w:p/>");
    private static final Pattern W_DEL = Pattern.compile("<w:del\\b[^>]*[^/]>[\\s\\S]*?</w:del>");
    private static final Pattern W_T = Pattern.compile("<w:t(?: [^>]*)?>([^<]*)</w:t>");

    /** 与编辑器 get_document_text 同口径的近似：正文段落、删除修订不算、表格段落也按段列出。 */
    static List<String> docxParagraphs(byte[] docx) throws Exception {
        String xml = null;
        try (ZipInputStream z = new ZipInputStream(new java.io.ByteArrayInputStream(docx))) {
            for (ZipEntry e; (e = z.getNextEntry()) != null; ) {
                if ("word/document.xml".equals(e.getName())) xml = new String(readAll(z), StandardCharsets.UTF_8);
            }
        }
        List<String> out = new ArrayList<>();
        Matcher m = W_P.matcher(xml == null ? "" : xml);
        while (m.find()) {
            StringBuilder sb = new StringBuilder();
            Matcher t = W_T.matcher(W_DEL.matcher(m.group()).replaceAll(""));
            while (t.find()) sb.append(t.group(1).replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">"));
            out.add(sb.toString());
        }
        return out;
    }

    private static byte[] readAll(InputStream in) throws Exception {
        ByteArrayOutputStream bo = new ByteArrayOutputStream();
        in.transferTo(bo);
        return bo.toByteArray();
    }

    static List<Paragraph> paras(List<String> texts) {
        List<Paragraph> out = new ArrayList<>();
        for (int i = 0; i < texts.size(); i++) out.add(new Paragraph(i, texts.get(i)));
        return out;
    }

    private static int indexOf(List<String> d, String prefix) {
        for (int i = 0; i < d.size(); i++) if (d.get(i).startsWith(prefix)) return i;
        throw new AssertionError("找不到 " + prefix);
    }

    private static int number(String t) {
        Matcher m = TIAO.matcher(t);
        return m.find() ? ChineseNumerals.parse(m.group(1)) : 0;
    }

    private static final Pattern DOTTED = Pattern.compile("^(\\s*)(\\d{1,2})\\.(\\d{1,2})");

    /** 顺延条款编号，连同条内「8.1」这类子编号的主号一起改（律师顺延编号时两者都要改）。 */
    private static void renumberFrom(List<String> d, int from, int delta) {
        boolean inShifted = false;
        for (int i = from; i < d.size(); i++) {
            Matcher m = TIAO.matcher(d.get(i));
            if (m.find()) {
                int n = ChineseNumerals.parse(m.group(1)) + delta;
                d.set(i, "第" + ChineseNumeralsTestHelper.cn(n) + "条" + d.get(i).substring(m.end()));
                inShifted = true;
                continue;
            }
            Matcher dm = DOTTED.matcher(d.get(i));
            if (inShifted && dm.find()) {
                d.set(i, dm.group(1) + (Integer.parseInt(dm.group(2)) + delta) + "." + dm.group(3) + d.get(i).substring(dm.end()));
            }
        }
    }

    /** 1–99 的中文数字（测试里顺延编号用）。 */
    static final class ChineseNumeralsTestHelper {
        private static final String D = "零一二三四五六七八九";

        static String cn(int n) {
            if (n < 10) return String.valueOf(D.charAt(n));
            int tens = n / 10, ones = n % 10;
            return (tens == 1 ? "" : String.valueOf(D.charAt(tens))) + "十" + (ones == 0 ? "" : String.valueOf(D.charAt(ones)));
        }
    }
}
