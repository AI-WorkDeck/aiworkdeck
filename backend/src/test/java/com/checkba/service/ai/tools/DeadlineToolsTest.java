// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ai.tools;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

import java.time.DayOfWeek;
import java.time.LocalDate;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** deadline_compute（tool-system-v2 D2）：起算规则、月末、节假日与调休顺延、无表年份兜底、预设。 */
class DeadlineToolsTest {

    private final DeadlineTools tools = new DeadlineTools();

    private String run(String start, String kind, Integer amount, String unit) {
        return tools.deadline_compute(start, kind, amount, unit);
    }

    private static String endOf(String out) {
        return out.lines().filter(l -> l.startsWith("到期日：")).findFirst().orElseThrow().substring(4, 14);
    }

    @Test
    @DisplayName("起算当日不计入：11-03 送达 + 15 日 = 11-18，不是 11-17")
    void startDayExcluded() {
        String out = run("2026-11-03", "appeal_judgment", null, null);
        assertEquals("2026-11-18", endOf(out));
        assertTrue(out.contains("当日不计入"));
        assertTrue(out.contains("无需顺延"));
        assertEquals("2026-11-04", endOf(run("2026-11-03", null, 1, "DAY")));
    }

    @Test
    @DisplayName("按月计算取对应日，无对应日取月末（含闰年）")
    void monthEnd() {
        assertEquals("2025-02-28", endOf(run("2025-01-31", null, 1, "MONTH")));
        String leap = run("2024-01-31", null, 1, "MONTH");
        assertEquals("2024-02-29", endOf(leap));
        assertTrue(leap.contains("月末日"));
        assertEquals("2026-11-30", endOf(run("2026-08-31", null, 3, "MONTH")));
        assertEquals("2025-02-28", endOf(run("2024-02-29", null, 1, "YEAR")));
        assertEquals("2026-05-12", endOf(run("2025-11-12", null, 6, "MONTH")));
    }

    @Test
    @DisplayName("最后一日是周末：顺延到下周一，并说明原因")
    void weekendRoll() {
        String out = run("2026-11-07", null, 15, "DAY"); // 11-22 周日
        assertEquals("2026-11-23", endOf(out));
        assertTrue(out.contains("周末"));
        assertTrue(out.contains("顺延至"));
        // 周六落点
        assertEquals("2026-11-23", endOf(run("2026-11-06", null, 15, "DAY"))); // 11-21 周六
    }

    @Test
    @DisplayName("最后一日落在 2026 国庆假期：顺延到 10-08；期间途中的假日不延长")
    void nationalDayRoll() {
        String out = run("2026-09-16", "appeal_judgment", null, null); // 10-01
        assertEquals("2026-10-08", endOf(out));
        assertTrue(out.contains("国庆节"));
        assertTrue(out.contains("不延长"));
        assertTrue(out.contains("国办发明电〔2025〕7号"));
        // 途中跨过国庆但终点是普通工作日：不顺延
        assertEquals("2026-10-12", endOf(run("2026-09-27", null, 15, "DAY"))); // 10-12 周一
    }

    @Test
    @DisplayName("调休上班的周末算工作日，不顺延（2026-09-20 周日、2026-10-10 周六、2026-02-28 周六）")
    void makeUpWorkdayIsNotRolled() {
        assertEquals("2026-09-20", endOf(run("2026-09-05", null, 15, "DAY")));
        assertEquals("2026-10-10", endOf(run("2026-09-25", null, 15, "DAY")));
        assertEquals("2026-02-28", endOf(run("2026-01-31", null, 1, "MONTH")));
        assertFalse(run("2026-09-05", null, 15, "DAY").contains("顺延至"));
    }

    @Test
    @DisplayName("连续假期加周末：春节 2026-02-17 落点顺延到 02-24；跨年顺延")
    void longHolidayAndCrossYear() {
        assertEquals("2026-02-24", endOf(run("2026-02-02", null, 15, "DAY"))); // 02-17 春节
        // 2026-12-31 周四 → 到期 2027-01-01..03 元旦假期 → 01-04 周一（2027 表）
        assertEquals("2027-01-04", endOf(run("2026-12-17", null, 15, "DAY"))); // 01-01
    }

    @Test
    @DisplayName("没有官方表的年份：只按周末顺延，并在待核实里说明")
    void fallbackYear() {
        String out = run("2028-03-03", null, 15, "DAY"); // 2028-03-18 周六
        assertEquals("2028-03-20", endOf(out));
        assertTrue(out.contains("待核实"));
        assertTrue(out.contains("没有 [2028] 年的官方节假日表"));
        // 有表的年份不出现兜底说明
        assertFalse(run("2026-11-03", "defense", null, null).contains("没有 ["));
    }

    @ParameterizedTest(name = "{0} → {1}")
    @CsvSource({
            "appeal_judgment, 2026-03-17, 15日",
            "appeal_ruling, 2026-03-12, 10日",
            "defense, 2026-03-17, 15日",
            "evidence, 2026-03-17, 15日",
            "retrial, 2026-09-02, 6个月",
            "limitation, 2029-03-02, 3年",
            "上诉期, 2026-03-17, 15日",
            "诉讼时效, 2029-03-02, 3年",
    })
    @DisplayName("每个预设的期间长度与待核实提示")
    void presets(String kind, String end, String period) {
        String out = run("2026-03-02", kind, null, null);
        // 2029 无表且 03-02 为周五，不顺延
        assertEquals(end, endOf(out));
        assertTrue(out.contains(period), out);
        assertTrue(out.contains("默认值"));
        assertTrue(out.contains("待核实"));
    }

    @Test
    @DisplayName("amount+unit 覆盖 kind，且不再标预设默认值")
    void explicitOverridesPreset() {
        String out = run("2026-03-02", "appeal_judgment", 20, "DAY");
        assertEquals("2026-03-23", endOf(out));
        assertFalse(out.contains("默认值"));
    }

    @Test
    @DisplayName("非法入参返回 Error 开头的可行动提示")
    void badInput() {
        assertTrue(run("11月3日", "defense", null, null).startsWith("Error:"));
        assertTrue(run("2026-11-03", "不存在", null, null).startsWith("Error:"));
        assertTrue(run("2026-11-03", null, null, null).startsWith("Error:"));
        assertTrue(run("2026-11-03", null, 3, "WEEK").startsWith("Error:"));
        assertTrue(run("2026-11-03", null, 0, "DAY").startsWith("Error:"));
    }

    @Test
    @DisplayName("2024–2027 节假日表自检：调休上班日都落在周末，放假日不重复，2027 表存在")
    void bundledCalendarsAreSane() {
        int[] holidayDays = {1 + 8 + 3 + 5 + 1 + 3 + 7, 1 + 8 + 3 + 5 + 3 + 8, 3 + 9 + 3 + 5 + 3 + 3 + 7, 3 + 9 + 3 + 5 + 1 + 1 + 7};
        for (int y = 2024; y <= 2027; y++) {
            DeadlineTools.Calendar c = DeadlineTools.calendarOf(y);
            assertNotNull(c, "缺 " + y);
            assertEquals(holidayDays[y - 2024], c.holidays().size(), y + " 放假天数");
            for (LocalDate w : c.workdays()) {
                DayOfWeek d = w.getDayOfWeek();
                assertTrue(d == DayOfWeek.SATURDAY || d == DayOfWeek.SUNDAY, w + " 调休日应为周末");
                assertFalse(c.holidays().contains(w), w + " 同时是放假日");
            }
        }
        assertNull(DeadlineTools.calendarOf(2028));
    }
}
