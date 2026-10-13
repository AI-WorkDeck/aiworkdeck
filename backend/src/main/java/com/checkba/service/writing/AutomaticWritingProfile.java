// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.writing;

import java.util.*;
import java.util.regex.Pattern;
import static com.checkba.service.writing.WritingTypes.*;

/** Automatic-only fallback for ordinary reports; never supplies deterministic completions. */
final class AutomaticWritingProfile implements WritingProfile {
    public String id() { return "general"; }
    public String label() { return "普通文书"; }
    public int score(Context context, List<Source> sources) { return 0; }
    public List<Fact> facts(Context context, List<Source> sources) {
        return WritingNarrativeSources.append(id(), context, sources, List.of());
    }
    public List<Advice> deterministic(Context context, List<Fact> facts) { return List.of(); }
    public String instructions(Context context, List<Fact> facts) {
        return "这是普通文书或工作报告。理解作者当前句的意图、前后文指代和语法位置，用已有事实准确自然地补完它。可以直接复用材料中合适的措辞、重述已知事实、归纳或衔接，不要求新观点或新关系。建议是否有用取决于当前位置，不能仅因材料已有同一信息就放弃。不要复写光标旁已写完的内容、在完整意思后凑套话或猜测新的话题。用最短必要的后缀完成当前句，通常8至30字足够，写完即停止。精确保留主体、范围、条件、时间、否定和模态；更具体的表述不一定受较宽的材料支持。不得新增没有依据的计划、成果、承诺、责任或评价。材料记载不是独立核实。需要猜测作者意思或补造事实才能接下去时放弃。";
    }
    public List<String> validate(Context context, List<Fact> facts, Advice advice) {
        return grounded(context, facts, advice) ? List.of() : List.of("UNSUPPORTED_AUTOMATIC_ADDITION");
    }
    static boolean grounded(Context context, List<Fact> facts, Advice advice) {
        List<Fact> cited = facts.stream().filter(f -> advice.factIds().contains(f.id())).toList();
        if (cited.isEmpty() || cited.stream().anyMatch(f -> !Set.of("DOCUMENT_STATES", "CONTRACT_TERM").contains(f.status()))) return false;
        String support = String.join("\n", cited.stream().map(Fact::quote).toList());
        String text = advice.text();
        // Auto suggestions may reuse explicit quantities, never calculate or change units.
        var prefix = Pattern.compile("[-+]?[0-9]+(?:[.,，][0-9]+)*$").matcher(clean(context.before()));
        if (prefix.find() && Pattern.compile("^[0-9.,，%％元万亿年月日天个]").matcher(text).find()) text = prefix.group() + text;
        var quantities = Pattern.compile("[-+]?[0-9]+(?:[.,，][0-9]+)*(?:\\s*(?:亿美元|万美元|美元|欧元|英镑|港元|日元|亿元|万元|元|年|月|日|天|个|%|％))?|[零〇一二三四五六七八九十百千万亿两]+\\s*(?:亿元|万元|元|年|月|日|天|个|%|％)").matcher(text);
        while (quantities.find()) if (!Pattern.compile("(?<![0-9])" + Pattern.quote(quantities.group()) + "(?![0-9])").matcher(support).find()) return false;
        String before = clean(context.before());
        String clause = before.substring(Math.max(before.lastIndexOf('。'), Math.max(before.lastIndexOf('\n'), before.lastIndexOf('；'))) + 1) + advice.text();
        // Legal obligations, new promises and conclusive claims require the exact supported clause.
        if (Pattern.compile("应当|必须|不得|有权|承诺|保证|承担|负责|拟于|计划于|将于|已经证实|已证实|经核实|证明|必然|合法有效|已(?:经)?(?:完成|通过|取得|实现|达成|批准|确认|支付|收到)|不存在|没有任何").matcher(clause).find()
                && !support.replaceAll("\\s+", "").contains(clause.replaceAll("\\s+", "").replaceAll("[。；]$", ""))) return false;
        return true;
    }
}
