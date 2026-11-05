// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.legal.cn;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

/**
 * 一处中国法律条文引用的结构化表示，及其离线解析（纯函数，不碰 Spring、IO 与网络）。
 *
 * <pre>
 * 《民法典》第五百七十七条第一款      → 民法典 / 577 / 款 1
 * 民法典577条                         → 民法典 / 577
 * 《公司法》(2023修订)第21条          → 公司法 / 2023 修订 / 21
 * 《劳动合同法》第三十九条第（二）项   → 劳动合同法 / 39 / 项 2
 * 《民法典》第五百七十七条、第五百八十四条 → 两条引用，后者继承法名
 * </pre>
 *
 * <p>只做<b>形式</b>识别与规范化：不判断条号是否存在、法律是否现行有效、引用是否得当
 * ——那些需要权威法规库（见 docs/plans/stella-alignment/cn-legal-data.md）。
 * 书名号里的标题须是法规样式（以法/条例/规定/解释……结尾）或在 {@link LawAliases} 表内，
 * 「《买卖合同》第三条」这类合同条款引用不算法条。没有书名号时只认表内法律名，
 * 免得「方法第三条」被当成法条。
 *
 * @param raw           原文片段（列举中的后续条只含自己那一段，如「第五百八十四条」）
 * @param start         原文起点（含）
 * @param end           原文终点（不含）
 * @param lawTitle      原文写的法名（去书名号与版本括注）
 * @param lawShortName  规范简称；不在别名表内时等于 {@code lawTitle}
 * @param lawFullName   全称；不在别名表内时为 {@code null}
 * @param editionYear   版本年份（「2023修订」→ 2023），未写为 {@code null}
 * @param editionKind   修订 / 修正 / 修改，未写为 {@code null}
 * @param article       条
 * @param articleSub    「之一」的序号，没有为 0
 * @param paragraph     款，没有为 {@code null}
 * @param item          项，没有为 {@code null}
 * @param subItem       目，没有为 {@code null}
 */
