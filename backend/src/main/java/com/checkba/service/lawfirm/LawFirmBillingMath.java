// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.lawfirm;

import com.checkba.service.LangText;

import java.math.BigDecimal;
import java.math.RoundingMode;

/**
 * 计时收费的金额与时长算法（纯函数，全部用 BigDecimal / 整数，不经过浮点）。
 *
 * <p>口径（改动须同步 README 与 LawFirmBillingMathTest）：
 * <ol>
 *   <li>时长一律存整数分钟。工作记录按「项目 × 日」累计毫秒（活动记录器已扣除空闲段），不足 1 分钟不生成；
 *       其余按 6 分钟（0.1 小时）为单位<b>向上</b>取整。手动补录以小时填写（最多两位小数），换算分钟后四舍五入到整分钟。</li>
 *   <li>费率为每小时含税金额（分）。单条金额 = 计费分钟 × 费率 ÷ 60，四舍五入（HALF_UP）到分。</li>
 *   <li>账单：小计 = 各条金额之和；折扣 = 小计 × 折扣基点 ÷ 10000，四舍五入到分；先折扣、后封顶。</li>
 *   <li>封顶是事项累计上限：本单可收 = max(0, 封顶 − 本事项此前未作废账单合计)；折后超出部分记为封顶减免。</li>
 *   <li>实收、账单金额按各条金额占比分摊到律师，用最大余数法保证分摊之和与原金额分毫不差。</li>
 * </ol>
 */
public final class LawFirmBillingMath {

    public static final int INCREMENT_MINUTES = 6;
    static final long MIN_CAPTURE_MS = 60_000L;
    static final int MAX_MINUTES_PER_ENTRY = 24 * 60;

    private LawFirmBillingMath() {}

    /** 工作记录累计毫秒 → 计费分钟（6 分钟单位向上取整；不足 1 分钟返回 0 表示不生成）。 */
    public static int minutesFromCapturedMillis(long millis) {
        if (millis < MIN_CAPTURE_MS) return 0;
        long unitMs = INCREMENT_MINUTES * 60_000L;
        long units = (millis + unitMs - 1) / unitMs;
        return (int) Math.min(MAX_MINUTES_PER_ENTRY, units * INCREMENT_MINUTES);
    }

    /** "1.5" 小时 → 90 分钟。非法、≤0 或超过 24 小时抛 IllegalArgumentException。 */
    public static int minutesFromHours(Object raw) {
        BigDecimal hours = decimal(raw, LangText.of("时长", "Hours"));
        if (hours.scale() > 2) {
            throw new IllegalArgumentException(LangText.of("时长最多两位小数", "Hours allow at most two decimals"));
        }
        int minutes = hours.multiply(BigDecimal.valueOf(60)).setScale(0, RoundingMode.HALF_UP).intValueExact();
        if (minutes <= 0 || minutes > MAX_MINUTES_PER_ENTRY) {
            throw new IllegalArgumentException(LangText.of("时长须大于 0 且不超过 24 小时", "Hours must be greater than 0 and at most 24"));
        }
        return minutes;
    }

    /** "1,234.5" 元 → 123450 分；允许 0；负数、超过两位小数抛错。空串返回 null。 */
    public static Long centsFromYuan(Object raw) {
        if (raw == null || String.valueOf(raw).isBlank()) return null;
        BigDecimal yuan = decimal(raw, LangText.of("金额", "Amount"));
        if (yuan.signum() < 0) throw new IllegalArgumentException(LangText.of("金额不能为负数", "Amount cannot be negative"));
        if (yuan.scale() > 2) throw new IllegalArgumentException(LangText.of("金额最多两位小数", "Amounts allow at most two decimals"));
        return yuan.movePointRight(2).setScale(0, RoundingMode.UNNECESSARY).longValueExact();
    }

