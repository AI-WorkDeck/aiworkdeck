// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.legal.cn;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;

class ChineseNumeralsTest {

    @ParameterizedTest(name = "{0} → {1}")
    @CsvSource({
            "一, 1", "十, 10", "十一, 11", "二十, 20", "二十一, 21", "九十九, 99",
            "一百, 100", "一百零八, 108", "一百一十, 110", "一百十, 110", "五百七十七, 577",
            "一千, 1000", "一千零五, 1005", "一千零一十, 1010", "一千二百六十, 1260",
            "一万, 10000", "一万零五百, 10500", "十万, 100000", "两千, 2000", "两百, 200",
            "壹佰零捌, 108", "伍佰柒拾柒, 577", "拾, 10",
            "577, 577", "０５７７, 577", "５７７, 577", "5百, 500",
            "二〇二三, 2023", "二零二三, 2023", "〇, 0", "零, 0",
            "' 二十 ', 20",
    })
    void parse(String text, long expected) {
        assertEquals(expected, ChineseNumerals.parse(text));
    }

    @ParameterizedTest
    @ValueSource(strings = {"", " ", "若干", "本", "二十二十", "百千", "一二百", "十百", "一零百", "万万", "123456789", "第五条"})
    @DisplayName("认不出的一律 null，不猜")
    void parseRejects(String text) {
        assertNull(ChineseNumerals.parse(text));
    }

    @Test
    void parseNull() {
        assertNull(ChineseNumerals.parse(null));
    }

    @ParameterizedTest(name = "{0} → {1}")
    @CsvSource({
            "0, 零", "1, 一", "10, 十", "11, 十一", "19, 十九", "20, 二十", "21, 二十一",
            "100, 一百", "101, 一百零一", "110, 一百一十", "577, 五百七十七",
            "1000, 一千", "1005, 一千零五", "1010, 一千零一十", "1260, 一千二百六十",
            "10000, 一万", "10010, 一万零一十", "10500, 一万零五百", "15000, 一万五千",
            "100000, 十万", "110000, 十一万", "1000001, 一百万零一", "99999999, 九千九百九十九万九千九百九十九",
    })
    void toChinese(long n, String expected) {
        assertEquals(expected, ChineseNumerals.toChinese(n));
    }

    @Test
    @DisplayName("1–20000 往返一致")
    void roundTrip() {
        for (long n = 0; n <= 20_000; n++) {
            assertEquals(n, ChineseNumerals.parse(ChineseNumerals.toChinese(n)), "n=" + n);
        }
    }

    @Test
    void toChineseOutOfRange() {
        assertThrows(IllegalArgumentException.class, () -> ChineseNumerals.toChinese(-1));
        assertThrows(IllegalArgumentException.class, () -> ChineseNumerals.toChinese(100_000_000L));
    }
}
