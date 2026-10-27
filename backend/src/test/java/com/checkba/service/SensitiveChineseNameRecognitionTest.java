// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service;

import com.checkba.service.sensitive.SensitiveTextEngine;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.apache.poi.xwpf.usermodel.XWPFDocument;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import java.util.List;
import java.util.stream.Stream;
import static org.junit.jupiter.api.Assertions.*;

class SensitiveChineseNameRecognitionTest {
    @TempDir Path dir;
    static Stream<Arguments> surnameContexts() {
        return List.of("张小明", "李小红", "王立新", "陈安平", "欧阳文静", "司马文博", "上官云",
                "诸葛文清", "尉迟正", "司徒海", "令狐安", "第五明", "长孙平", "单晓光", "曾志远",
                "解明", "仇云", "肖文清", "覃明", "区建华", "朴正宇", "佟小宁")
                .stream().flatMap(name -> List.of("联系人：%s。", "法定代表人%s，男。", "请联系%s律师。",
                        "由%s签署本合同。", "%s的证言已收到。")
                        .stream().map(template -> Arguments.of(template.formatted(name), name)));
    }

    @ParameterizedTest
    @ValueSource(strings = {"被告一", "被告二", "原告十二", "被告1", "被告 ２", "被告（一）", "被告(2)",
            "第一被告", "第2原告", "申请人一", "被申请人二", "上诉人1", "被上诉人（二）"})
    void numberedPartyFieldsRecognizeOnlyTheName(String label) {
        String text = label + "：陈安平\n住址：成都市武侯区锦华路28号春和园2栋608房";
        var engine = new SensitiveTextEngine(List.of("CHINESE_NAME"), true, List.of(), List.of());
        String output = engine.apply(text);
        assertFalse(output.contains("陈安平"), output);
        assertTrue(output.startsWith(label + "：[[中文姓名"), output);
        assertTrue(output.endsWith("\n住址：成都市武侯区锦华路28号春和园2栋608房"));
        assertEquals(1, engine.counts().get("CHINESE_NAME"));
        assertEquals(text, SensitiveTextEngine.apply(output, SensitiveTextEngine.restoreEdits(output, engine.recovery())));
    }

    @ParameterizedTest
    @CsvSource(delimiter = '|', value = {
        "第三人：陈安平|陈安平", "第三人一：陈安平|陈安平", "被执行人：陈安平|陈安平",
        "申请执行人：陈安平|陈安平", "被告（自然人）：陈安平|陈安平", "被告一（自然人）：陈安平|陈安平",
        "原告（反诉被告）：陈安平|陈安平", "曾用名：李小红|李小红",
        "姓名：陈 安平|陈 安平", "姓名：陈安 平|陈安 平", "姓名：欧阳 明|欧阳 明",
        "原告：张 伟|张 伟", "被告一：陈 安 平|陈 安 平", "姓名：陈　安平|陈　安平",
        "姓名：陈 安平 联系电话：13800001111|陈 安平",
        "姓名：陈安 平 民族：汉族|陈安 平", "姓名：陈 安平 手机 ：13800001111|陈 安平",
        "被告⼀：徐⽂清|徐⽂清"
    })
    void explicitPersonFieldsRedactTheWholeOriginalValue(String text, String name) {
        var engine = new SensitiveTextEngine(List.of("CHINESE_NAME"), true, List.of(), List.of());
        engine.learn(text);
        String output = engine.apply(text);
        assertTrue(engine.recovery().containsValue(name), output + engine.recovery());
        assertEquals(1, engine.recovery().size());
        assertEquals(1, engine.counts().get("CHINESE_NAME"));
        assertEquals(text.substring(0, text.indexOf('：') + 1), output.substring(0, output.indexOf('：') + 1));
        assertEquals(text, SensitiveTextEngine.apply(output, SensitiveTextEngine.restoreEdits(output, engine.recovery())));
    }

    @Test void spacedNamesKeepExclusionsAndFollowingFields() {
        String text = "姓名：陈 安平  电话：13800001111";
        var engine = new SensitiveTextEngine(List.of("CHINESE_NAME"), true, List.of(), List.of());
        String output = engine.apply(text);
        assertTrue(engine.recovery().containsValue("陈 安平"), output);
        assertTrue(output.endsWith("  电话：13800001111"), output);
        var excluded = new SensitiveTextEngine(List.of("CHINESE_NAME"), true, List.of(), List.of("陈 安平"));
        excluded.learn(text);
        assertEquals(text, excluded.apply(text));
        String trailingSpace = "姓名：陈 安平  ";
        var trailing = new SensitiveTextEngine(List.of("CHINESE_NAME"), true, List.of(), List.of());
        assertTrue(trailing.apply(trailingSpace).endsWith("  "));
        assertTrue(trailing.recovery().containsValue("陈 安平"));
    }

