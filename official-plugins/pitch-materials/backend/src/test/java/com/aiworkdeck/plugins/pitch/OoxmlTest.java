// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.aiworkdeck.plugins.pitch;

import static org.junit.jupiter.api.Assertions.*;

import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class OoxmlTest {
    static final String NS = "xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"";

    static byte[] docx(String body) throws Exception {
        Map<String, byte[]> parts = new LinkedHashMap<>();
        parts.put("[Content_Types].xml", "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"/>".getBytes(StandardCharsets.UTF_8));
        parts.put("word/document.xml", ("<w:document " + NS + "><w:body>" + body + "</w:body></w:document>").getBytes(StandardCharsets.UTF_8));
        return Ooxml.writeZip(parts);
    }

    static String p(String text) { return "<w:p><w:r><w:t>" + text + "</w:t></w:r></w:p>"; }

    static Ooxml.Data data() {
        return new Ooxml.Data(Map.of("客户名称", "甲公司"), Map.of("业绩", List.of(Map.of("名称", "项目一"), Map.of("名称", "项目二"))));
    }

    @Test
    void paragraphGroupsInsideContentControlsRepeat() throws Exception {
        Ooxml.Result r = Ooxml.fill(docx("<w:sdt><w:sdtContent>" + p("{{业绩.名称}}") + "</w:sdtContent></w:sdt>" + p("{{客户名称}}")), false, data());
        String text = Ooxml.text(r.bytes(), false);
        assertTrue(text.contains("项目一") && text.contains("项目二") && text.contains("甲公司"), text);
        assertTrue(r.unknown().isEmpty());
    }

    @Test
    void listTokensThatCannotBeRepeatedAreReported() throws Exception {
        // 业绩字段混在律师行里：行按「律师」复制，业绩字段留着并报出来
        String row = "<w:tbl><w:tr><w:tc>" + p("{{律师.姓名}} {{业绩.名称}}") + "</w:tc></w:tr></w:tbl>";
        Ooxml.Data d = new Ooxml.Data(Map.of(), Map.of("律师", List.of(Map.of("姓名", "张三")), "业绩", List.of()));
        Ooxml.Result r = Ooxml.fill(docx(row), false, d);
        assertEquals(java.util.Set.of("{{业绩.名称}}"), r.unknown());
    }

    @Test
    void placeholderSplitAcrossRunsIsMerged() throws Exception {
        String split = "<w:p><w:r><w:t>致{{客</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>户名</w:t></w:r><w:r><w:t>称}}：</w:t></w:r></w:p>";
        String text = Ooxml.text(Ooxml.fill(docx(split), false, data()).bytes(), false);
        assertEquals("致甲公司：", text.trim());
    }

    @Test
    void rejectsDoctypeAndBadZips() {
        Map<String, byte[]> parts = new LinkedHashMap<>();
        parts.put("[Content_Types].xml", "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"/>".getBytes(StandardCharsets.UTF_8));
        parts.put("word/document.xml", ("<!DOCTYPE w:document [<!ENTITY e SYSTEM \"file:///etc/hosts\">]><w:document " + NS
                + "><w:body>" + p("&e;") + "</w:body></w:document>").getBytes(StandardCharsets.UTF_8));
        Exception e = assertThrows(Exception.class, () -> Ooxml.fill(Ooxml.writeZip(parts), false, data()));
        assertTrue(String.valueOf(e.getMessage()).contains("DOCTYPE"), String.valueOf(e.getMessage()));
        PitchTools.Failure f = assertThrows(PitchTools.Failure.class, () -> Ooxml.fill("not a zip".getBytes(), false, data()));
        assertEquals("template_invalid", f.code);
    }

    @Test
    void mergedCellsDoNotSkewColumnWidths() throws Exception {
        String a = "xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\"";
        String cell = "<a:tc><a:txBody><a:p><a:r><a:rPr sz=\"1000\"/><a:t>二十个字二十个字二十个字二十个字二十个字</a:t></a:r></a:p></a:txBody></a:tc>";
        String xml = "<a:tbl " + a + "><a:tblGrid><a:gridCol w=\"2000000\"/><a:gridCol w=\"2000000\"/><a:gridCol w=\"2000000\"/></a:tblGrid>"
                + "<a:tr h=\"300000\"><a:tc gridSpan=\"2\"><a:txBody><a:p><a:r><a:rPr sz=\"1000\"/><a:t>合并格</a:t></a:r></a:p></a:txBody></a:tc>"
                + "<a:tc hMerge=\"1\"><a:txBody><a:p/></a:txBody></a:tc>" + cell + "</a:tr></a:tbl>";
        org.w3c.dom.Element tbl = Ooxml.parse(xml.getBytes(StandardCharsets.UTF_8)).getDocumentElement();
        org.w3c.dom.Element tr = Ooxml.list(tbl, Ooxml.A, "tr").get(0);
        // 三格各一行字：所需高度约等于一行 10pt（加上下边距），不会因为错列被算成几百磅
        long need = Ooxml.rowNeed(tbl, tr);
        assertTrue(need < 400000, String.valueOf(need));
    }
}
