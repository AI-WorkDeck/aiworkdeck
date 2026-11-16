// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.version.merge;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

import static org.junit.jupiter.api.Assertions.*;

/**
 * 台账 B13：三方比对要看得见待处理修订。产品里 AI 改稿默认带修订、律师多开着修订改，
 * 合并时三份稿里都有待处理修订是常态。POI 取段落文字是「接受了修订之后」的字，一侧只改了修订
 * 状态（如把 AI 的待处理插入接受了）在文字上看不出差别——不带修订签名就会被当成「没改」，合并时
 * 悄悄丢掉。
 */
class DocxPendingRevisionTest {

    private static final String YI = "w:author=\"乙律师\" w:date=\"2026-11-02T10:00:00Z\"";

    private static String p(String inner) {
        return "<w:p>" + inner + "</w:p>";
    }

    private static String r(String t) {
        return "<w:r><w:t xml:space=\"preserve\">" + t + "</w:t></w:r>";
    }

    private static String ins(int id, String attrs, String t) {
        return "<w:ins w:id=\"" + id + "\" " + attrs + "><w:r><w:t xml:space=\"preserve\">" + t + "</w:t></w:r></w:ins>";
    }

    private static String del(int id, String attrs, String t) {
        return "<w:del w:id=\"" + id + "\" " + attrs + "><w:r><w:delText xml:space=\"preserve\">" + t + "</w:delText></w:r></w:del>";
    }

    static byte[] docx(String... paragraphXml) throws Exception {
        String doc = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"><w:body>"
                + String.join("", paragraphXml) + "</w:body></w:document>";
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        try (ZipOutputStream z = new ZipOutputStream(out)) {
            z.putNextEntry(new ZipEntry("[Content_Types].xml"));
            z.write(("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"><Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/><Default Extension=\"xml\" ContentType=\"application/xml\"/><Override PartName=\"/word/document.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml\"/></Types>").getBytes(StandardCharsets.UTF_8));
            z.putNextEntry(new ZipEntry("_rels/.rels"));
            z.write(("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"word/document.xml\"/></Relationships>").getBytes(StandardCharsets.UTF_8));
            z.putNextEntry(new ZipEntry("word/document.xml"));
            z.write(doc.getBytes(StandardCharsets.UTF_8));
        }
        return out.toByteArray();
    }

    private static byte[] resource(String name) throws Exception {
        try (InputStream in = DocxPendingRevisionTest.class.getResourceAsStream("/merge/b13-rc086/" + name)) {
            return in.readAllBytes();
        }
    }

    @Test
    @DisplayName("没有修订的单元签名为空——普通文档的比对与以前逐字节相同")
    void noRevisionsMeansEmptySignature() throws Exception {
        List<Unit> units = DocxUnitReader.read(docx(p(r("第一条 甲方。")), p(r("第二条 乙方。"))));
        assertTrue(units.stream().allMatch(u -> u.rev().isEmpty()), units.toString());
    }

    @Test
    @DisplayName("一侧把 AI 的待处理插入接受了：文字（POI 取字含待处理插入）不变，但算作这一侧改了这一段")
    void acceptingAPendingInsertionIsAChange() throws Exception {
        String ai = "w:author=\"AI WorkDeck\" w:date=\"2026-11-03T08:00:00Z\"";
        byte[] base = docx(p(r("第一条 ") + ins(1, ai, "本协议所称目标公司指示范科技有限公司") + r("。")), p(r("第二条。")));
        byte[] other = docx(p(r("第一条 本协议所称目标公司指示范科技有限公司。")), p(r("第二条。")));
        List<Unit> b = DocxUnitReader.read(base);
        List<Unit> o = DocxUnitReader.read(other);
        assertEquals(b.get(0).norm(), o.get(0).norm(), "the text alone does not show that the insertion was accepted");
        assertNotEquals(b.get(0).rev(), o.get(0).rev());
        Analysis a = ThreeWayAnalyzer.analyze("合同.docx", base, base, other);
        assertEquals(1, a.plan().otherChunks().size(), a.plan().toString());
        assertEquals(0, a.plan().otherChunks().get(0).baseStart());
        assertTrue(a.plan().mainChunks().isEmpty());
    }

    @Test
    @DisplayName("POI 取段落文字不含删掉的字：待处理删除在文字上就看得出来")
    void pendingDeletionShowsInText() throws Exception {
        byte[] other = docx(p(r("第一条 甲方将其持有的") + del(1, YI, "目标公司 ") + r("30% 股权转让给乙方。")));
        assertEquals("第一条 甲方将其持有的30% 股权转让给乙方。", DocxUnitReader.read(other).get(0).norm());
    }

    @Test
    @DisplayName("同一条修订在 Word 原件里是一个 w:ins、引擎导出拆成几段：签名相同，不造假冲突")
    void splitRunsOfOneRevisionSignAlike() throws Exception {
        String one = p(r("第一条 ") + ins(1, YI, "回归标记0860") + r("。"));
        String split = p(r("第一条 ") + ins(1, YI, "回归") + ins(2, YI, "标记") + ins(3, YI, "0860") + r("。"));
        assertEquals(DocxUnitReader.read(docx(one)).get(0).rev(), DocxUnitReader.read(docx(split)).get(0).rev());
        Analysis a = ThreeWayAnalyzer.analyze("合同.docx", docx(one), docx(split), docx(one));
        assertTrue(a.plan().mainChunks().isEmpty() && a.plan().otherChunks().isEmpty(), a.plan().toString());
    }

    @Test
    @DisplayName("发版前回归原样三份稿（共同的上一版里是 AI 待处理插入的一段，两边各自删成修订再写一句）：只这一段两边都改了")
    void releaseRegressionCase() throws Exception {
        Analysis a = ThreeWayAnalyzer.analyze("合同草稿.docx", resource("base.docx"), resource("main.docx"), resource("other.docx"));
        assertEquals(List.of("p0"), a.overlaps().stream().map(Overlap::key).toList(), a.toString());
        assertEquals(1, a.plan().mainChunks().size());
        assertEquals(1, a.plan().otherChunks().size());
        assertTrue(a.plan().mainChunks().get(0).conflict() && a.plan().otherChunks().get(0).conflict());
        assertEquals(MergeDecision.MANUAL, a.decision());
    }
}
