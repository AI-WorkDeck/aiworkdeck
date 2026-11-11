// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.legal;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 北大法宝 2026-11 改名后的兼容层（上游工具全部改名、回包改成「可读文本 + structuredContent」）。
 *
 * <ul>
 *   <li>{@link #translate}：旧 op 名 / 入参 → 现名 / 入参。与官网网关 lib/gateway/adapters/pkulaw.ts 的
 *       buildCall 同一张表；网关那档已实测，这里给不走网关的两档（自备 Key 直连、用户自建 MCP 连接）用。</li>
 *   <li>{@link #legacyFromRaw}：把 structuredContent 还原成改名前的字段形状，依据窗格的解析、空结果判定
 *       与前端 insightDetail 都按旧形状写，统一在这一处换算，下游不用改。模型那条（LegalTools）照旧吃可读文本。</li>
 * </ul>
 */
public final class PkulawCompat {

    private static final ObjectMapper OM = new ObjectMapper();

    private PkulawCompat() {
    }

    public record Call(String tool, Map<String, Object> args) {
    }

    /** 旧 op → 法宝现名。认不得的原样透传（别家 / 自建工具）。 */
    public static Call translate(String op, Map<String, Object> args) {
        Map<String, Object> a = args == null ? Map.of() : args;
        if (op == null) return new Call(null, a);
        switch (op) {
            case "search_article": {
                Map<String, Object> out = new LinkedHashMap<>();
                putIf(out, "query_text", a.get("text"));
                putIf(out, "library", a.get("lib"));
                for (String k : List.of("timeliness", "issue_department", "implement_date_start", "implement_date_end", "size")) {
                    putIf(out, k, a.get(k));
                }
                return new Call("search_law_articles", out);
            }
            case "get_article":
            case "get_law_item_content": {
                Object title = a.containsKey("lawTitle") ? a.get("lawTitle") : a.get("title");
                Object number = a.containsKey("articleNumber") ? a.get("articleNumber") : a.get("number");
                Map<String, Object> out = new LinkedHashMap<>();
                putIf(out, "law_title", title == null ? null : String.valueOf(title));
                putIf(out, "article_number", number == null ? null : String.valueOf(number));
                return new Call("get_law_article", out);
            }
            case "get_law_list": {
                Map<String, Object> snaked = new LinkedHashMap<>();
                a.forEach((k, v) -> putIf(snaked, k.replaceAll("([A-Z])", "_$1").toLowerCase(java.util.Locale.ROOT), v));
                if (snaked.containsKey("title") || snaked.containsKey("document_no")) {
                    return new Call("search_laws_by_keyword", snaked);
                }
                return new Call("search_law_articles_by_keyword", snaked.containsKey("fulltext")
                        ? Map.of("fulltext", snaked.get("fulltext")) : snaked);
            }
            case "law_recognition":
                return new Call("recognize_law_citations", textOnly(a));
            case "search_case":
                return new Call("search_cases", a);
            case "anhao_recognition":
                return new Call("recognize_case_numbers", textOnly(a));
            case "adjust_provisions": {
                Map<String, Object> out = new LinkedHashMap<>();
                putIf(out, "user_law", lawItems(a.get("userlaw")));
                putIf(out, "answer_law", lawItems(a.get("answerlaw")));
                putIf(out, "prompt", a.get("prompt"));
                return new Call("verify_law_citations", out);
            }
            default:
                return new Call(op, a);
        }
    }

    /**
     * 网关回来的原始 JSON-RPC（可能是 SSE 帧）里有 structuredContent 且不是 isError 时，按旧 op 还原成旧形状；
     * 否则返回 null，调用方退回可读文本那条老路。
     */
    public static String legacyFromRaw(String op, String raw) {
        JsonNode result = rpcResult(raw);
        if (result == null || result.path("isError").asBoolean(false)) return null;
        JsonNode structured = result.get("structuredContent");
        if (structured == null || !structured.isObject()) return null;
        JsonNode legacy = legacy(op, structured);
        return legacy == null ? null : legacy.toString();
    }

    static JsonNode legacy(String op, JsonNode s) {
        if (op == null) return null;
        switch (op) {
            case "get_article":
            case "get_law_item_content": {
                String content = text(s, "article_content");
                if (content.isEmpty()) {
                    // 「未找到这一条」上游当成功回（isError=false），旧判定靠 article/content/text 全空 → NOT_FOUND
                    ObjectNode empty = OM.createObjectNode();
                    empty.put("article", "");
                    empty.put("content", "");
                    empty.put("text", "");
                    return empty;
                }
                return lawRecord(s, "document_no", "implement_date");
            }
            case "search_article": {
                ObjectNode out = OM.createObjectNode();
                out.set("articles", mapEach(s.get("result"), r -> lawRecord(r, "doc_no", "implementation_date")));
                return out;
            }
            case "get_law_list": {
                ObjectNode out = OM.createObjectNode();
                out.set("Data", mapEach(s.get("items"), r -> lawRecord(r, "document_no", "implement_date")));
                return out;
            }
            case "search_case": {
                ArrayNode out = OM.createArrayNode();
                for (String bucket : List.of("authoritative_cases", "ordinary_cases")) {
                    out.addAll(mapEach(s.get(bucket), PkulawCompat::caseRecord));
                }
                return out;
            }
            case "anhao_recognition":
                return mapEach(s.get("result"), r -> {
                    ObjectNode o = OM.createObjectNode();
                    putText(o, "text", text(r, "matched_text"));
                    putText(o, "caseFlag", text(r, "case_number"));
                    putText(o, "court", text(r, "court"));
                    putText(o, "title", text(r, "title"));
                    putText(o, "url", text(r, "url"));
                    putText(o, "gid", text(r, "gid"));
                    return o;
                });
            case "law_recognition":
                return mapEach(s.get("result"), r -> {
                    ObjectNode o = OM.createObjectNode();
                    putText(o, "title", text(r, "law_title"));
                    putText(o, "article", text(r, "article_number"));
                    putText(o, "content", text(r, "article_content"));
                    putText(o, "timeliness", text(r, "timeliness"));
                    putText(o, "url", text(r, "url"));
                    return o;
                });
            case "adjust_provisions":
                // 旧契约：数组；空 = 条号查不到；article_number 等于引用条号的是权威原文，其余是内容定位候选
                return mapEach(s.get("articles"), r -> {
                    ObjectNode o = OM.createObjectNode();
                    putText(o, "title", text(r, "law_title"));
                    putText(o, "article_number", text(r, "article_number"));
                    putText(o, "original_text", text(r, "article_content"));
                    putText(o, "url", url(r));
                    putText(o, "implement_date", text(r, "implement_date"));
                    return o;
                });
            default:
                return null;
        }
    }

    // —— 记录换算 ——

    private static ObjectNode lawRecord(JsonNode r, String docNoKey, String implementKey) {
        ObjectNode o = OM.createObjectNode();
        String label = text(r, "article_label");
        String content = text(r, "article_content");
        if (!label.isEmpty() && content.startsWith(label)) {
            content = content.substring(label.length()).replaceFirst("^[\\s\\u3000：:]+", "");
        }
        putText(o, "title", text(r, "law_title"));
        putText(o, "article", label);
        putText(o, "content", content);
        putText(o, "timeliness", text(r, "timeliness"));
        putText(o, "DocumentNO", text(r, docNoKey));
        putText(o, "IssueDepartment", text(r, "issue_department"));
        putText(o, "EffectivenessDic", text(r, "effectiveness"));
        putText(o, "IssueDate", text(r, "issue_date"));
        putText(o, "ImplementDate", text(r, implementKey));
        putText(o, "url", url(r));
        putText(o, "gid", text(r, "gid"));
        return o;
    }

    private static ObjectNode caseRecord(JsonNode r) {
        ObjectNode o = OM.createObjectNode();
        putText(o, "title", text(r, "title"));
        putText(o, "case_number", text(r, "case_number"));
        putText(o, "courthouse_name", text(r, "courthouse_name"));
        putText(o, "decision_date", text(r, "decision_date"));
        putText(o, "case_type", text(r, "case_type"));
        putText(o, "cause", text(r, "cause_of_action"));
        putText(o, "ascertain", text(r, "ascertain"));
        putText(o, "reason", text(r, "identified"));
        putText(o, "result", text(r, "referee_result"));
        putText(o, "content", text(r, "content"));
        putText(o, "url", text(r, "url"));
        putText(o, "gid", text(r, "gid"));
        return o;
    }

    // —— 小工具 ——

    /** citation 有时是对象（带 url），有时直接是链接字符串（search_law_articles）。 */
    private static String url(JsonNode r) {
        JsonNode c = r.get("citation");
        if (c != null && c.isObject()) return text(c, "url");
        String s = text(r, "citation");
        return s.startsWith("http") ? s : text(r, "url");
    }

    /** 字符串原样；数组用「、」连；null / 其它给空串。 */
    private static String text(JsonNode n, String key) {
        JsonNode v = n == null ? null : n.get(key);
        if (v == null || v.isNull()) return "";
        if (v.isArray()) {
            List<String> parts = new ArrayList<>();
            v.forEach(x -> { if (x != null && !x.isNull() && !x.asText().isBlank()) parts.add(x.asText().trim()); });
            return String.join("、", parts);
        }
        return v.isValueNode() ? v.asText("").trim() : "";
    }

    private static void putText(ObjectNode o, String key, String value) {
        if (value != null && !value.isEmpty()) o.put(key, value);
    }

    private static ArrayNode mapEach(JsonNode arr, java.util.function.Function<JsonNode, ObjectNode> f) {
        ArrayNode out = OM.createArrayNode();
        if (arr != null && arr.isArray()) arr.forEach(r -> { if (r != null && r.isObject()) out.add(f.apply(r)); });
        return out;
    }

    private static JsonNode rpcResult(String raw) {
        if (raw == null || raw.isBlank()) return null;
        List<String> candidates = new ArrayList<>();
        candidates.add(raw.trim());
        for (String line : raw.split("\\r?\\n")) {
            if (line.startsWith("data:")) candidates.add(line.substring(5).trim());
        }
        for (String c : candidates) {
            try {
                JsonNode n = OM.readTree(c);
                if (n != null && n.has("result")) return n.get("result");
            } catch (Exception ignored) {
                // 不是 JSON（SSE 原文 / 纯文本）：试下一个候选
            }
        }
        return null;
    }

    private static Map<String, Object> textOnly(Map<String, Object> a) {
        Map<String, Object> out = new LinkedHashMap<>();
        putIf(out, "text", a.get("text"));
        return out;
    }

    /** verify_law_citations 的条目只认 law_title（多给 title 会被 extra_forbidden 拒掉）。 */
    @SuppressWarnings("unchecked")
    private static Object lawItems(Object v) {
        if (v == null) return null;
        List<Object> in = v instanceof List<?> l ? (List<Object>) l : List.of(v);
        List<Object> out = new ArrayList<>();
        for (Object item : in) {
            if (item instanceof Map<?, ?> m) {
                Map<String, Object> copy = new LinkedHashMap<>((Map<String, Object>) m);
                Object title = copy.remove("title");
                if (title != null && !copy.containsKey("law_title")) {
                    Map<String, Object> renamed = new LinkedHashMap<>();
                    renamed.put("law_title", title);
                    renamed.putAll(copy);
                    copy = renamed;
                }
                out.add(copy);
            } else {
                out.add(item);
            }
        }
        return out;
    }

    private static void putIf(Map<String, Object> m, String k, Object v) {
        if (v == null) return;
        if (v instanceof String s && s.isBlank()) return;
        m.put(k, v);
    }
}
