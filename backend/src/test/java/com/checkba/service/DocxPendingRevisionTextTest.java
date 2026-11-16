// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service;

import org.junit.jupiter.api.Test;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** docx 待处理修订的文本口径：最终文本 + ⟦原/删/增⟧ 标记（gap-analysis R1）。 */
class DocxPendingRevisionTextTest {

    private final DocumentTextService service = new DocumentTextService(null);

    private static final String HEAD = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>"
            + "<w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"><w:body>";
    private static final String TAIL = "</w:body></w:document>";

    private static String run(String t) {
        return "<w:r><w:t xml:space=\"preserve\">" + t + "</w:t></w:r>";
    }

    private static String del(String t) {
        return "<w:del w:id=\"1\" w:author=\"a\"><w:r><w:delText xml:space=\"preserve\">" + t + "</w:delText></w:r></w:del>";
    }

    private static String ins(String t) {
        return "<w:ins w:id=\"2\" w:author=\"a\">" + run(t) + "</w:ins>";
    }

    /** 最小可被 Tika 识别的 docx。 */
    private static byte[] docx(String bodyXml) throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        try (ZipOutputStream z = new ZipOutputStream(out)) {
            put(z, "[Content_Types].xml", "<?xml version=\"1.0\" encoding=\"UTF-8\"?>"
                    + "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">"
                    + "<Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>"
                    + "<Default Extension=\"xml\" ContentType=\"application/xml\"/>"
                    + "<Override PartName=\"/word/document.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml\"/>"
                    + "</Types>");
            put(z, "_rels/.rels", "<?xml version=\"1.0\" encoding=\"UTF-8\"?>"
                    + "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">"
                    + "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"word/document.xml\"/>"
                    + "</Relationships>");
            put(z, "word/document.xml", HEAD + bodyXml + TAIL);
        }
        return out.toByteArray();
    }

    private static void put(ZipOutputStream z, String name, String content) throws Exception {
        z.putNextEntry(new ZipEntry(name));
        z.write(content.getBytes(StandardCharsets.UTF_8));
        z.closeEntry();
    }

    private String text(String bodyXml) throws Exception {
        return service.parse(new ByteArrayInputStream(docx(bodyXml))).trim();
    }

    @Test
    void replacementShowsInsertedTextThenOriginal() throws Exception {
        assertEquals("收到货物后 15⟦原:7⟧ 日内验收",
                text("<w:p>" + run("收到货物后 ") + del("7") + ins("15") + run(" 日内验收") + "</w:p>"));
    }

    @Test
    void insertionBeforeDeletionIsStillOneReplacement() throws Exception {
        assertEquals("付款期限 45⟦原:30⟧ 日",
                text("<w:p>" + run("付款期限 ") + ins("45") + del("30") + run(" 日") + "</w:p>"));
    }

    @Test
    void pureDeletionAndPureInsertion() throws Exception {
        assertEquals("甲方⟦删:不⟧承担⟦增:全部⟧责任",
                text("<w:p>" + run("甲方") + del("不") + run("承担") + ins("全部") + run("责任") + "</w:p>"));
    }

    @Test
    void paragraphMarkRevisionsAndPlainBracketsAreNotTouched() throws Exception {
        // rPr 里的 w:ins/w:del 是段落标记修订，不是文字；〔2020〕是文号，不是标记
        String body = "<w:p><w:pPr><w:rPr><w:ins w:id=\"9\" w:author=\"a\"/></w:rPr></w:pPr>"
                + run("京政发〔2020〕12号") + "</w:p>";
        assertEquals("京政发〔2020〕12号", text(body));
    }

    @Test
    void documentWithoutRevisionsIsReturnedUnchanged() throws Exception {
        byte[] plain = docx("<w:p>" + run("没有修订") + "</w:p>");
        assertSame(plain, DocxPendingRevisionText.render(plain));
        byte[] notZip = "plain text".getBytes(StandardCharsets.UTF_8);
        assertSame(notZip, DocxPendingRevisionText.render(notZip));
    }

    @Test
    void stripMarkersGivesAcceptedText() {
        assertEquals("收到货物后 15 日内验收，甲方承担全部责任",
                DocxPendingRevisionText.stripMarkers("收到货物后 15⟦原:7⟧ 日内验收，甲方⟦删:不⟧承担⟦增:全部⟧责任"));
        assertEquals("京政发〔2020〕12号", DocxPendingRevisionText.stripMarkers("京政发〔2020〕12号"));
        assertEquals(null, DocxPendingRevisionText.stripMarkers(null));
    }

    @Test
    void malformedZipFallsBackToOriginalBytes() {
        byte[] broken = "PK\u0003\u0004garbage".getBytes(StandardCharsets.ISO_8859_1);
        assertTrue(DocxPendingRevisionText.render(broken) == broken);
    }
}
