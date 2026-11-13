// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.aiworkdeck.plugins.pitch;

import com.fasterxml.jackson.databind.JsonNode;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** 报价计算：一律整数分，金额字符串只接受数字（可带千分位逗号和两位小数）。 */
final class Quote {
    record Line(String no, String item, String basis, long cents) {}
    record Result(String name, List<Line> lines, long subtotal, long discount, long capCut, long tax,
                  long total, boolean taxIncluded, String note, String upper) {}

    private Quote() {}

    static Result compute(JsonNode q, boolean zh) {
        if (q == null || !q.isObject()) throw new PitchTools.Failure("quote_missing");
        Map<String, Long> rates = new LinkedHashMap<>();
        q.path("rates").fields().forEachRemaining(e -> rates.put(e.getKey().trim(), cents(e.getValue().asText(), e.getKey())));
        List<Line> lines = new ArrayList<>();
        long subtotal = 0;
        int n = 0;
        for (JsonNode it : q.path("items")) {
            String label = PitchTools.text(it, "label");
            long amount;
            String basis;
            if ("hourly".equals(PitchTools.text(it, "kind"))) {
                String title = PitchTools.text(it, "title");
                Long rate = rates.get(title);
                if (rate == null) throw new PitchTools.Failure("quote_rate_missing", title);
                BigDecimal hours = decimal(PitchTools.text(it, "hours"), label);
                amount = BigDecimal.valueOf(rate).multiply(hours).setScale(0, RoundingMode.HALF_UP).longValueExact();
                basis = zh ? title + " " + money(rate, false) + " 元/小时 × " + hours.stripTrailingZeros().toPlainString() + " 小时"
                        : title + " RMB " + money(rate, false) + "/hour × " + hours.stripTrailingZeros().toPlainString() + " hours";
            } else {
                amount = cents(PitchTools.text(it, "amount"), label);
                basis = zh ? "固定费用" : "Fixed fee";
            }
            subtotal = Math.addExact(subtotal, amount);
            lines.add(new Line(String.valueOf(++n), label, basis, amount));
        }
        if (lines.isEmpty()) throw new PitchTools.Failure("quote_empty");
        if (subtotal >= MAX_CENTS) throw new PitchTools.Failure("bad_amount", "subtotal");
        BigDecimal pct = optionalDecimal(PitchTools.text(q, "discountPct"), "discountPct");
        if (pct.signum() < 0 || pct.compareTo(BigDecimal.valueOf(100)) >= 0) throw new PitchTools.Failure("bad_amount", "discountPct");
        long discount = BigDecimal.valueOf(subtotal).multiply(pct).divide(BigDecimal.valueOf(100), 0, RoundingMode.HALF_UP).longValueExact();
        long after = subtotal - discount;
        String capText = PitchTools.text(q, "capAmount");
        long capCut = 0;
        if (!capText.isEmpty()) {
            long cap = cents(capText, "capAmount");
            if (cap > 0 && after > cap) { capCut = after - cap; after = cap; }
        }
        BigDecimal rate = optionalDecimal(PitchTools.text(q, "taxRatePct"), "taxRatePct");
        if (rate.compareTo(BigDecimal.valueOf(100)) > 0) throw new PitchTools.Failure("bad_amount", "taxRatePct");
        boolean included = !q.has("taxIncluded") || q.path("taxIncluded").asBoolean(true);
        long tax;
        long total;
        if (included) {
            total = after;
            tax = rate.signum() == 0 ? 0 : total - BigDecimal.valueOf(total).multiply(BigDecimal.valueOf(100))
                    .divide(BigDecimal.valueOf(100).add(rate), 0, RoundingMode.HALF_UP).longValueExact();
        } else {
            tax = BigDecimal.valueOf(after).multiply(rate).divide(BigDecimal.valueOf(100), 0, RoundingMode.HALF_UP).longValueExact();
            total = after + tax;
        }
        if (total >= MAX_CENTS) throw new PitchTools.Failure("bad_amount", "total");
        List<String> note = new ArrayList<>();
        String pctText = pct.stripTrailingZeros().toPlainString();
        String rateText = rate.stripTrailingZeros().toPlainString();
        if (discount > 0) note.add(zh ? "按标准收费优惠 " + pctText + "%（优惠 " + money(discount, true) + "）"
                : pctText + "% discount on standard fees (" + money(discount, true) + ")");
        if (capCut > 0) note.add(zh ? "费用封顶 " + money(after, true) : "Fees capped at " + money(after, true));
        if (rate.signum() > 0) note.add(included
                ? (zh ? "以上报价已含 " + rateText + "% 增值税（税额 " + money(tax, true) + "）" : "Includes " + rateText + "% VAT (" + money(tax, true) + ")")
                : (zh ? "另加 " + rateText + "% 增值税 " + money(tax, true) : "Plus " + rateText + "% VAT " + money(tax, true)));
        String extra = PitchTools.text(q, "note");
        if (!extra.isEmpty()) note.add(extra);
        return new Result(PitchTools.text(q, "name"), lines, subtotal, discount, capCut, tax, total, included,
                String.join(zh ? "；" : "; ", note), zh ? upper(total) : money(total, true));
    }

