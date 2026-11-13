// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.aiworkdeck.plugins.pitch;

import static org.junit.jupiter.api.Assertions.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class PitchToolsTest {
    static final Path FIX = Path.of("..", "tests", "fixtures");
    FakeHost fake;
    PitchTools tools;

    @BeforeEach
    void setUp() throws Exception {
        fake = new FakeHost();
        tools = new PitchTools();
        tools.setHost(fake.host());
        ObjectNode args = PitchTools.JSON.createObjectNode();
        args.set("library", PitchTools.JSON.readTree(Files.readString(FIX.resolve("library-qiheng.json"))));
        assertTrue(call("library.save", args).path("success").asBoolean());
        fake.add("模板/启衡投标书模板.docx", Files.readAllBytes(FIX.resolve("qiheng-bid-template.docx")));
        fake.add("模板/启衡提案模板.pptx", Files.readAllBytes(FIX.resolve("qiheng-proposal-template.pptx")));
        String matrix = "{\"tenderPath\":\"招标文件.docx\",\"items\":["
                + "{\"id\":\"r1\",\"kind\":\"qualification\",\"text\":\"执业满10年\",\"status\":\"met\",\"evidence\":[\"q1\"],\"note\":\"\",\"gap\":\"\"},"
                + "{\"id\":\"r2\",\"kind\":\"qualification\",\"text\":\"通过ISO 9001认证\",\"status\":\"missing\",\"evidence\":[],\"gap\":\"库中无认证证书\"},"
                + "{\"id\":\"r3\",\"kind\":\"scoring\",\"text\":\"类似业绩\",\"score\":\"10\",\"status\":\"partial\",\"evidence\":[\"c1\",\"c2\"],\"note\":\"江岭市城市发展投资集团有限公司 常年顾问\"}]}";
        ObjectNode m = PitchTools.JSON.createObjectNode();
        m.set("matrix", PitchTools.JSON.readTree(matrix));
        assertTrue(call("matrix.save", m).path("success").asBoolean());
    }

    /** PITCH_DUMP=目录 时把生成结果写出来，供 LibreOffice 渲染后逐页目检。 */
    void dump(JsonNode r, String name) throws Exception {
        String dir = System.getenv("PITCH_DUMP");
        if (dir != null) Files.write(Path.of(dir, name), fake.read(r.path("data").path("path").asText()));
    }

    JsonNode call(String action, Object args) throws Exception {
        String json = args instanceof String s ? s : PitchTools.JSON.writeValueAsString(args);
        return PitchTools.JSON.readTree(tools.pitch_materials_action(action, json));
    }

    Map<String, Object> genArgs(String kind, String template, boolean outward) {
        return Map.ofEntries(Map.entry("kind", kind), Map.entry("template", template),
                Map.entry("client", "青川市城市建设投资集团有限公司"), Map.entry("project", "2027—2029年度常年法律顾问服务"),
                Map.entry("credentialIds", List.of("c1", "c2", "c3")), Map.entry("lawyerIds", List.of("l1", "l2")),
                Map.entry("qualificationIds", List.of("q1", "q2", "q3", "q4", "q5")), Map.entry("serviceIds", List.of("s1")),
                Map.entry("quoteId", "p1"), Map.entry("outward", outward), Map.entry("lang", "zh-CN"));
    }

    @Test
    void libraryIsPerUser() throws Exception {
        assertEquals(10, call("library.get", "{}").path("data").path("library").path("credentials").size());
        fake.call = new com.checkba.plugin.api.ToolCall(7L, null, 4L, null);
        assertEquals(0, call("library.get", "{}").path("data").path("library").path("credentials").size());
    }

    @Test
    void rejectsDuplicateIds() throws Exception {
        JsonNode r = call("library.save", "{\"library\":{\"credentials\":[{\"id\":\"a\"},{\"id\":\"a\"}]}}");
        assertEquals("bad_library", r.path("code").asText());
    }

    @Test
    void wordBidFromFirmTemplate() throws Exception {
        JsonNode r = call("generate", genArgs("docx", "模板/启衡投标书模板.docx", true));
        assertTrue(r.path("success").asBoolean(), r.toString());
        dump(r, "firm-bid.docx");
        JsonNode d = r.path("data");
        assertEquals("投标材料/青川市城市建设投资集团有限公司-2027—2029年度常年法律顾问服务-投标书.docx", d.path("path").asText());
        assertEquals(0, d.path("unknownPlaceholders").size());
        assertEquals(0, d.path("leaks").size(), d.toString());
        String text = Ooxml.text(fake.read(d.path("path").asText()), false);
        assertFalse(text.contains("{{"), text);
        // 被拆成两个 run 的 {{客户名称}} 与 {{业绩.名称}} 也填上了
        assertTrue(text.contains("青川市城市建设投资集团有限公司"));
        assertTrue(text.contains("某市属城市发展平台公司"));
        assertFalse(text.contains("江岭市城市发展投资集团有限公司"));
        assertTrue(text.contains("人民币叁拾柒万零捌佰元整"));
        assertTrue(text.contains("沈知远") && text.contains("林婉清"));
        assertTrue(text.contains("缺材料") && text.contains("库中无认证证书"));
        assertTrue(text.contains("某省属能源化工国有企业"));
        assertFalse(text.contains("北辰市交通运输集团"));
    }

    @Test
    void internalModeKeepsRealClientNames() throws Exception {
        JsonNode r = call("generate", genArgs("docx", "sample", false));
        dump(r, "sample-bid-internal.docx");
        String text = Ooxml.text(fake.read(r.path("data").path("path").asText()), false);
        assertTrue(text.contains("江岭市城市发展投资集团有限公司"));
        assertEquals(0, r.path("data").path("leaks").size());
    }

    @Test
    void leakCheckFindsLiteralNamesInTemplate() {
        assertEquals(List.of("江岭市城市发展投资集团有限公司"),
                PitchTools.leakCheck("我们曾为江岭市城市发展\n投资集团有限公司提供服务", List.of("江岭市城市发展投资集团有限公司", "北辰市交通运输集团有限公司")));
    }

    @Test
    void shortClientNamesAreMaskedButAliasesStayIntact() throws Exception {
        assertTrue(PitchTools.Build.nameVariants("北京云杉数智科技有限公司（示例）").containsAll(List.of("云杉数智科技", "云杉数智")));
        JsonNode lib = PitchTools.JSON.readTree(Files.readString(FIX.resolve("library-qiheng.json")));
        PitchTools.Build b = new PitchTools.Build(lib, PitchTools.JSON.createObjectNode(), null, true);
        assertFalse(b.mask("鼎盛连锁零售劳动用工合规").contains("鼎盛连锁零售"));
        assertEquals("某市属城市发展平台公司", b.mask("某市属城市发展平台公司"));
        assertFalse(b.secretNames().contains("城市发展"));
    }

    @Test
    void pptProposalRepeatsTeamSlide() throws Exception {
        JsonNode r = call("generate", genArgs("pptx", "模板/启衡提案模板.pptx", true));
        assertTrue(r.path("success").asBoolean(), r.toString());
        dump(r, "firm-proposal.pptx");
        byte[] out = fake.read(r.path("data").path("path").asText());
        Map<String, byte[]> parts = Ooxml.readZip(out);
        long slides = parts.keySet().stream().filter(n -> n.matches("ppt/slides/slide\\d+\\.xml")).count();
        assertEquals(8, slides); // 7 页模板，团队页按 2 位律师复制成 2 页
        String pres = new String(parts.get("ppt/presentation.xml"), java.nio.charset.StandardCharsets.UTF_8);
        assertEquals(8, count(pres, "<p:sldId "));
        String text = Ooxml.text(out, true);
        assertFalse(text.contains("{{"), text);
        assertTrue(text.contains("沈知远") && text.contains("林婉清"));
        assertTrue(text.contains("¥370,800.00"));
        // 资质表 5 行放不下模板行高：压低行高后表格框不超过页面高度的 94%
        long slideCy = Long.parseLong(find(pres, "<p:sldSz cx=\"\\d+\" cy=\"(\\d+)\""));
        String slide2 = new String(parts.get("ppt/slides/slide2.xml"), java.nio.charset.StandardCharsets.UTF_8);
        java.util.regex.Matcher fm = java.util.regex.Pattern.compile("<a:off x=\"\\d+\" y=\"(\\d+)\"/><a:ext cx=\"\\d+\" cy=\"(\\d+)\"/></p:xfrm>").matcher(slide2);
        assertTrue(fm.find());
        long bottom = Long.parseLong(fm.group(1)) + Long.parseLong(fm.group(2));
        assertTrue(bottom <= slideCy * 94 / 100, "table bottom " + bottom + " of " + slideCy);
        assertEquals(0, r.path("data").path("overflowSlides").size());
    }

    @Test
    void emptyListRemovesSlideAndRows() throws Exception {
        Map<String, Object> args = new java.util.HashMap<>(genArgs("pptx", "sample", true));
        args.put("lawyerIds", List.of());
        JsonNode r = call("generate", args);
        Map<String, byte[]> parts = Ooxml.readZip(fake.read(r.path("data").path("path").asText()));
        assertEquals(6, parts.keySet().stream().filter(n -> n.matches("ppt/slides/slide\\d+\\.xml")).count());
    }

    @Test
    void errorsAreCodes() throws Exception {
        assertEquals("template_missing", call("generate", Map.of("kind", "docx", "template", "无.docx")).path("code").asText());
        assertEquals("bad_action", call("nope", "{}").path("code").asText());
        fake.call = new com.checkba.plugin.api.ToolCall(null, null, 3L, null);
        assertEquals("no_project", call("matrix.get", "{}").path("code").asText());
    }

    static String find(String s, String regex) {
        Matcher m = java.util.regex.Pattern.compile(regex).matcher(s);
        assertTrue(m.find(), regex);
        return m.group(1);
    }

    static int count(String s, String regex) {
        Matcher m = java.util.regex.Pattern.compile(regex).matcher(s);
        int n = 0;
        while (m.find()) n++;
        return n;
    }
}
