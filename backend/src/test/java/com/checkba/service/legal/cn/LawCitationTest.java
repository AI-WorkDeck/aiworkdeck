// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.legal.cn;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class LawCitationTest {

    // ---- 别名表 ----

    @ParameterizedTest(name = "{0} → {1}")
    @CsvSource({
            "民法典, 民法典", "中华人民共和国民法典, 民法典", "中华人民共和国 民法典, 民法典",
            "民诉法, 民事诉讼法", "刑诉法, 刑事诉讼法", "行诉法, 行政诉讼法",
            "个保法, 个人信息保护法", "消保法, 消费者权益保护法", "破产法, 企业破产法",
            "招投标法, 招标投标法", "劳动合同法, 劳动合同法", "合同法, 合同法",
    })
    void aliasCanonicalShort(String title, String expected) {
        assertEquals(expected, LawAliases.canonicalShort(title));
    }

    @Test
    void aliasFullName() {
        assertEquals("中华人民共和国民法典", LawAliases.fullName("民法典"));
        assertEquals("中华人民共和国宪法", LawAliases.fullName("宪法"));
        assertEquals("中华人民共和国民事诉讼法", LawAliases.fullName("民诉法"));
        assertNull(LawAliases.fullName("北京市物业管理条例"));
        assertNull(LawAliases.fullName(null));
        assertFalse(LawAliases.isKnown("方法"));
    }

    @Test
    @DisplayName("无书名号扫描时长名优先：劳动合同法不能被认成合同法")
    void longestFirst() {
        List<String> names = LawAliases.namesLongestFirst();
        assertTrue(names.indexOf("劳动合同法") < names.indexOf("合同法"));
        assertTrue(names.indexOf("中华人民共和国民法典") < names.indexOf("民法典"));
    }

    // ---- 单条解析 ----

    @Test
    @DisplayName("《民法典》第五百七十七条第一款")
    void bracketedWithParagraph() {
        LawCitation c = LawCitation.parse("《民法典》第五百七十七条第一款");
        assertNotNull(c);
        assertEquals("民法典", c.lawTitle());
        assertEquals("民法典", c.lawShortName());
        assertEquals("中华人民共和国民法典", c.lawFullName());
        assertEquals(577, c.article());
        assertEquals(0, c.articleSub());
        assertEquals(1, c.paragraph());
        assertNull(c.item());
        assertNull(c.subItem());
        assertNull(c.editionYear());
        assertEquals("577", c.articleNumber());
        assertEquals("《中华人民共和国民法典》第五百七十七条第一款", c.normalized());
    }

    @Test
    @DisplayName("民法典577条：无书名号、无「第」、阿拉伯数字")
    void bareArabic() {
        LawCitation c = LawCitation.parse("民法典577条");
        assertNotNull(c);
        assertEquals("民法典", c.lawShortName());
        assertEquals(577, c.article());
        assertEquals("《中华人民共和国民法典》第五百七十七条", c.normalized());
    }

    @ParameterizedTest
    @ValueSource(strings = {
            "《公司法》(2023修订)第21条", "《公司法》（2023年修订）第21条", "《公司法（2023年修订）》第21条",
            "《中华人民共和国公司法》（2023年修订）第二十一条", "《公司法》（2023修订版）第二十一条",
            "公司法（2023年修订）第21条",
    })
    @DisplayName("版本括注：书名号外、书名号内、无书名号")
    void edition(String text) {
        LawCitation c = LawCitation.parse(text);
        assertNotNull(c, text);
        assertEquals("公司法", c.lawShortName());
        assertEquals(2023, c.editionYear());
        assertEquals("修订", c.editionKind());
        assertEquals(21, c.article());
        assertEquals("《中华人民共和国公司法》（2023年修订）第二十一条", c.normalized());
    }

    @Test
    void editionWithoutKind() {
        LawCitation c = LawCitation.parse("《公司法》（2018）第十六条");
        assertNotNull(c);
        assertEquals(2018, c.editionYear());
        assertNull(c.editionKind());
        assertEquals("《中华人民共和国公司法》（2018年）第十六条", c.normalized());
    }

    @Test
    void editionChineseYearAndAmendment() {
        LawCitation c = LawCitation.parse("《行政诉讼法》（二〇一七年修正）第二条");
        assertNotNull(c);
        assertEquals(2017, c.editionYear());
        assertEquals("修正", c.editionKind());
    }

    @Test
    @DisplayName("条之一 + 款 + 项（带括号）+ 目")
    void fullDepth() {
        LawCitation c = LawCitation.parse("《刑法》第一百二十条之一第二款第（三）项第1目");
        assertNotNull(c);
        assertEquals(120, c.article());
        assertEquals(1, c.articleSub());
        assertEquals(2, c.paragraph());
        assertEquals(3, c.item());
        assertEquals(1, c.subItem());
        assertEquals("120.1", c.articleNumber());
        assertEquals("《中华人民共和国刑法》第一百二十条之一第二款第三项第一目", c.normalized());
    }

    @ParameterizedTest(name = "{0}")
    @CsvSource(delimiter = '|', value = {
            "《劳动合同法》第三十九条第（二）项|39|null|2",
            "《劳动合同法》第三十九条第(二)项|39|null|2",
            "《劳动合同法》第三十九条（二）项|39|null|2",
            "《劳动合同法》第39条第2项|39|null|2",
            "劳动合同法第39条1款|39|1|null",
            "《民法典》第 577 条 第 1 款|577|1|null",
            "《民法典》的第五百七十七条|577|null|null",
            "《民法典》中第五百七十七条|577|null|null",
            "《民法典》第五百七十七条的规定|577|null|null",
            "《民法典》第五百七十七条。|577|null|null",
            "民法典第１０条|10|null|null",
    })
    void variants(String text, int article, String para, String item) {
        LawCitation c = LawCitation.parse(text);
        assertNotNull(c, text);
        assertEquals(article, c.article());
        assertEquals("null".equals(para) ? null : Integer.valueOf(para), c.paragraph());
        assertEquals("null".equals(item) ? null : Integer.valueOf(item), c.item());
    }

    @ParameterizedTest
    @CsvSource(delimiter = '|', value = {
            "中华人民共和国民法典第五百七十七条|民法典",
            "根据民诉法第一百二十二条|民事诉讼法",
            "个保法第13条|个人信息保护法",
    })
    void bareAliases(String text, String shortName) {
        List<LawCitation> all = LawCitation.findAll(text);
        assertEquals(1, all.size(), text);
        assertEquals(shortName, all.get(0).lawShortName());
    }

    @Test
    @DisplayName("表外法规：书名号里是法规样式就收，原标题保留、全称为空")
    void unknownRegulation() {
        LawCitation c = LawCitation.parse("《北京市物业管理条例》第三十条");
        assertNotNull(c);
        assertEquals("北京市物业管理条例", c.lawTitle());
        assertEquals("北京市物业管理条例", c.lawShortName());
        assertNull(c.lawFullName());
        assertEquals("《北京市物业管理条例》第三十条", c.normalized());

        LawCitation j = LawCitation.parse("《最高人民法院关于审理民间借贷案件适用法律若干问题的规定》第二十五条");
        assertNotNull(j);
        assertEquals(25, j.article());
    }

    @ParameterizedTest
    @ValueSource(strings = {
            "第五百七十七条",              // 无法名
            "《民法典》",                  // 无条号
            "《买卖合同》第三条",          // 合同条款，不是法条
            "《股权转让协议》第5条第2款",
            "《公司章程》第十条",
            "方法第三条",                  // 无书名号且不在表内
            "《民法典》第若干条",
            "《民法典》第零条",
            "《民法典》第10000条",          // 超出条号上限
            "《民法典》第五百七十七条和第五百八十四条",  // 两处，不是「恰好一处」
    })
    void parseRejects(String text) {
        assertNull(LawCitation.parse(text), text);
    }

    @Test
    void parseNull() {
        assertNull(LawCitation.parse(null));
        assertTrue(LawCitation.findAll(null).isEmpty());
        assertTrue(LawCitation.findAll("").isEmpty());
    }

    // ---- 文中扫描 ----

    @Test
    @DisplayName("列举：后续条继承法名，后续款继承条号，位置精确")
    void lists() {
        String text = "依据《民法典》第五百七十七条、第五百八十四条及第五百八十五条第一款、第二款的规定，被告应承担违约责任。";
        List<LawCitation> all = LawCitation.findAll(text);
        assertEquals(4, all.size());
        assertEquals(List.of(577, 584, 585, 585), all.stream().map(LawCitation::article).toList());
        assertEquals("《民法典》第五百七十七条", all.get(0).raw());
        assertEquals("第五百八十四条", all.get(1).raw());
        assertEquals("第五百八十五条第一款", all.get(2).raw());
        assertEquals("第二款", all.get(3).raw());
        assertEquals(2, all.get(3).paragraph());
        for (LawCitation c : all) {
            assertEquals("民法典", c.lawShortName());
            assertEquals(c.raw(), text.substring(c.start(), c.end()));
        }
    }

    @Test
    @DisplayName("逗号不是列举：「，第二款约定…」不能挂到前一条上")
    void commaDoesNotContinue() {
        List<LawCitation> all = LawCitation.findAll("违反《民法典》第五百零九条第一款，第二款约定的义务另行处理");
        assertEquals(1, all.size());
    }

    @Test
    @DisplayName("一段里多部法律、混合写法")
    void multipleLaws() {
        String text = "原告依据《中华人民共和国合同法》第一百零七条（已废止）、民法典第577条，"
                + "并参照《劳动合同法》第四十七条主张权利；另见《买卖合同》第3条。";
        List<LawCitation> all = LawCitation.findAll(text);
        assertEquals(List.of("合同法", "民法典", "劳动合同法"), all.stream().map(LawCitation::lawShortName).toList());
        assertEquals(List.of(107, 577, 47), all.stream().map(LawCitation::article).toList());
        for (LawCitation c : all) assertEquals(c.raw(), text.substring(c.start(), c.end()));
    }

    @Test
    @DisplayName("后续条可带自己的款项")
    void listWithOwnParagraph() {
        List<LawCitation> all = LawCitation.findAll("《公司法》第二十一条第二款和第二十三条第一款");
        assertEquals(2, all.size());
        assertEquals(2, all.get(0).paragraph());
        assertEquals(23, all.get(1).article());
        assertEquals(1, all.get(1).paragraph());
    }

    @Test
    @DisplayName("后续条继承版本括注")
    void listInheritsEdition() {
        List<LawCitation> all = LawCitation.findAll("《公司法》（2023年修订）第二十一条、第二十三条");
        assertEquals(2, all.size());
        assertEquals(2023, all.get(1).editionYear());
    }

    @Test
    @DisplayName("与 LawArticleNumbers.toArabic 同形，可直接喂法宝 adjust_provisions")
    void articleNumberMatchesExistingHelper() {
        LawCitation c = LawCitation.parse("《公司法》第二十条之一");
        assertNotNull(c);
        assertEquals(com.checkba.service.insight.LawArticleNumbers.toArabic("第二十条之一"), c.articleNumber());
    }
}
