// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ai;

import cn.hutool.json.JSONArray;
import cn.hutool.json.JSONObject;
import cn.hutool.json.JSONUtil;
import com.checkba.service.LangText;

import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 破坏性工具的确认闸（agent-app-control C5 / P2-1）：问题文案、参数摘要与回答判定的唯一口径。
 *
 * <p>编排器在分发 destructive（或 confirm=always）工具之前拦下，用 {@code ask_user} 卡问一次；
 * 待执行的调用（工具名 + 原参数）随本轮存起来，用户在下一轮答「执行」时按原参数重放<b>一次</b>，
 * 其他任何回答都当取消。每次都问，没有「本轮不再询问」。
 */
final class DestructiveConfirmation {

    static final String HEADER_ZH = "确认";
    static final String HEADER_EN = "Confirm";
    static final String RUN_ZH = "执行";
    static final String RUN_EN = "Run";
    static final String CANCEL_ZH = "取消";
    static final String CANCEL_EN = "Cancel";

    private static final int MAX_VALUE_CHARS = 40;
    private static final int MAX_SUMMARY_CHARS = 120;
    private static final int MAX_ITEMS_SHOWN = 2;
    /** 这些字段多半是整篇正文：只报字数，不进摘要。 */
    private static final Set<String> BULK_KEYS = Set.of("content", "text", "body", "html", "markdown", "data",
            "newtext", "replacement", "replace", "markup", "xml", "json", "payload", "prompt");
    private static final Pattern SELECTED = Pattern.compile("(?m)^-\\s*(.+?)\\s*$");

    private DestructiveConfirmation() {}

    static AskUserQuestion question(String displayName, String argsJson, String id) {
        String summary = summarizeArgs(argsJson);
        String q = LangText.of(
                "确认执行「" + displayName + "」" + (summary.isEmpty() ? "" : "：" + summary) + "？",
                "Confirm running \"" + displayName + "\"" + (summary.isEmpty() ? "" : ": " + summary) + "?");
        JSONArray options = new JSONArray();
        options.add(new JSONObject().set("label", LangText.of(RUN_ZH, RUN_EN))
                .set("description", LangText.of("按上述参数执行一次", "Run once with the arguments above")));
        options.add(new JSONObject().set("label", LangText.of(CANCEL_ZH, CANCEL_EN))
                .set("description", LangText.of("不执行", "Do not run")));
        return AskUserQuestion.of(q, options.toString(), false, LangText.of(HEADER_ZH, HEADER_EN), id);
    }

    /**
     * 关键标识的短摘要：文件名/路径/项目名/数量，截断；大段正文只报字数。
     * 不原样回显 JSON，避免把整篇内容塞进确认卡。
     */
    static String summarizeArgs(String argsJson) {
        JSONObject args;
        try {
            args = argsJson == null || argsJson.isBlank() ? new JSONObject() : JSONUtil.parseObj(argsJson);
        } catch (Exception e) {
            return "";
        }
        StringBuilder sb = new StringBuilder();
        for (String key : args.keySet()) {
            if (sb.length() >= MAX_SUMMARY_CHARS) break;
            Object v = args.get(key);
            if (v == null) continue;
            String shown = describe(key, v);
            if (shown == null) continue;
            if (sb.length() > 0) sb.append("，");
            sb.append(shown);
        }
        return cut(sb.toString(), MAX_SUMMARY_CHARS);
    }

    private static String describe(String key, Object v) {
        if (v instanceof String s) {
            String t = s.strip();
            if (t.startsWith("[")) {
                try {
                    return describeList(key, JSONUtil.parseArray(t));
                } catch (Exception ignored) {
                    // 不是数组，按普通字符串处理
                }
            }
            if (BULK_KEYS.contains(key.toLowerCase(java.util.Locale.ROOT)) || t.length() > 200) {
                return key + "=" + LangText.of(t.length() + " 字", t.length() + " chars");
            }
            return key + "=" + cut(oneLine(t), MAX_VALUE_CHARS);
        }
        if (v instanceof JSONArray arr) return describeList(key, arr);
        if (v instanceof JSONObject obj) return key + "=" + LangText.of("{" + obj.size() + " 项}", "{" + obj.size() + " fields}");
        return key + "=" + v;
    }

    private static String describeList(String key, JSONArray arr) {
        StringBuilder items = new StringBuilder();
        for (int i = 0; i < Math.min(arr.size(), MAX_ITEMS_SHOWN); i++) {
            if (i > 0) items.append("、");
            Object item = arr.get(i);
            items.append(cut(oneLine(item instanceof JSONObject o ? o.toString() : String.valueOf(item)), MAX_VALUE_CHARS));
        }
        String more = arr.size() > MAX_ITEMS_SHOWN ? LangText.of(" 等", " etc.") : "";
        return key + "=" + LangText.of(arr.size() + " 项（" + items + more + "）", arr.size() + " item(s) (" + items + more + ")");
    }

    private static String oneLine(String s) {
        return s.replaceAll("\\s+", " ");
    }

    private static String cut(String s, int max) {
        return s.length() <= max ? s : s.substring(0, max) + "…";
    }

    /** 回答是不是「执行」：只认单选的执行/Run；「其他」自由输入、取消、空一律不执行。 */
    static boolean isApproval(String answerMessage) {
        if (answerMessage == null) return false;
        String body = answerMessage;
        int other = body.indexOf("\nOther:");
        if (other >= 0 && body.substring(other + 7).strip().length() > 0) return false;
        int sel = body.indexOf("Selected:");
        if (sel < 0) return false;
        Matcher m = SELECTED.matcher(body.substring(sel + 9));
        if (!m.find()) return false;
        String first = m.group(1);
        boolean single = !m.find();
        return single && (RUN_ZH.equals(first) || RUN_EN.equals(first));
    }

    static String cancelledNote(String displayName) {
        return LangText.of("用户取消了「" + displayName + "」，未执行。不要重试这个操作；告知用户已取消并继续其他事项。",
                "The user cancelled \"" + displayName + "\"; it was NOT run. Do not retry it; tell the user it was cancelled and continue.");
    }
}
