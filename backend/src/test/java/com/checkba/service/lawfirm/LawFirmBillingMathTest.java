// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.lawfirm;

import org.junit.jupiter.api.Test;

import java.util.Arrays;

import static org.junit.jupiter.api.Assertions.*;

class LawFirmBillingMathTest {

    @Test
    void capturedMillisRoundUpToSixMinuteUnitsAndDropUnderOneMinute() {
        assertEquals(0, LawFirmBillingMath.minutesFromCapturedMillis(59_999));
        assertEquals(6, LawFirmBillingMath.minutesFromCapturedMillis(60_000));
        assertEquals(6, LawFirmBillingMath.minutesFromCapturedMillis(360_000));
        assertEquals(12, LawFirmBillingMath.minutesFromCapturedMillis(360_001));
        assertEquals(24 * 60, LawFirmBillingMath.minutesFromCapturedMillis(30L * 3_600_000), "capped at 24h");
    }

    @Test
    void hoursParseExactlyAndRejectBadInput() {
        assertEquals(90, LawFirmBillingMath.minutesFromHours("1.5"));
        assertEquals(6, LawFirmBillingMath.minutesFromHours("0.1"));
        assertEquals(20, LawFirmBillingMath.minutesFromHours("0.33"), "19.8 min rounds half-up to 20");
        assertEquals(1440, LawFirmBillingMath.minutesFromHours("24"));
        for (String bad : new String[]{"0", "-1", "24.01", "1.234", "abc", "", "1e3"}) {
            assertThrows(IllegalArgumentException.class, () -> LawFirmBillingMath.minutesFromHours(bad), bad);
        }
    }

    @Test
    void yuanAndPercentParsing() {
        assertEquals(123450L, LawFirmBillingMath.centsFromYuan("1,234.5"));
        assertEquals(0L, LawFirmBillingMath.centsFromYuan("0"));
        assertNull(LawFirmBillingMath.centsFromYuan(" "));
        assertThrows(IllegalArgumentException.class, () -> LawFirmBillingMath.centsFromYuan("1.001"));
        assertThrows(IllegalArgumentException.class, () -> LawFirmBillingMath.centsFromYuan("-1"));
        assertEquals(1250, LawFirmBillingMath.bpsFromPercent("12.5"));
        assertEquals(0, LawFirmBillingMath.bpsFromPercent(""));
        assertThrows(IllegalArgumentException.class, () -> LawFirmBillingMath.bpsFromPercent("100.01"));
        assertThrows(IllegalArgumentException.class, () -> LawFirmBillingMath.bpsFromPercent("10.001"));
    }

    @Test
    void lineAmountRoundsHalfUpToTheCent() {
        // 7 分钟 × ¥1,234.57/h = 864,199 ÷ 60 = 14,403.32 分 → 14,403
        assertEquals(14_403L, LawFirmBillingMath.amountCents(7, 123_457));
        // 9 分钟 × ¥1.30/h = 1,170 ÷ 60 = 19.5 分 → 20
        assertEquals(20L, LawFirmBillingMath.amountCents(9, 130));
        // 1 分钟 × ¥0.30/h = 0.5 分 → 1（HALF_UP，不是银行家舍入）
        assertEquals(1L, LawFirmBillingMath.amountCents(1, 30));
        assertEquals(0L, LawFirmBillingMath.amountCents(1, 29));
        assertEquals(600_000L, LawFirmBillingMath.amountCents(90, 400_000));
    }

    @Test
    void discountThenCapWithCumulativePriorBills() {
        // 小计 ¥10,000.05，九折：折扣 1,000.005 → 1,000.01（HALF_UP），折后 9,000.04
        var t = LawFirmBillingMath.totals(1_000_005L, 1000, null, 0);
        assertEquals(100_001L, t.discountCents());
        assertEquals(900_004L, t.totalCents());
        assertEquals(0L, t.capReductionCents());

        // 封顶 ¥12,000，此前已出 ¥5,000：本单最多 ¥7,000
        t = LawFirmBillingMath.totals(1_000_000L, 1000, 1_200_000L, 500_000L);
        assertEquals(900_000L - 700_000L, t.capReductionCents());
        assertEquals(700_000L, t.totalCents());
        assertEquals(700_000L, t.capRemainingCents());

        // 封顶已用完：本单为 0，不为负
        t = LawFirmBillingMath.totals(50_000L, 0, 100_000L, 150_000L);
        assertEquals(0L, t.totalCents());
        assertEquals(50_000L, t.capReductionCents());

        // 折后恰好等于剩余额度：不减免
        t = LawFirmBillingMath.totals(100_000L, 2000, 180_000L, 100_000L);
        assertEquals(80_000L, t.totalCents());
        assertEquals(0L, t.capReductionCents());

        // 全额折扣
        t = LawFirmBillingMath.totals(12_345L, 10_000, null, 0);
        assertEquals(0L, t.totalCents());
        assertThrows(IllegalArgumentException.class, () -> LawFirmBillingMath.totals(1, 10_001, null, 0));
    }

    @Test
    void allocationIsExactAndDeterministic() {
        long[] out = LawFirmBillingMath.allocate(100, new long[]{1, 1, 1});
        assertEquals(100, Arrays.stream(out).sum());
        assertArrayEquals(new long[]{34, 33, 33}, out, "ties go to the earliest line");
        out = LawFirmBillingMath.allocate(1_000_001, new long[]{600_000, 300_000, 0, 100_000});
        assertEquals(1_000_001, Arrays.stream(out).sum());
        assertEquals(0, out[2], "zero-weight lines never receive a cent");
        assertArrayEquals(new long[]{0, 0}, LawFirmBillingMath.allocate(500, new long[]{0, 0}));
        assertArrayEquals(new long[]{0, 0}, LawFirmBillingMath.allocate(0, new long[]{5, 5}));
    }
}