public record LawCitation(String raw, int start, int end,
                          String lawTitle, String lawShortName, String lawFullName,
                          Integer editionYear, String editionKind,
                          int article, int articleSub,
                          Integer paragraph, Integer item, Integer subItem) {

    private static final int MAX_ARTICLE = 9999;

    private static final String NUM = "[0-9０-９零〇一二三四五六七八九十百千万两壹贰叁肆伍陆柒捌玖拾佰仟]{1,12}";

    private static final String EDITION = "[(（]\\s*([0-9０-９]{4}|[〇零一二三四五六七八九]{4})\\s*年?\\s*"
            + "(修订|修正|修改)?\\s*(?:版|本)?\\s*[)）]";

    /** 条之后的款/项/目（「第」可省：「577条1款」）。项可带括号：「第（二）项」。 */
    private static final String BELOW_ARTICLE =
            "(?:\\s*第?\\s*(?<para>" + NUM + ")\\s*款)?"
                    + "(?:\\s*第?\\s*[(（]?\\s*(?<item>" + NUM + ")\\s*[)）]?\\s*项)?"
                    + "(?:\\s*第?\\s*(?<sub>" + NUM + ")\\s*目)?";

    private static final String ARTICLE =
            "第?\\s*(?<art>" + NUM + ")\\s*条(?:\\s*之\\s*(?<artSub>" + NUM + "))?" + BELOW_ARTICLE;

    private static final Pattern CITATION = Pattern.compile(
            "(?:《(?<title>[^《》\\r\\n]{1,60})》|(?<bare>" + bareNames() + "))"
                    + "\\s*(?:" + EDITION + ")?"
                    + "\\s*(?:的|中)?\\s*" + ARTICLE);

    private static final String LIST_SEP = "\\s*(?:、|以及|及|和|与)\\s*";

    /** 列举中的后续条：「、第五百八十四条」。必须带「第」，免得吞掉无关数字。 */
    private static final Pattern NEXT_ARTICLE = Pattern.compile(
            LIST_SEP + "(?<head>第)\\s*(?<art>" + NUM + ")\\s*条(?:\\s*之\\s*(?<artSub>" + NUM + "))?" + BELOW_ARTICLE);

    /** 列举中的后续款：「第一款、第二款」，继承条号。 */
    private static final Pattern NEXT_PARAGRAPH = Pattern.compile(
            LIST_SEP + "(?<head>第)\\s*(?<para>" + NUM + ")\\s*款"
                    + "(?:\\s*第?\\s*[(（]?\\s*(?<item>" + NUM + ")\\s*[)）]?\\s*项)?"
                    + "(?:\\s*第?\\s*(?<sub>" + NUM + ")\\s*目)?");

    private static final Pattern TITLE_WITH_EDITION = Pattern.compile("^(.*?)\\s*" + EDITION + "$");

    private static final Pattern LAW_LIKE_TITLE = Pattern.compile(
            ".*(?:法|法典|条例|规定|办法|细则|解释|决定|规则|意见|纪要|批复|通知|准则)$");

    private static String bareNames() {
        return LawAliases.namesLongestFirst().stream().map(Pattern::quote).collect(Collectors.joining("|"));
    }

    /** 文本中全部条文引用，按出现顺序。{@code null} 或空串返回空表。 */
    public static List<LawCitation> findAll(String text) {
        List<LawCitation> out = new ArrayList<>();
        if (text == null || text.isEmpty()) return out;
        Matcher m = CITATION.matcher(text);
        int from = 0;
        while (from < text.length() && m.find(from)) {
            from = m.end();
            Law law = law(m);
            LawCitation first = law == null ? null : build(text, m.start(), m.end(), law, m, null);
            if (first == null) {
                from = m.start() + 1;
                continue;
            }
            out.add(first);
            LawCitation prev = first;
            while (true) {
                LawCitation next = continuation(text, prev, law);
                if (next == null) break;
                out.add(next);
                prev = next;
            }
            from = prev.end();
        }
        return out;
    }

    /**
     * 整串恰好是一处引用时返回它（首尾空白、句末标点与「的规定」不计），否则 {@code null}。
     * 裸条号「第五百七十七条」没有法名，返回 {@code null}。
     */
    public static LawCitation parse(String text) {
        if (text == null) return null;
        String s = text.strip().replaceFirst("(?:的?规定)?[。；;，,]?$", "");
        List<LawCitation> all = findAll(s);
        if (all.size() != 1) return null;
        LawCitation c = all.get(0);
        return c.start() == 0 && c.end() == s.length() ? c : null;
    }

    /** 「577」「20.1」——与北大法宝 {@code adjust_provisions} 的 {@code article_number} 同形。 */
    public String articleNumber() {
        return articleSub == 0 ? String.valueOf(article) : article + "." + articleSub;
    }

    /**
     * 规范写法：全称（表外法律用原标题）+ 版本括注 + 中文条款项目号。
     * 「民法典577条1款」→「《中华人民共和国民法典》第五百七十七条第一款」。
     */
    public String normalized() {
        StringBuilder sb = new StringBuilder("《").append(lawFullName != null ? lawFullName : lawTitle).append('》');
        if (editionYear != null) {
            sb.append('（').append(editionYear).append('年');
            if (editionKind != null) sb.append(editionKind);
            sb.append('）');
        }
        sb.append('第').append(ChineseNumerals.toChinese(article)).append('条');
        if (articleSub > 0) sb.append('之').append(ChineseNumerals.toChinese(articleSub));
        if (paragraph != null) sb.append('第').append(ChineseNumerals.toChinese(paragraph)).append('款');
        if (item != null) sb.append('第').append(ChineseNumerals.toChinese(item)).append('项');
        if (subItem != null) sb.append('第').append(ChineseNumerals.toChinese(subItem)).append('目');
        return sb.toString();
    }

    // ---- 内部 ----

    private record Law(String title, String shortName, String fullName, Integer editionYear, String editionKind) {
    }

    private static Law law(Matcher m) {
        Integer year = null;
        String kind = null;
        if (m.group(3) != null) {           // EDITION 的两个组紧跟 title/bare 之后
            year = ChineseNumerals.parse(m.group(3)).intValue();
            kind = m.group(4);
        }
        String title;
        if (m.group("title") != null) {
            title = LawAliases.compact(m.group("title"));
            Matcher e = TITLE_WITH_EDITION.matcher(title);
            if (e.matches()) {
                title = e.group(1);
                if (year == null) {
                    year = ChineseNumerals.parse(e.group(2)).intValue();
                    kind = e.group(3);
                }
            }
            if (title.isEmpty()) return null;
            if (!LawAliases.isKnown(title) && !LAW_LIKE_TITLE.matcher(title).matches()) return null;
        } else {
            title = m.group("bare");
        }
        String shortName = LawAliases.canonicalShort(title);
        return new Law(title, shortName != null ? shortName : title, LawAliases.fullName(title), year, kind);
    }

    private static LawCitation continuation(String text, LawCitation prev, Law law) {
        Matcher a = NEXT_ARTICLE.matcher(text).region(prev.end(), text.length());
        if (a.lookingAt()) return build(text, a.start("head"), a.end(), law, a, null);
        if (prev.paragraph() == null) return null;
        Matcher p = NEXT_PARAGRAPH.matcher(text).region(prev.end(), text.length());
        if (p.lookingAt()) return build(text, p.start("head"), p.end(), law, p, prev);
        return null;
    }

    /** {@code inherit} 非空时是「、第二款」这种只给款的列举项，条号沿用它的。 */
    private static LawCitation build(String text, int start, int end, Law law, Matcher m, LawCitation inherit) {
        int article;
        int articleSub;
        if (inherit != null) {
            article = inherit.article();
            articleSub = inherit.articleSub();
        } else {
            Long art = ChineseNumerals.parse(m.group("art"));
            if (art == null || art < 1 || art > MAX_ARTICLE) return null;
            article = art.intValue();
            String sub = m.group("artSub");
            Long subNum = sub == null ? Long.valueOf(0) : ChineseNumerals.parse(sub);
            if (subNum == null || (sub != null && subNum < 1)) return null;
            articleSub = subNum.intValue();
        }
        Integer para = optional(m, "para");
        Integer item = optional(m, "item");
        Integer subItem = optional(m, "sub");
        if (para != null && para < 0 || item != null && item < 0 || subItem != null && subItem < 0) return null;
        return new LawCitation(text.substring(start, end), start, end,
                law.title(), law.shortName(), law.fullName(), law.editionYear(), law.editionKind(),
                article, articleSub, para, item, subItem);
    }

    /** 可选组：没写为 null；写了但认不出（「第若干款」进不了 NUM，这里只防 0）返回 -1 让调用方整条作废。 */
    private static Integer optional(Matcher m, String group) {
        String g = m.group(group);
        if (g == null) return null;
        Long v = ChineseNumerals.parse(g);
        return v == null || v < 1 || v > MAX_ARTICLE ? -1 : v.intValue();
    }
}
