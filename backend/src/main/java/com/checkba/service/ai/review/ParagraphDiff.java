// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ai.review;

import java.text.Normalizer;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 两份文档的段落级差异（tool-system-v2 V7 D1，{@code compare_docx_summary} 的核心）：纯函数，不碰文件、不调模型。
 *
 * <p>做法：先按「去掉全部空白后的文字」对两边段落求最长公共子序列——只差空白、全半角空格、换行的段落
 * 视为相同，不进差异；公共段之间夹着的删除段与新增段，再按文字相似度顺序配对成「修改」，
 * 配不上的分别是「删除」与「新增」。每条差异带上所在条款（最近一个「第X条」标题）。
 */
public final class ParagraphDiff {

    private ParagraphDiff() {
    }

    public enum Kind { ADDED, REMOVED, CHANGED }

    /**
     * @param baseIndex    基准稿段落序号（0 起，仅非空段落计数）；新增时为 -1
     * @param revisedIndex 修订稿段落序号；删除时为 -1
     * @param clause       所在条款标题（如「第三条」）；条款之前的内容为空串
     */
    public record Change(Kind kind, int baseIndex, int revisedIndex, String baseText, String revisedText, String clause) {
    }

    /** 两边中间部分的段落数乘积超过它就放弃求 LCS（约 4000 × 4000 段），由调用方提示改用编辑器内比对。 */
    static final long MAX_CELLS = 16_000_000L;

    private static final Pattern WHITESPACE = Pattern.compile("[\\p{Z}\\s\\u200B\\uFEFF]+");
    private static final String CN_NUM = "[零〇一二三四五六七八九十百千万两0-9０-９]+";
    private static final Pattern CLAUSE_HEAD = Pattern.compile("^\\s*(第\\s*" + CN_NUM + "\\s*[条條])");

    /** 同一对段落相似度达到它才算「修改」，否则当作一删一增。 */
    static final double PAIR_THRESHOLD = 0.4;

    /** 抹掉全部空白后的比较键。 */
    static String key(String text) {
        if (text == null) {
            return "";
        }
        return WHITESPACE.matcher(Normalizer.normalize(text, Normalizer.Form.NFKC)).replaceAll("");
    }

    /** 段落开头的「第X条」，空白折掉；没有返回 null。 */
    static String clauseOf(String text) {
        if (text == null) {
            return null;
        }
        Matcher m = CLAUSE_HEAD.matcher(text);
        return m.find() ? WHITESPACE.matcher(m.group(1)).replaceAll("") : null;
    }

    /** @throws IllegalArgumentException 文档太大，求 LCS 的代价超限 */
    public static List<Change> diff(List<String> base, List<String> revised) {
        List<String> a = nonBlank(base);
        List<String> b = nonBlank(revised);
        String[] ka = a.stream().map(ParagraphDiff::key).toArray(String[]::new);
        String[] kb = b.stream().map(ParagraphDiff::key).toArray(String[]::new);
        String[] clauseA = clauseTrail(a);
        String[] clauseB = clauseTrail(b);

        int pre = 0;
        while (pre < ka.length && pre < kb.length && ka[pre].equals(kb[pre])) {
            pre++;
        }
        int suf = 0;
        while (suf < ka.length - pre && suf < kb.length - pre
                && ka[ka.length - 1 - suf].equals(kb[kb.length - 1 - suf])) {
            suf++;
        }
        int n = ka.length - pre - suf;
        int m = kb.length - pre - suf;
        if ((long) n * m > MAX_CELLS) {
            throw new IllegalArgumentException("too large");
        }

        // lcs[i][j] = ka[pre+i..] 与 kb[pre+j..] 的最长公共子序列长度
        int[][] lcs = new int[n + 1][m + 1];
        for (int i = n - 1; i >= 0; i--) {
            for (int j = m - 1; j >= 0; j--) {
                lcs[i][j] = ka[pre + i].equals(kb[pre + j])
                        ? lcs[i + 1][j + 1] + 1
                        : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
            }
        }

        List<Change> out = new ArrayList<>();
        int i = 0;
        int j = 0;
        List<Integer> gapA = new ArrayList<>();
        List<Integer> gapB = new ArrayList<>();
        while (i < n || j < m) {
            if (i < n && j < m && ka[pre + i].equals(kb[pre + j])) {
                flush(gapA, gapB, a, b, clauseA, clauseB, out);
                i++;
                j++;
            } else if (j >= m || (i < n && lcs[i + 1][j] >= lcs[i][j + 1])) {
                gapA.add(pre + i);
                i++;
            } else {
                gapB.add(pre + j);
                j++;
            }
        }
        flush(gapA, gapB, a, b, clauseA, clauseB, out);
        return out;
    }

    private static void flush(List<Integer> gapA, List<Integer> gapB, List<String> a, List<String> b,
                              String[] clauseA, String[] clauseB, List<Change> out) {
        int bj = 0;
        for (int ai : gapA) {
            int hit = -1;
            double best = PAIR_THRESHOLD;
            for (int k = bj; k < gapB.size(); k++) {
                double s = similarity(key(a.get(ai)), key(b.get(gapB.get(k))));
                if (s >= best) {
                    best = s;
                    hit = k;
                }
            }
            if (hit < 0) {
                out.add(new Change(Kind.REMOVED, ai, -1, a.get(ai), "", clauseA[ai]));
                continue;
            }
            for (int k = bj; k < hit; k++) {
                int bi = gapB.get(k);
                out.add(new Change(Kind.ADDED, -1, bi, "", b.get(bi), clauseB[bi]));
            }
            int bi = gapB.get(hit);
            out.add(new Change(Kind.CHANGED, ai, bi, a.get(ai), b.get(bi), clauseB[bi]));
            bj = hit + 1;
        }
        for (int k = bj; k < gapB.size(); k++) {
            int bi = gapB.get(k);
            out.add(new Change(Kind.ADDED, -1, bi, "", b.get(bi), clauseB[bi]));
        }
        gapA.clear();
        gapB.clear();
    }

    /** 字符二元组 Dice 系数；单字符段落退化为整体相等。 */
    static double similarity(String x, String y) {
        if (x.equals(y)) {
            return 1.0;
        }
        if (x.length() < 2 || y.length() < 2) {
            return 0.0;
        }
        Set<String> gx = bigrams(x);
        Set<String> gy = bigrams(y);
        int common = 0;
        for (String g : gx) {
            if (gy.contains(g)) {
                common++;
            }
        }
        return 2.0 * common / (gx.size() + gy.size());
    }

    private static Set<String> bigrams(String s) {
        Set<String> out = new HashSet<>();
        for (int i = 0; i + 1 < s.length(); i++) {
            out.add(s.substring(i, i + 2));
        }
        return out;
    }

    private static List<String> nonBlank(List<String> paragraphs) {
        List<String> out = new ArrayList<>();
        if (paragraphs != null) {
            for (String p : paragraphs) {
                if (p != null && !key(p).isEmpty()) {
                    out.add(p);
                }
            }
        }
        return out;
    }

    /** 每个段落所在的条款：最近一个「第X条」标题（标题段自己也算）。 */
    private static String[] clauseTrail(List<String> paragraphs) {
        String[] out = new String[paragraphs.size()];
        String current = "";
        for (int i = 0; i < out.length; i++) {
            String head = clauseOf(paragraphs.get(i));
            if (head != null) {
                current = head;
            }
            out[i] = current;
        }
        return out;
    }
}