    /** 报价表的行：条目 + 小计/优惠/封顶/税额，表格自己能对上合计。 */
    static List<Map<String, String>> rows(Result r, boolean zh) {
        List<Map<String, String>> out = new ArrayList<>();
        for (Line l : r.lines()) out.add(row(l.no(), l.item(), l.basis(), money(l.cents(), true)));
        boolean adjusted = r.discount() > 0 || r.capCut() > 0 || (!r.taxIncluded() && r.tax() > 0);
        if (adjusted) out.add(row("", zh ? "小计" : "Subtotal", "", money(r.subtotal(), true)));
        if (r.discount() > 0) out.add(row("", zh ? "优惠" : "Discount", "", "-" + money(r.discount(), true)));
        if (r.capCut() > 0) out.add(row("", zh ? "封顶调整" : "Cap adjustment", "", "-" + money(r.capCut(), true)));
        if (!r.taxIncluded() && r.tax() > 0) out.add(row("", zh ? "增值税" : "VAT", "", money(r.tax(), true)));
        return out;
    }

    private static Map<String, String> row(String no, String item, String basis, String amount) {
        Map<String, String> m = new LinkedHashMap<>();
        m.put("序号", no); m.put("项目", item); m.put("计算", basis); m.put("金额", amount);
        return m;
    }

    static long cents(String raw, String label) {
        BigDecimal d = decimal(raw, label);
        if (d.signum() < 0 || d.scale() > 2) throw new PitchTools.Failure("bad_amount", label);
        return d.movePointRight(2).longValueExact();
    }

    private static BigDecimal optionalDecimal(String raw, String label) {
        return raw == null || raw.isBlank() ? BigDecimal.ZERO : decimal(raw, label);
    }

    private static BigDecimal decimal(String raw, String label) {
        String s = raw == null ? "" : raw.replace(",", "").replace("，", "").trim();
        if (!s.matches("\\d{1,13}(\\.\\d{1,4})?")) throw new PitchTools.Failure("bad_amount", label);
        return new BigDecimal(s);
    }

    static String money(long cents, boolean symbol) {
        String s = String.format(java.util.Locale.ROOT, "%,d.%02d", cents / 100, cents % 100);
        return symbol ? "¥" + s : s;
    }

    /** 大写金额只写到千亿位：合计须小于 1 万亿元。 */
    static final long MAX_CENTS = 1_000_000_000_000L * 100;

    private static final String DIGITS = "零壹贰叁肆伍陆柒捌玖";
    private static final String[] SMALL = {"", "拾", "佰", "仟"};
    private static final String[] BIG = {"", "万", "亿", "万亿"};

    /** 人民币大写：360000.00 → 人民币叁拾陆万元整。 */
    static String upper(long cents) {
        long yuan = cents / 100;
        int jiao = (int) (cents / 10 % 10);
        int fen = (int) (cents % 10);
        StringBuilder sb = new StringBuilder();
        if (yuan == 0) {
            if (jiao == 0 && fen == 0) return "人民币零元整";
        } else {
            String digits = Long.toString(yuan);
            int len = digits.length();
            boolean pendingZero = false;
            for (int i = 0; i < len; i++) {
                int d = digits.charAt(i) - '0';
                int pos = len - 1 - i;
                if (d == 0) {
                    pendingZero = true;
                } else {
                    if (pendingZero && sb.length() > 0) sb.append('零');
                    pendingZero = false;
                    sb.append(DIGITS.charAt(d)).append(SMALL[pos % 4]);
                }
                if (pos % 4 == 0 && pos > 0) {
                    // 本组（4 位）有非零数字才写「万/亿」
                    if (hasNonZero(digits, i - 3, i)) sb.append(BIG[pos / 4]);
                }
            }
            sb.append('元');
        }
        if (jiao == 0 && fen == 0) return "人民币" + sb + "整";
        if (jiao > 0) sb.append(DIGITS.charAt(jiao)).append('角');
        else if (yuan > 0) sb.append('零');
        // 到角为止的可不写「整」（《支付结算办法》附件），这里统一不写
        if (fen > 0) sb.append(DIGITS.charAt(fen)).append('分');
        return "人民币" + sb;
    }

    private static boolean hasNonZero(String digits, int from, int to) {
        for (int i = Math.max(0, from); i <= to; i++) if (digits.charAt(i) != '0') return true;
        return false;
    }
}