    @Test void nameListsDoNotTurnFollowingFieldLabelsIntoNames() {
        String text = "姓名：陈安平；曾用名：李小红；单位：星河公司";
        var engine = new SensitiveTextEngine(List.of("CHINESE_NAME"), true, List.of(), List.of());
        String output = engine.apply(text);
        assertEquals(java.util.Set.of("陈安平", "李小红"), new java.util.HashSet<>(engine.recovery().values()));
        assertTrue(output.contains("；曾用名："), output);
        assertTrue(output.endsWith("；单位：星河公司"), output);
    }

    @Test void nameListsKeepSemicolonSeparatorsAndSpacedFieldLabels() {
        String text = "名单：张三；李四\n姓名：陈安平 单位 ：星河公司";
        var engine = new SensitiveTextEngine(List.of("CHINESE_NAME"), true, List.of(), List.of());
        String output = engine.apply(text);
        assertEquals(java.util.Set.of("张三", "李四", "陈安平"), new java.util.HashSet<>(engine.recovery().values()));
        assertTrue(output.endsWith(" 单位 ：星河公司"), output);
    }

    @Test void learnedShortNamesDoNotPierceExcludedSpacedNames() {
        String text = "姓名：陈安 平。\n联系人：陈安";
        var engine = new SensitiveTextEngine(List.of("CHINESE_NAME"), true, List.of(), List.of("陈安 平"));
        engine.learn(text);
        String output = engine.apply(text);
        assertTrue(output.startsWith("姓名：陈安 平。\n联系人：[[中文姓名"), output);
        assertEquals(1, engine.counts().get("CHINESE_NAME"));
        assertEquals(text, SensitiveTextEngine.apply(output, SensitiveTextEngine.restoreEdits(output, engine.recovery())));
    }

    @Test void radicalMatchingKeepsOriginalExclusionsCustomTermsAndOrdinaryText() {
        String text = "被告⼀：徐⽂清。普通⽂字保持原样。";
        var excluded = new SensitiveTextEngine(List.of("CHINESE_NAME"), true, List.of(), List.of("徐⽂清"));
        excluded.learn(text);
        assertEquals(text, excluded.apply(text));
        var custom = new SensitiveTextEngine(List.of(), true, List.of("徐⽂清"), List.of());
        String output = custom.apply(text);
        assertTrue(output.startsWith("被告⼀：[[自定义"), output);
        assertTrue(output.endsWith("。普通⽂字保持原样。"), output);
        assertEquals(text, SensitiveTextEngine.apply(output, SensitiveTextEngine.restoreEdits(output, custom.recovery())));
    }

    @ParameterizedTest
    @MethodSource("surnameContexts")
    void surnameAndContextCombinations(String text, String name) {
        detectsNamesWithoutCustomInput(text, name);
    }
    @ParameterizedTest
    @CsvSource(value = {
        "联系人：张三。|张三", "法定代表人李明，男。|李明", "负责人：王建国。|王建国",
        "委托诉讼代理人：欧阳明。|欧阳明", "经办人：司马懿。|司马懿",
        "姓名：上官婉儿。|上官婉儿", "签名：诸葛亮。|诸葛亮", "证人：尉迟恭。|尉迟恭",
        "原告张三诉被告李四。|张三", "原告张三诉被告李四。|李四",
        "请联系王建国律师。|王建国", "张三先生确认收到。|张三", "李小红女士已签收。|李小红",
        "由陈小明签署本合同。|陈小明", "赵丽向法院提交材料。|赵丽", "王伟表示同意。|王伟",
        "出席人员：张三、李四、欧阳娜娜。|欧阳娜娜", "姓名：单田芳。|单田芳",
        "联系人：曾小贤。|曾小贤", "签字人：王为民。|王为民", "张三|张三",
        "证人李华作证。|李华", "张三，男，1990年出生。|张三", "王建国，1988年出生。|王建国",
        "张三和李四共同签订本合同。|张三", "张三和李四共同签订本合同。|李四"
    }, delimiter = '|')
    void detectsNamesWithoutCustomInput(String text, String name) {
        SensitiveTextEngine engine = new SensitiveTextEngine(List.of("CHINESE_NAME"), true, List.of(), List.of());
        engine.learn(text);
        String masked = engine.apply(text);
        assertFalse(masked.contains(name), masked);
        assertTrue(engine.recovery().containsValue(name), engine.recovery().toString());
        assertEquals(text, SensitiveTextEngine.apply(masked, SensitiveTextEngine.restoreEdits(masked, engine.recovery())));
    }