    /** "10" 或 "12.5" (%) → 基点 1000 / 1250；0–100。空串返回 0。 */
    public static int bpsFromPercent(Object raw) {
        if (raw == null || String.valueOf(raw).isBlank()) return 0;
        BigDecimal pct = decimal(raw, LangText.of("折扣", "Discount"));
        if (pct.scale() > 2 || pct.signum() < 0 || pct.compareTo(BigDecimal.valueOf(100)) > 0) {
            throw new IllegalArgumentException(LangText.of("折扣须在 0–100% 之间，最多两位小数", "Discount must be 0–100% with at most two decimals"));
        }
        return pct.movePointRight(2).setScale(0, RoundingMode.UNNECESSARY).intValueExact();
    }

    public static long amountCents(int minutes, long rateCentsPerHour) {
        return BigDecimal.valueOf(minutes).multiply(BigDecimal.valueOf(rateCentsPerHour))
                .divide(BigDecimal.valueOf(60), 0, RoundingMode.HALF_UP).longValueExact();
    }

    public static long discountCents(long subtotalCents, int discountBps) {
        return BigDecimal.valueOf(subtotalCents).multiply(BigDecimal.valueOf(discountBps))
                .divide(BigDecimal.valueOf(10_000), 0, RoundingMode.HALF_UP).longValueExact();
    }

    public record Totals(long subtotalCents, int discountBps, long discountCents, Long capCents,
                         long capRemainingCents, long capReductionCents, long totalCents) {}

    /**
     * @param priorBilledCents 本事项此前未作废账单的合计（封顶按事项累计）
     */
    public static Totals totals(long subtotalCents, int discountBps, Long capCents, long priorBilledCents) {
        if (subtotalCents < 0 || discountBps < 0 || discountBps > 10_000 || priorBilledCents < 0) {
            throw new IllegalArgumentException("invalid billing totals input");
        }
        long discount = discountCents(subtotalCents, discountBps);
        long afterDiscount = subtotalCents - discount;
        long remaining = capCents == null ? Long.MAX_VALUE : Math.max(0L, capCents - priorBilledCents);
        long capReduction = Math.max(0L, afterDiscount - remaining);
        return new Totals(subtotalCents, discountBps, discount, capCents,
                capCents == null ? -1L : remaining, capReduction, afterDiscount - capReduction);
    }

    /** 最大余数法按权重分摊 amount；权重全为 0 时全部为 0。结果之和恒等于 amount（权重非全零时）。 */
    public static long[] allocate(long amount, long[] weights) {
        long[] out = new long[weights.length];
        BigDecimal total = BigDecimal.ZERO;
        for (long w : weights) {
            if (w < 0) throw new IllegalArgumentException("negative weight");
            total = total.add(BigDecimal.valueOf(w));
        }
        if (total.signum() == 0 || amount == 0) return out;
        BigDecimal[] remainders = new BigDecimal[weights.length];
        long assigned = 0;
        for (int i = 0; i < weights.length; i++) {
            BigDecimal[] qr = BigDecimal.valueOf(amount).multiply(BigDecimal.valueOf(weights[i])).divideAndRemainder(total);
            out[i] = qr[0].longValueExact();
            remainders[i] = qr[1];
            assigned += out[i];
        }
        long left = amount - assigned;
        while (left > 0) {
            int best = -1;
            for (int i = 0; i < weights.length; i++) {
                if (weights[i] == 0 || remainders[i] == null) continue;
                if (best < 0 || remainders[i].compareTo(remainders[best]) > 0) best = i;
            }
            out[best]++;
            remainders[best] = null;
            left--;
        }
        return out;
    }

    private static BigDecimal decimal(Object raw, String label) {
        String text = String.valueOf(raw).trim().replace(",", "").replace("，", "");
        if (!text.matches("-?\\d{1,12}(\\.\\d+)?")) {
            throw new IllegalArgumentException(LangText.of(label + "格式不正确", label + " is not a valid number"));
        }
        return new BigDecimal(text).stripTrailingZeros().scale() < 0
                ? new BigDecimal(text).setScale(0, RoundingMode.UNNECESSARY)
                : new BigDecimal(text).stripTrailingZeros();
    }
}
