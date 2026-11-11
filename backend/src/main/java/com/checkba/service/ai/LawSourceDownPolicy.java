// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ai;

import com.checkba.service.LangText;
import com.checkba.service.ai.tools.LegalTools;

import java.util.Set;
import java.util.regex.Pattern;

/**
 * 法源不可用时的收口策略（gap P8）。一轮运行里只要有法宝工具回了
 * {@link LegalTools#VENDOR_UNAVAILABLE_MARKER}，就进入「法源不可用」态：
 * <ul>
 *   <li><b>替代查询封顶</b>：此后 {@code search_web} / {@code browse_url} 合计最多再执行
 *       {@link #MAX_WEB_LOOKUPS_AFTER_DOWN} 次，超出的调用不执行，回一句「已用满，按已有资料作答并标未核实」。
 *       编排器在 {@code dispatchTool} 里拦（原生与 XML 两条工具循环共用），不靠模型自觉。</li>
 *   <li><b>收尾提醒</b>：最终回答提到具体条文（第N条 / Article N）却没有「未核实」类标注、
 *       或自称已核实时，追加一次隐形提醒让模型补说明；每轮最多一次，不会循环。</li>
 * </ul>
 *
 * <p><b>为什么是 2 次</b>：一次搜索定位权威页面（如 flk.npc.gov.cn）+ 一次打开阅读，是能拿到原文的最小组合；
 * 实测失败形态是 deepseek 在法源不可用后连续 8–10 轮 search_web/browse_url，并在其中一次编造民法典第1082条
 * 原文后声称「已全部核实」。t09（tasks-10）要求整轮 ≤6 轮：读文件 + 法宝失败 + 2 次替代查询 + 收尾正好放得下。
 *
 * <p>不新增任何出站目的地：只限制既有网页工具的次数，第二法源不在本策略范围内。
 * 已知不覆盖：{@code run_python} 里的 {@code default_api.search_web/browse_url} 不经 dispatchTool；
 * 起跑时法宝就未下发（未连账户）的轮次没有不可用标记，不进入此态。
 */
final class LawSourceDownPolicy {

    /** 法源不可用之后，search_web + browse_url 合计还能执行的次数。 */
    static final int MAX_WEB_LOOKUPS_AFTER_DOWN = 2;

    static final Set<String> WEB_LOOKUP_TOOLS = Set.of("search_web", "browse_url");

    /** 回答里引用了具体条文。 */
    private static final Pattern STATUTE_CITATION = Pattern.compile(
            "第\\s*[0-9０-９一二三四五六七八九十百千零〇两]+\\s*条|(?i)\\barticle\\s+\\d+");
    /** 已有「未核实」类标注。 */
    private static final Pattern UNVERIFIED_MARK = Pattern.compile(
            "未核实|待核实|未经核实|无法核实|未能核实|尚未核实|需核实|需要核实|有待核实|请核实|建议核实|非权威来源"
                    + "|(?i)unverified|not\\s+(?:been\\s+)?verified|to\\s+be\\s+verified|non-authoritative");
    /** 自称已核实。 */
    private static final Pattern VERIFIED_CLAIM = Pattern.compile(
            "(?:已|均已|已经|都已)(?:逐条|全部)?(?:核实|核验|验证)|(?i)\\b(?:all|fully|have|has been|were|was)\\s+verified\\b");

    private boolean down;
    private int webLookups;
    private boolean finalReminded;

    /** 每个工具调用的输出都过一遍：出现法宝不可用标记即进入不可用态（只进不出）。 */
    synchronized void noteResult(String output) {
        if (LegalTools.isVendorUnavailable(output)) down = true;
    }

    synchronized boolean isDown() {
        return down;
    }

    /**
     * 网页查询准入。返回 null = 放行（并计数）；非 null = 不执行，把返回文本当作工具结果回给模型。
     * 未进入不可用态或不是网页查询工具时恒放行、不计数。
     */
    synchronized String admit(String toolName) {
        if (!down || toolName == null || !WEB_LOOKUP_TOOLS.contains(toolName)) return null;
        if (webLookups < MAX_WEB_LOOKUPS_AFTER_DOWN) {
            webLookups++;
            return null;
        }
        return LangText.of(
                "[系统提示] 北大法宝法源本轮不可用，替代查询（search_web / browse_url）已用满 "
                        + MAX_WEB_LOOKUPS_AFTER_DOWN + " 次，本次 " + toolName + " 未执行。"
                        + "不要再查找法条原文：现在就根据已有资料回答用户；凡没有从权威来源取得原文的条文内容，"
                        + "逐条标注「未核实」，不得写成已核实或已核对。",
                "[System notice] The PKULaw legal source is unavailable for this run and the alternative lookup budget "
                        + "(search_web / browse_url, " + MAX_WEB_LOOKUPS_AFTER_DOWN + " calls) is used up; this "
                        + toolName + " call was not executed. Stop looking for statute text: answer the user now with "
                        + "what you have, mark every statute text not retrieved from an authoritative source as "
                        + "\"unverified\", and never describe it as verified.");
    }

    /** 放行的替代查询结果后面附一句：第几次、网页不是权威法源。非替代查询返回 null。 */
    synchronized String lookupNotice(String toolName) {
        if (!down || toolName == null || !WEB_LOOKUP_TOOLS.contains(toolName)) return null;
        return LangText.of(
                "[系统提示] 法源不可用后的替代查询 " + webLookups + "/" + MAX_WEB_LOOKUPS_AFTER_DOWN
                        + "。网页内容不是权威法源，据此引用的条文须标「未核实」。",
                "[System notice] Alternative lookup " + webLookups + "/" + MAX_WEB_LOOKUPS_AFTER_DOWN
                        + " after the legal source went down. Web pages are not an authoritative legal source; "
                        + "statute text taken from them must be marked \"unverified\".");
    }

    /**
     * 收尾检查：不可用态下，回答提到具体条文却没有未核实标注、或自称已核实时，返回一次性提醒并置位；其余 null。
     */
    synchronized String finalAnswerReminder(String answer) {
        if (!down || finalReminded || answer == null || !STATUTE_CITATION.matcher(answer).find()) return null;
        boolean marked = UNVERIFIED_MARK.matcher(answer).find();
        boolean claimsVerified = VERIFIED_CLAIM.matcher(answer).find();
        if (marked && !claimsVerified) return null;
        finalReminded = true;
        return LangText.of(
                "[系统提醒] 本轮北大法宝法源不可用，你的回答引用了具体条文，但没有标明哪些条文内容未经权威来源核实"
                        + (claimsVerified ? "，还写了「已核实」类说法" : "") + "。不要重写整段回答，也不要再调用工具："
                        + "只用 <final> 补一段简短说明——列出没有从权威来源取得原文的条文并标注「未核实」，"
                        + "前文若有「已核实 / 已核对」之类说法要明确更正；原文确实取自国家法律法规数据库等权威来源的，注明出处即可。",
                "[System reminder] The PKULaw legal source was unavailable in this run and your answer cites specific "
                        + "statute articles without saying which texts were not verified against an authoritative source"
                        + (claimsVerified ? ", and it claims they were verified" : "") + ". Do not rewrite the answer "
                        + "and do not call tools: reply only with a short <final> note that lists the articles whose text "
                        + "was not retrieved from an authoritative source and marks them \"unverified\", and explicitly "
                        + "correct any earlier claim of verification; for text actually taken from an authoritative "
                        + "source such as the national laws database, just name the source.");
    }
}
