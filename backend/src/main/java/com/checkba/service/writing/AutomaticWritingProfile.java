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
        return "这是普通文书或工作报告。只补全当前思路的自然后续、概括或衔接。理解多条已有信息之间的关系后重新组织语言，不把材料中的句段当成候选直接搬回，也不通过添连接词或机械换词制造新意；只有表达更顺畅但仍重复已述内容时应放弃。不猜测下一项工作，可以概括已知事实间的共同点、差异与并存关系；用最短必要的后缀完成当前句，通常8至30字足够，概括完成即停止，不再重列原文各项或添加解释性分句。光标前以‘的’等词结束时，应衔接所需句法成分，不能重起主谓句。准确保留逻辑关系，多个可选项不等于必须结合使用。不得新增没有依据的计划、成果、承诺、责任或结论。材料记载不是独立核实。没有明确且有用的续写就放弃。";
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
