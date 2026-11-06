// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.legal.cn;

import com.checkba.service.legal.cn.CaseNumber.Category;
import com.checkba.service.legal.cn.CaseNumber.CourtLevel;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class CaseNumberTest {

    @Test
    @DisplayName("(2023)京01民终1234号")
    void intermediateAppeal() {
        CaseNumber c = CaseNumber.parse("(2023)京01民终1234号");
        assertNotNull(c);
        assertEquals(2023, c.year());
        assertEquals("京01", c.courtCode());
        assertEquals("北京市", c.province());
        assertEquals(CourtLevel.INTERMEDIATE, c.courtLevel());
        assertEquals("民终", c.caseTypeCode());
        assertEquals("民事二审", c.caseTypeName());
        assertEquals(Category.CIVIL, c.category());
        assertEquals(1234, c.sequence());
        assertEquals("（2023）京01民终1234号", c.normalized());
    }

    @ParameterizedTest(name = "{0}")
    @CsvSource(delimiter = '|', value = {
            "（2021）最高法民申1234号|最高法|SUPREME|民申|CIVIL|",
            "（2022）沪民终88号|沪|HIGH|民终|CIVIL|上海市",
            "（2023）京0105民初12345号|京0105|BASIC|民初|CIVIL|北京市",
            "（2020）粤03刑初456号|粤03|INTERMEDIATE|刑初|CRIMINAL|广东省",
            "（2019）浙0102行初7号|浙0102|BASIC|行初|ADMINISTRATIVE|浙江省",
            "（2024）苏05执恢12号|苏05|INTERMEDIATE|执恢|ENFORCEMENT|江苏省",
            "（2024）苏0508执3456号|苏0508|BASIC|执|ENFORCEMENT|江苏省",
            "（2023）京73民初100号|京73|INTERMEDIATE|民初|CIVIL|北京市",
            "（2022）京0491民初9号|京0491|BASIC|民初|CIVIL|北京市",
            "（2021）粤03破申5号|粤03|INTERMEDIATE|破申|BANKRUPTCY|广东省",
            "（2021）粤0304财保1号|粤0304|BASIC|财保|PRESERVATION|广东省",
            "（2020）兵08民终3号|兵08|INTERMEDIATE|民终|CIVIL|新疆生产建设兵团",
            "（2018）最高法委赔监1号|最高法|SUPREME|委赔监|STATE_COMPENSATION|",
    })
    void variants(String text, String court, CourtLevel level, String type, Category category, String province) {
        CaseNumber c = CaseNumber.parse(text);
        assertNotNull(c, text);
        assertEquals(court, c.courtCode());
        assertEquals(level, c.courtLevel());
        assertEquals(type, c.caseTypeCode());
        assertEquals(category, c.category());
        assertEquals(province, c.province());
        assertEquals(text, c.normalized());
    }

    @ParameterizedTest
    @ValueSource(strings = {
            "(2023)京01民终1234号", "（2023）京01民终1234号", "〔2023〕京01民终1234号", "[2023]京01民终1234号",
            "( 2023 ) 京01 民终 1234 号", "（２０２３）京０１民终１２３４号",
    })
    @DisplayName("括号、空白、全角数字都规范到同一写法")
    void normalization(String text) {
        CaseNumber c = CaseNumber.parse(text);
        assertNotNull(c, text);
        assertEquals("（2023）京01民终1234号", c.normalized());
        assertEquals(text, c.raw());
    }

    @Test
    @DisplayName("知识产权法庭「知民终」：去掉「知」查表")
    void ipTribunal() {
        CaseNumber c = CaseNumber.parse("（2021）最高法知民终1号");
        assertNotNull(c);
        assertEquals("知民终", c.caseTypeCode());
        assertEquals("知识产权民事二审", c.caseTypeName());
        assertEquals(Category.CIVIL, c.category());
    }

    @Test
    @DisplayName("表外代字照常解析，名称为空、大类按首字推断")
    void unknownType() {
        CaseNumber c = CaseNumber.parse("（2023）京01民他5号");
        assertNotNull(c);
        assertNull(c.caseTypeName());
        assertEquals(Category.CIVIL, c.category());
        CaseNumber x = CaseNumber.parse("（2023）京01司救1号");
        assertNotNull(x);
        assertEquals(Category.OTHER, x.category());
    }

    @ParameterizedTest
    @ValueSource(strings = {
            "(2015)民二终字第1号",           // 旧式：无法院代字
            "(2014)京一中民终字第1234号",     // 旧式：含「字第」
            "(2023)京1民终1号",               // 法院代字位数不对
            "(2023)京012民终1号",
            "(2023)港01民终1号",              // 非法院代字简称
            "(1900)京01民终1号",              // 年份越界
            "(2023)京01民终0号",
            "2023京01民终1234号",             // 缺年度括号
            "(2023)京01民终1234",             // 缺「号」
            "(2023)京01民终1234号、(2023)京01民终1235号",
            "",
    })
    void rejects(String text) {
        assertNull(CaseNumber.parse(text), text);
    }

    @Test
    void parseNull() {
        assertNull(CaseNumber.parse(null));
        assertTrue(CaseNumber.findAll(null).isEmpty());
    }

    @Test
    @DisplayName("文中扫描：多个案号、位置指向原文")
    void findAll() {
        String text = "一审（2022）京0105民初100号判决后，上诉人不服，北京一中院作出（2023）京01民终1234号判决；"
                + "旧案(2014)京一中民终字第5号不计。";
        List<CaseNumber> all = CaseNumber.findAll(text);
        assertEquals(2, all.size());
        assertEquals(List.of("（2022）京0105民初100号", "（2023）京01民终1234号"),
                all.stream().map(CaseNumber::normalized).toList());
        for (CaseNumber c : all) assertEquals(c.raw(), text.substring(c.start(), c.end()));
    }
}
