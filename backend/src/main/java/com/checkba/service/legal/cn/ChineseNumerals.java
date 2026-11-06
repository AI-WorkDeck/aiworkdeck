// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.legal.cn;

/**
 * 中文数字与阿拉伯数字互转（纯函数，不碰 Spring 与 IO）。
 *
 * <p>覆盖法条与案号里实际出现的写法：小写（一百零八）、大写（壹佰零捌）、「两」、
 * 「〇」、全角阿拉伯数字（５７７），以及无单位的逐位写法（二〇二三）。
 * 范围 0–99,999,999（到「万」为止，条号与年份都用不到「亿」）。
 */
public final class ChineseNumerals {

    private static final long MAX = 99_999_999L;
    private static final char[] DIGITS = {'零', '一', '二', '三', '四', '五', '六', '七', '八', '九'};
    private static final char[] UNITS = {'千', '百', '十'};

    private ChineseNumerals() {
    }

    /**
     * 中文/阿拉伯数字 → 数值。认不出的字符、单位次序错乱（「二十二十」「百千」）、
     * 有单位时数字连写（「一二百」）一律返回 {@code null}，绝不猜。
     */
    public static Long parse(String text) {
        if (text == null) return null;
        String s = text.strip();
        if (s.isEmpty()) return null;
        boolean hasUnit = false;
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (unitOf(c) > 0) hasUnit = true;
            else if (digitOf(c) < 0) return null;
        }
        if (!hasUnit) {
            if (s.length() > 8) return null;
            long v = 0;
            for (int i = 0; i < s.length(); i++) v = v * 10 + digitOf(s.charAt(i));
            return v;
        }

        long result = 0;      // 已结算的「万」以上部分
        long section = 0;     // 当前万以内小节
        int digit = -1;       // 尚未乘单位的数字（-1 = 无）
        int lastUnit = Integer.MAX_VALUE;  // 本小节上一个单位，必须严格递减
        boolean wanSeen = false;
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            int d = digitOf(c);
            if (d == 0) {
                // 「零」只是占位；但不能夹在数字和它的单位之间（「一零百」）
                if (digit > 0) return null;
                continue;
            }
            if (d > 0) {
                if (digit >= 0) return null;   // 有单位时数字不能连写
                digit = d;
                continue;
            }
            int unit = unitOf(c);
            if (unit == 10_000) {
                if (wanSeen) return null;
                long sec = section + Math.max(digit, 0);
                if (sec == 0) return null;
                result = sec * 10_000;
                section = 0;
                digit = -1;
                lastUnit = Integer.MAX_VALUE;
                wanSeen = true;
                continue;
            }
            if (unit >= lastUnit) return null;
            // 「十」= 10：单位前省略的「一」
            section += (long) (digit < 0 ? 1 : digit) * unit;
            digit = -1;
            lastUnit = unit;
        }
        long value = result + section + Math.max(digit, 0);
        return value > MAX ? null : value;
    }

    /**
     * 数值 → 规范中文小写。10–19 写作「十X」（不写「一十X」），中间缺位补一个「零」：
     * 577 → 五百七十七，110 → 一百一十，1005 → 一千零五，100000 → 十万。
     *
     * @throws IllegalArgumentException 超出 0–99,999,999
     */
    public static String toChinese(long n) {
        if (n < 0 || n > MAX) throw new IllegalArgumentException("out of range: " + n);
        if (n == 0) return "零";
        int high = (int) (n / 10_000);
        int low = (int) (n % 10_000);
        StringBuilder sb = new StringBuilder();
        if (high > 0) {
            sb.append(section(high)).append('万');
            if (low > 0 && low < 1000) sb.append('零');
        }
        if (low > 0) sb.append(section(low));
        String out = sb.toString();
        return out.startsWith("一十") ? out.substring(1) : out;
    }

    /** 1–9999 的一节。 */
    private static String section(int x) {
        StringBuilder sb = new StringBuilder();
        boolean pendingZero = false;
        int[] units = {1000, 100, 10};
        for (int i = 0; i < units.length; i++) {
            int d = x / units[i] % 10;
            if (d == 0) {
                if (sb.length() > 0) pendingZero = true;
                continue;
            }
            if (pendingZero) sb.append('零');
            pendingZero = false;
            sb.append(DIGITS[d]).append(UNITS[i]);
        }
        int ones = x % 10;
        if (ones > 0) {
            if (pendingZero) sb.append('零');
            sb.append(DIGITS[ones]);
        }
        return sb.toString();
    }

    static int digitOf(char c) {
        if (c >= '0' && c <= '9') return c - '0';
        if (c >= '０' && c <= '９') return c - '０';
        return switch (c) {
            case '零', '〇' -> 0;
            case '一', '壹' -> 1;
            case '二', '两', '贰' -> 2;
            case '三', '叁' -> 3;
            case '四', '肆' -> 4;
            case '五', '伍' -> 5;
            case '六', '陆' -> 6;
            case '七', '柒' -> 7;
            case '八', '捌' -> 8;
            case '九', '玖' -> 9;
            default -> -1;
        };
    }

    private static int unitOf(char c) {
        return switch (c) {
            case '十', '拾' -> 10;
            case '百', '佰' -> 100;
            case '千', '仟' -> 1000;
            case '万', '萬' -> 10_000;
            default -> -1;
        };
    }
}
