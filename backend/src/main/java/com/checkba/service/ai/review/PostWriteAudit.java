// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ai.review;

import com.checkba.service.ai.review.ContractStructureAudit.Finding;
import com.checkba.service.ai.review.ContractStructureAudit.Paragraph;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * 多处修改收尾时由系统做的机械核对（gap P5）：比较本轮第一次写入前后的全文，只看改动段落及前后各
 * {@link #NEIGHBOURS} 段，只查三件事——
 * <ol>
 *   <li>编号断裂：{@link ContractStructureAudit} 的编号检查，只报<b>本轮新出现</b>的发现；</li>
 *   <li>新建出的空段落 / 只有编号没有内容的标题；</li>
 *   <li>新出现的重复段落或重复句子。</li>
 * </ol>
 *
 * <p>为什么要比前后两份：真实合同里本来就有编号跳号、空行、重复的套话，拿改后全文直接查，
 * 用户从没让动的老问题会被当成本轮造成的，模型再去「顺手修」就成了越权改稿。所以每一项都以
 * 「改前没有、改后有」为准，宁可漏报也不误报。纯函数，不读编辑器、不调模型。
 */
public final class PostWriteAudit {

    private PostWriteAudit() {
    }

    /** 改动段落前后各看几段。 */
    public static final int NEIGHBOURS = 2;
    /** 中段 LCS 的格子上限；超过就把整个中段当作改动（只会多看，不会多报：每项仍按前后差异判）。 */
    static final long LCS_CELL_LIMIT = 1_000_000L;
    static final int MIN_DUP_PARAGRAPH = 8;
    static final int MIN_DUP_SENTENCE = 10;

    public enum Kind { NUMBERING, EMPTY_PARAGRAPH, EMPTY_HEADING, DUPLICATE }

    /** paragraph = 改后全文里的段号（0 基，与 doc_get_document_text 同口径）。 */
    public record Issue(Kind kind, int paragraph, String excerpt, String detail) {}

    /** changed = 改后全文里被判为新增/改动的段数；deletions = 被删掉的段数。 */
    public record Result(List<Issue> issues, int changed, int deletions) {
        public boolean clean() {
            return issues.isEmpty();
        }
    }

    private static final String CN = "一二三四五六七八九十百千零〇";
    private static final Pattern LEADING_LABEL = Pattern.compile(
            "^(?:第[" + CN + "0-9１-９]+[条條章节節]|[一二三四五六七八九十]{1,3}[、．.]|\\d{1,3}(?:\\.\\d{1,3})+\\.?|\\d{1,3}[.、．]"
                    + "|[（(][" + CN + "a-zA-Z0-9]{1,3}[)）])");
    private static final Pattern LABEL_ONLY = Pattern.compile(LEADING_LABEL.pattern() + "[:：]?$");
    /** 条款小标题「付款：」：比句子时去掉，否则段首句永远和正文里的同一句对不上。 */
    private static final Pattern CLAUSE_TITLE = Pattern.compile("^[^：:。；;，,]{1,10}[：:]");
    private static final Pattern SENTENCE_END = Pattern.compile("[。；;！!？?]");
    private static final Pattern SEGMENT_REF = Pattern.compile("段 ?\\d+");

    public static Result check(List<Paragraph> before, List<Paragraph> after) {
        List<String> b = before.stream().map(p -> nz(p.text()).strip()).toList();
        List<String> a = after.stream().map(p -> nz(p.text()).strip()).toList();
        boolean[] changed = new boolean[a.size()];
        List<Integer> deletionPoints = new ArrayList<>();
        int deletions = diff(b, a, changed, deletionPoints);

        boolean[] window = new boolean[a.size()];
        int changedCount = 0;
        for (int i = 0; i < a.size(); i++) {
            if (!changed[i]) continue;
            changedCount++;
            mark(window, i - NEIGHBOURS, i + NEIGHBOURS);
        }
        for (int k : deletionPoints) mark(window, k - NEIGHBOURS, k + NEIGHBOURS - 1);

        List<Issue> issues = new ArrayList<>();
        if (changedCount == 0 && deletions == 0) return new Result(issues, 0, 0);
        numbering(before, after, window, issues);
        empties(before, after, a, changed, issues);
        duplicates(b, a, changed, issues);
        return new Result(issues, changedCount, deletions);
    }

    // ------------------------------------------------------------------ 差异

    /** 标出改后全文里不在 LCS 上的段落；返回被删段数，deletionPoints 记下删除处在改后全文的位置。 */
    private static int diff(List<String> b, List<String> a, boolean[] changed, List<Integer> deletionPoints) {
        int pre = 0;
        while (pre < b.size() && pre < a.size() && b.get(pre).equals(a.get(pre))) pre++;
        int suf = 0;
        while (suf < b.size() - pre && suf < a.size() - pre
                && b.get(b.size() - 1 - suf).equals(a.get(a.size() - 1 - suf))) suf++;
        int n = b.size() - pre - suf, m = a.size() - pre - suf;
        if (n == 0) {
            for (int j = 0; j < m; j++) changed[pre + j] = true;
            return 0;
        }
        if (m == 0) {
            deletionPoints.add(pre);
            return n;
        }
        if ((long) (n + 1) * (m + 1) > LCS_CELL_LIMIT) {
            for (int j = 0; j < m; j++) changed[pre + j] = true;
            deletionPoints.add(pre);
            return Math.max(0, n - m);
        }
        int[][] dp = new int[n + 1][m + 1];
        for (int i = n - 1; i >= 0; i--) {
            for (int j = m - 1; j >= 0; j--) {
                dp[i][j] = b.get(pre + i).equals(a.get(pre + j)) ? dp[i + 1][j + 1] + 1
                        : Math.max(dp[i + 1][j], dp[i][j + 1]);
            }
        }
        int i = 0, j = 0, deleted = 0;
        while (i < n || j < m) {
            if (i < n && j < m && b.get(pre + i).equals(a.get(pre + j))) {
                i++;
                j++;
            } else if (j < m && (i == n || dp[i][j + 1] >= dp[i + 1][j])) {
                changed[pre + j] = true;
                j++;
            } else {
                deleted++;
                deletionPoints.add(pre + j);
                i++;
            }
        }
        return deleted;
    }

    private static void mark(boolean[] window, int from, int to) {
        for (int i = Math.max(0, from); i <= Math.min(window.length - 1, to); i++) window[i] = true;
    }

    // ------------------------------------------------------------------ 1. 编号

    private static void numbering(List<Paragraph> before, List<Paragraph> after, boolean[] window, List<Issue> issues) {
        Map<String, Integer> old = new HashMap<>();
        for (Finding f : ContractStructureAudit.run(before, List.of(), null).numbering) {
            old.merge(numberingKey(f, before), 1, Integer::sum);
        }
        Map<Integer, Integer> position = positions(after);
        for (Finding f : ContractStructureAudit.run(after, List.of(), null).numbering) {
            Integer pos = position.get(f.paragraph());
            if (pos == null || !window[pos]) continue;
            String key = numberingKey(f, after);
            Integer left = old.get(key);
            if (left != null && left > 0) {
                old.put(key, left - 1);
                continue;
            }
            issues.add(new Issue(Kind.NUMBERING, pos, excerpt(after.get(pos).text()), f.message()));
        }
    }

    private static String numberingKey(Finding f, List<Paragraph> paras) {
        Integer pos = positions(paras).get(f.paragraph());
        String text = pos == null ? "" : nz(paras.get(pos).text()).strip();
        return SEGMENT_REF.matcher(nz(f.message())).replaceAll("段 #") + "|" + text;
    }

    private static Map<Integer, Integer> positions(List<Paragraph> paras) {
        Map<Integer, Integer> m = new HashMap<>();
        for (int i = 0; i < paras.size(); i++) m.putIfAbsent(paras.get(i).index(), i);
        return m;
    }

    // ------------------------------------------------------------------ 2. 空段落 / 空标题

    private static void empties(List<Paragraph> before, List<Paragraph> after, List<String> a,
                                boolean[] changed, List<Issue> issues) {
        long blanksBefore = before.stream().filter(p -> blank(p.text())).count();
        long blanksAfter = after.stream().filter(p -> blank(p.text())).count();
        boolean spacers = false, doubleBefore = false;
        for (int i = 1; i < before.size() - 1; i++) {
            if (blank(before.get(i).text())) {
                spacers = true;
                if (blank(before.get(i - 1).text()) || blank(before.get(i + 1).text())) doubleBefore = true;
            }
        }
        for (int i = 0; i < a.size(); i++) {
            if (!changed[i]) continue;
            Paragraph p = after.get(i);
            if (blank(p.text())) {
                if (Boolean.TRUE.equals(p.numbering() == null ? null : p.numbering().hasLabel())
                        && p.numbering().known() && p.numbering().label() != null && !p.numbering().label().isBlank()) {
                    issues.add(new Issue(Kind.EMPTY_HEADING, i, "", "自动编号「" + p.numbering().label()
                            + "」后面没有内容"));
                    continue;
                }
                // 末尾的空段多为引擎自带，开头的空段多为版头留白，都不报
                if (i == 0 || i == a.size() - 1 || blanksAfter <= blanksBefore) continue;
                boolean adjacentBlank = blank(after.get(i - 1).text()) || blank(after.get(i + 1).text());
                if (!spacers || (adjacentBlank && !doubleBefore)) {
                    issues.add(new Issue(Kind.EMPTY_PARAGRAPH, i, "", "新出现了一个空段落"));
                }
                continue;
            }
            String t = a.get(i);
            // 「第一条」单独成段、正文另起一段是常见版式（evidence-demo 补充协议即是），
            // 所以只有编号的段落要后面紧跟下一条（或到文末）才算空标题
            if (LABEL_ONLY.matcher(t.replaceAll("\\s+", "")).matches() && startsNextClauseOrEnds(a, i)) {
                issues.add(new Issue(Kind.EMPTY_HEADING, i, excerpt(t), "只有编号「" + t + "」，后面没有正文"));
            } else if ((t.endsWith("：") || t.endsWith(":")) && LEADING_LABEL.matcher(t).find()
                    && startsNextClauseOrEnds(a, i)) {
                issues.add(new Issue(Kind.EMPTY_HEADING, i, excerpt(t), "条款标题以冒号结尾，后面没有正文"));
            }
        }
    }

    private static boolean startsNextClauseOrEnds(List<String> a, int i) {
        for (int j = i + 1; j < a.size(); j++) {
            if (a.get(j).isBlank()) continue;
            return ContractStructureAudit.P_TIAO.matcher(a.get(j)).find();
        }
        return true;
    }

    // ------------------------------------------------------------------ 3. 重复

    private static void duplicates(List<String> b, List<String> a, boolean[] changed, List<Issue> issues) {
        Map<String, Integer> paraBefore = counts(b, false), paraAfter = counts(a, false);
        Map<String, Integer> sentBefore = counts(b, true), sentAfter = counts(a, true);
        Set<String> reported = new LinkedHashSet<>();
        for (int i = 0; i < a.size(); i++) {
            if (!changed[i]) continue;
            String norm = squash(a.get(i));
            if (norm.length() >= MIN_DUP_PARAGRAPH && paraAfter.getOrDefault(norm, 0) >= 2
                    && paraAfter.get(norm) > paraBefore.getOrDefault(norm, 0)) {
                if (reported.add("P|" + norm)) {
                    issues.add(new Issue(Kind.DUPLICATE, i, excerpt(a.get(i)),
                            "整段与段 " + otherIndex(a, i, norm) + " 相同"));
                }
                continue;
            }
            // 句子只在同一段里比：同一条但书加进几个条款（哪怕相邻）是正常起草，真实夹具上实测误报过；
            // 改坏了的重复（锚点替换把旧句留在新句旁边、同一处插了两遍）都落在同一段里。整段重复由上面管。
            Map<String, Integer> near = new HashMap<>();
            for (String s : sentences(a.get(i))) near.merge(s, 1, Integer::sum);
            for (String s : sentences(a.get(i))) {
                if (near.getOrDefault(s, 0) >= 2 && sentAfter.getOrDefault(s, 0) > sentBefore.getOrDefault(s, 0)
                        && reported.add("S|" + s)) {
                    issues.add(new Issue(Kind.DUPLICATE, i, excerpt(s), "这句话在同一段里重复出现（全文 "
                            + sentAfter.get(s) + " 次，改前 " + sentBefore.getOrDefault(s, 0) + " 次）"));
                }
            }
        }
    }

    private static int otherIndex(List<String> a, int self, String norm) {
        for (int j = 0; j < a.size(); j++) if (j != self && squash(a.get(j)).equals(norm)) return j;
        return -1;
    }

    private static Map<String, Integer> counts(List<String> texts, boolean bySentence) {
        Map<String, Integer> m = new HashMap<>();
        for (String t : texts) {
            if (bySentence) {
                for (String s : sentences(t)) m.merge(s, 1, Integer::sum);
            } else {
                String n = squash(t);
                if (!n.isEmpty()) m.merge(n, 1, Integer::sum);
            }
        }
        return m;
    }

    /** 去掉段首条款编号后按句末标点切句，只留够长的句子（短句如「甲方（盖章）」重复是常态）。 */
    static List<String> sentences(String text) {
        String body = LEADING_LABEL.matcher(squash(text)).replaceFirst("");
        body = CLAUSE_TITLE.matcher(body).replaceFirst("");
        List<String> out = new ArrayList<>();
        for (String s : SENTENCE_END.split(body)) {
            if (s.length() >= MIN_DUP_SENTENCE) out.add(s);
        }
        return out;
    }

    // ------------------------------------------------------------------ 工具

    private static String nz(String s) {
        return s == null ? "" : s;
    }

    private static String squash(String s) {
        return nz(s).replaceAll("[\\s\\u00a0\\u3000\\u200b\\ufeff]+", "");
    }

    private static boolean blank(String s) {
        return squash(s).isEmpty();
    }

    static String excerpt(String s) {
        String t = nz(s).strip();
        return t.length() <= 40 ? t : t.substring(0, 40) + "…";
    }
}