    @ParameterizedTest
    @ValueSource(strings = {
        "本合同由甲方北京市朝阳区某科技有限公司与乙方签订，被告应于判决生效之日起十日内履行。",
        "双方应当履行合同。乙方应当。被告申请。原告请求。",
        "被告一：申请延期。被告二：公司。原告1：待填写。第一被告：陈述意见。",
        "姓名：待填写。联系人：暂无。负责人：待定。",
        "第三人：陈述意见。被执行人：未知。被告（自然人）：待填写。",
        "姓名：待 填写。被告（自然人）：陈安平科技有限公司。",
        "甲方：有限公司。乙方：公司。原告：申请人。",
        "法定代表人签字。负责人签名。联系人信息。姓名不得为空。",
        "王府井、马鞍山、张家口、唐山市、北京市。",
        "负责通知，申请受理，陈述意见，向前推进，高质量发展。",
        "公司名称：张三科技有限公司。住址：李明路12号。",
        "股东：北京星河科技有限公司。原告：上海市人民法院。",
        "所有权、合同法、常规、说明、时间、文件、通知、以及。",
        "费用支付完毕。金额已确认。时间安排合理。项目负责人签字。",
        "费用：100元。金额：200元。管理费用、工作计划、成果、活动、风险。",
        "金钱的使用应当合理。与金钱有关。高额的费用已支付。余款将于周五结清。"
    })
    void preservesOrdinaryProseAndNonPersonFields(String text) {
        SensitiveTextEngine engine = new SensitiveTextEngine(List.of("CHINESE_NAME"), true, List.of(), List.of());
        engine.learn(text);
        assertEquals(text, engine.apply(text));
    }

    @Test
    void learnsNamesAcrossParagraphsWithoutReplacingCompanyOrAddressFragments() {
        String text = "联系人：李明。\n随后李明确认收到。李明科技有限公司的地址为李明路12号。";
        SensitiveTextEngine engine = new SensitiveTextEngine(List.of("CHINESE_NAME"), true, List.of(), List.of());
        engine.learn(text);
        String masked = engine.apply(text);
        assertEquals(2, engine.counts().get("CHINESE_NAME"));
        assertEquals(1, engine.recovery().size());
        assertTrue(masked.contains("李明科技有限公司的地址为李明路12号。"));
        assertEquals(text, SensitiveTextEngine.apply(masked, SensitiveTextEngine.restoreEdits(masked, engine.recovery())));
    }

    @Test
    void exclusionsAndDisabledStrategyRemainEffective() {
        String text = "联系人：张三。张三已确认。";
        for (SensitiveTextEngine engine : List.of(
                new SensitiveTextEngine(List.of("CHINESE_NAME"), true, List.of(), List.of("张三")),
                new SensitiveTextEngine(List.of("PHONE"), true, List.of(), List.of()))) {
            engine.learn(text);
            assertEquals(text, engine.apply(text));
        }
    }

    @Test
    void companyAndPersonRulesKeepTheConnectingVerb() {
        String text = "原告张三诉北京星河科技有限公司。";
        SensitiveTextEngine engine = new SensitiveTextEngine(List.of("CHINESE_NAME", "COMPANY"), true, List.of(), List.of());
        engine.learn(text);
        String masked = engine.apply(text);
        assertTrue(masked.startsWith("原告[[中文姓名"), masked);
        assertTrue(masked.contains("]]诉[[公司名称"), masked);
        assertEquals(1, engine.counts().get("CHINESE_NAME"));
        assertEquals(1, engine.counts().get("COMPANY"));
        assertEquals(text, SensitiveTextEngine.apply(masked, SensitiveTextEngine.restoreEdits(masked, engine.recovery())));
    }

    @Test
    void knownNameDoesNotReplaceThePrefixOfAnotherFullName() {
        String text = "联系人：张三。关于张三丰的材料另行提供。";
        SensitiveTextEngine engine = new SensitiveTextEngine(List.of("CHINESE_NAME"), true, List.of(), List.of());
        engine.learn(text);
        assertTrue(engine.apply(text).contains("张三丰的材料另行提供。"));
        assertEquals(1, engine.counts().get("CHINESE_NAME"));
    }

    @Test
    void docxNamesAcrossRunsAndParagraphsPreviewRedactAndRestore() throws Exception {
        Path source = dir.resolve("synthetic.docx");
        try (XWPFDocument doc = new XWPFDocument()) {
            var paragraph = doc.createParagraph();
            paragraph.createRun().setText("联系人：");
            paragraph.createRun().setText("欧阳");
            paragraph.createRun().setText("明。");
            doc.createParagraph().createRun().setText("随后欧阳明确认收到。普通条款保持完整。");
            try (var out = Files.newOutputStream(source)) { doc.write(out); }
        }
        SensitiveService service = new SensitiveService();
        var options = new SensitiveService.Options(List.of("CHINESE_NAME"), "TOKEN", List.of(), List.of(), "synthetic-password");
        var preview = service.previewFile(source.toString(), options);
        var masked = service.processFile(source.toString(), options);
        assertEquals(2, preview.counts().get("CHINESE_NAME"));
        assertEquals(preview.counts(), masked.counts());
        assertFalse(preview.text().contains("欧阳明"));
        var restored = service.restoreFile(masked.path(), masked.recoveryKit(), "synthetic-password");
        try (XWPFDocument doc = new XWPFDocument(Files.newInputStream(Path.of(restored.path())))) {
            assertEquals("联系人：欧阳明。", doc.getParagraphs().get(0).getText());
            assertEquals("随后欧阳明确认收到。普通条款保持完整。", doc.getParagraphs().get(1).getText());
        }
    }
}
