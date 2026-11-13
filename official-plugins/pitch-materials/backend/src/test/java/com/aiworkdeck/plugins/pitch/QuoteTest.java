// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.aiworkdeck.plugins.pitch;

import static org.junit.jupiter.api.Assertions.*;

import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.Test;

class QuoteTest {
    @Test
    void upperCaseAmounts() {
        assertEquals("人民币叁拾柒万零捌佰元整", Quote.upper(37080000L));
        assertEquals("人民币壹亿零壹元整", Quote.upper(10000000100L));
        assertEquals("人民币壹仟零壹万元整", Quote.upper(1001000000L));
        assertEquals("人民币壹佰万零伍佰元整", Quote.upper(100050000L));
        assertEquals("人民币壹仟零伍元伍角", Quote.upper(100550L));
        assertEquals("人民币壹元零伍分", Quote.upper(105L));
        assertEquals("人民币零元整", Quote.upper(0L));
        assertEquals("人民币伍角", Quote.upper(50L));
        assertEquals("人民币壹拾万元整", Quote.upper(10000000L));
    }

    @Test
    void fixedPlusHourlyWithDiscountTaxIncluded() throws Exception {
        JsonNode q = PitchTools.JSON.readTree("{\"name\":\"常年\",\"rates\":{\"合伙人\":\"2800\"},\"items\":["
                + "{\"label\":\"年度顾问费\",\"kind\":\"fixed\",\"amount\":\"300,000\"},"
                + "{\"label\":\"专项\",\"kind\":\"hourly\",\"title\":\"合伙人\",\"hours\":\"40\"}],"
                + "\"discountPct\":\"10\",\"taxRatePct\":\"6\",\"taxIncluded\":true}");
        Quote.Result r = Quote.compute(q, true);
        assertEquals(41200000L, r.subtotal());
        assertEquals(4120000L, r.discount());
        assertEquals(37080000L, r.total());
        assertEquals(37080000L - 34981132L, r.tax());
        assertEquals("人民币叁拾柒万零捌佰元整", r.upper());
        assertTrue(r.note().contains("10%"));
        assertEquals("合伙人 2,800.00 元/小时 × 40 小时", r.lines().get(1).basis());
        assertEquals(4, Quote.rows(r, true).size()); // 2 条目 + 小计 + 优惠
    }

    @Test
    void capAndTaxExcluded() throws Exception {
        JsonNode q = PitchTools.JSON.readTree("{\"rates\":{\"律师\":\"1200\"},\"items\":[{\"label\":\"律师\",\"kind\":\"hourly\",\"title\":\"律师\",\"hours\":\"600\"}],"
                + "\"capAmount\":\"600000\",\"taxRatePct\":\"6\",\"taxIncluded\":false}");
        Quote.Result r = Quote.compute(q, true);
        assertEquals(72000000L, r.subtotal());
        assertEquals(12000000L, r.capCut());
        assertEquals(3600000L, r.tax());
        assertEquals(63600000L, r.total());
    }

    @Test
    void moneyIgnoresJvmLocale() {
        java.util.Locale old = java.util.Locale.getDefault();
        try {
            java.util.Locale.setDefault(java.util.Locale.GERMANY);
            assertEquals("¥36,000,000.05", Quote.money(3600000005L, true));
        } finally { java.util.Locale.setDefault(old); }
    }

    @Test
    void rejectsBadInput() throws Exception {
        PitchTools.Failure f = assertThrows(PitchTools.Failure.class, () -> Quote.compute(PitchTools.JSON.readTree(
                "{\"items\":[{\"label\":\"x\",\"kind\":\"fixed\",\"amount\":\"30万\"}]}"), true));
        assertEquals("bad_amount", f.code);
        f = assertThrows(PitchTools.Failure.class, () -> Quote.compute(PitchTools.JSON.readTree(
                "{\"items\":[{\"label\":\"x\",\"kind\":\"hourly\",\"title\":\"顾问\",\"hours\":\"3\"}]}"), true));
        assertEquals("quote_rate_missing", f.code);
        f = assertThrows(PitchTools.Failure.class, () -> Quote.compute(PitchTools.JSON.readTree(
                "{\"items\":[{\"label\":\"x\",\"kind\":\"fixed\",\"amount\":\"1000000000000\"}]}"), true));
        assertEquals("bad_amount", f.code);
        f = assertThrows(PitchTools.Failure.class, () -> Quote.compute(PitchTools.JSON.readTree("{\"items\":[]}"), true));
        assertEquals("quote_empty", f.code);
    }
}
