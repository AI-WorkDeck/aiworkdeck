// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.aiworkdeck.plugins.pitch;

import com.checkba.plugin.api.*;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import dev.langchain4j.agent.tool.P;
import dev.langchain4j.agent.tool.Tool;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.*;

/**
 * 投标与提案插件的唯一工具。只用公开宿主 SPI：库与对照表存插件设置（按用户隔离），
 * 模板从项目文件读，生成结果写回项目。失败一律回错误码，由面板按界面语言翻译。
 */
public class PitchTools implements HostAware {
    static final ObjectMapper JSON = new ObjectMapper();
    static final int MAX_ITEMS = 1000;
    static final long MAX_TEMPLATE = 30L * 1024 * 1024;
    static final List<String> SECTIONS = List.of("credentials", "lawyers", "qualifications", "services", "quotes");

    /** 业务失败：code 给面板翻译，detail 是出错的字段或名称。 */
    static final class Failure extends RuntimeException {
        final String code;
        final String detail;
        Failure(String code) { this(code, ""); }
        Failure(String code, String detail) { super(code); this.code = code; this.detail = detail == null ? "" : detail; }
    }

    private PluginHost host;

    @Override public void setHost(PluginHost host) { this.host = host; }

    @Tool("投标与提案插件：业绩与团队库、招标对照表、报价计算、按 Word/PPT 模板生成投标书或提案。action 为 "
            + "library.get / library.save / library.export / matrix.get / matrix.save / quote.compute / templates.sample / generate；"
            + "json 是 JSON 对象参数。generate 参数：kind(docx|pptx)、template(项目内模板路径，或 sample 用内置示例)、client、project、"
            + "credentialIds、lawyerIds、qualificationIds、serviceIds、quoteId、outward(对外材料，默认 true，客户名换成对外称谓)、includeMatrix。"
            + "业绩库是所内保密资料，对外材料必须保持 outward=true。")
    public String pitch_materials_action(@P("操作名") String action, @P("JSON 参数对象，默认 {}") String json) {
        try {
            ToolCall call = identity();
            JsonNode args = JSON.readTree(json == null || json.isBlank() ? "{}" : json);
            if (args == null || !args.isObject()) throw new Failure("bad_params");
            boolean zh = !text(args, "lang").toLowerCase(Locale.ROOT).startsWith("en")
                    && (text(args, "lang").isEmpty() || text(args, "lang").toLowerCase(Locale.ROOT).startsWith("zh"));
            Object data = switch (action == null ? "" : action.trim()) {
                // 对话里的调用（有 conversationId）结果会进模型：只给脱敏视图，且不许改写/导出整库（防招标文件里的注入指令）
                case "library.get" -> Map.of("library", fromAgent(call) ? maskedLibrary(loadLibrary(call), zh) : loadLibrary(call));
                case "library.save" -> { panelOnly(call); saveLibrary(call, args.path("library")); yield Map.of("saved", true); }
                case "library.export" -> { panelOnly(call); yield exportLibrary(call, zh); }
                case "matrix.get" -> { requireProject(call); yield Map.of("matrix", loadMatrix(call)); }
                case "matrix.save" -> { requireProject(call); saveMatrix(call, args.path("matrix")); yield Map.of("saved", true); }
                case "quote.compute" -> {
                    Map<String, Object> view = quoteView(Quote.compute(findQuote(call, args), zh), zh);
                    if (!fromAgent(call)) yield view;
                    JsonNode tree = JSON.valueToTree(view);
                    maskTree(tree, new Build(loadLibrary(call), JSON.createObjectNode(), null, zh));
                    yield tree;
                }
                case "templates.sample" -> writeSamples(call, zh);
                case "generate" -> generate(call, args, zh);
                default -> throw new Failure("bad_action", action);
            };
            return ok(data);
        } catch (Failure e) {
            return error(e.code, e.detail);
        } catch (com.fasterxml.jackson.core.JsonProcessingException e) {
            return error("bad_params", "");
        } catch (RuntimeException e) {
            // 宿主 SPI 的权限/配额异常不外泄内部信息；detail 只带异常类名，便于排查
            String name = e.getClass().getSimpleName();
            return error(name.contains("Quota") ? "quota" : name.contains("Security") || name.contains("Access") ? "permission" : "failed", name);
        } catch (Exception e) {
            return error("failed", e.getClass().getSimpleName());
        }
    }

    // ------------------------------------------------------------------ 身份与存储

    private ToolCall identity() {
        ToolCall call = host == null ? null : host.call();
        if (call == null || call.userId() == null || call.userId() <= 0) throw new Failure("not_signed_in");
        return call;
    }

    private void requireProject(ToolCall call) {
        if (call.projectId() == null || call.projectId() <= 0) throw new Failure("no_project");
        host.files().list(call.projectId(), null, false); // 宿主在这里核项目成员权限
    }

    static boolean fromAgent(ToolCall call) { return call.conversationId() != null && !call.conversationId().isBlank(); }

    private static void panelOnly(ToolCall call) {
        if (fromAgent(call)) throw new Failure("panel_only");
    }

    /** 给模型看的库：去掉真实客户名，其余所有文字字段里的客户名（含简称）换成对外称谓。 */
    static ObjectNode maskedLibrary(ObjectNode lib, boolean zh) {
        Build b = new Build(lib, JSON.createObjectNode(), null, zh);
        ObjectNode out = lib.deepCopy();
        for (JsonNode c : out.path("credentials")) ((ObjectNode) c).remove("client");
        maskTree(out, b);
        return out;
    }

    private static final Set<String> KEEP = Set.of("id", "clientAlias", "source", "kind");

    static void maskTree(JsonNode node, Build b) {
        if (node instanceof ObjectNode o) {
            List<String> names = new ArrayList<>();
            o.fieldNames().forEachRemaining(names::add);
            for (String f : names) {
                JsonNode v = o.get(f);
                if (v.isTextual() && !KEEP.contains(f)) o.put(f, b.mask(v.asText()));
                else maskTree(v, b);
            }
        } else if (node instanceof ArrayNode a) {
            for (int i = 0; i < a.size(); i++) {
                if (a.get(i).isTextual()) a.set(i, JSON.getNodeFactory().textNode(b.mask(a.get(i).asText())));
                else maskTree(a.get(i), b);
            }
        }
    }

    private String libraryKey(ToolCall call) { return "library.u" + call.userId(); }

    private String matrixKey(ToolCall call) { return "matrix.u" + call.userId() + ".p" + call.projectId(); }

    ObjectNode loadLibrary(ToolCall call) throws Exception {
        String raw = readChunked(libraryKey(call));
        ObjectNode lib = raw == null || raw.isBlank() ? JSON.createObjectNode() : (ObjectNode) JSON.readTree(raw);
        return normalize(lib);
    }

    static ObjectNode normalize(JsonNode in) {
        if (in == null || !in.isObject()) throw new Failure("bad_library");
        ObjectNode lib = JSON.createObjectNode();
        lib.put("version", 1);
        JsonNode firm = in.path("firm");
        ObjectNode f = lib.putObject("firm");
        f.put("name", text(firm, "name"));
        f.put("intro", text(firm, "intro"));
        for (String s : SECTIONS) {
            JsonNode arr = in.path(s);
            ArrayNode out = lib.putArray(s);
            if (arr.isMissingNode() || arr.isNull()) continue;
            if (!arr.isArray()) throw new Failure("bad_library", s);
            if (arr.size() > MAX_ITEMS) throw new Failure("library_too_large", s);
            Set<String> ids = new HashSet<>();
            for (JsonNode item : arr) {
                if (!item.isObject() || text(item, "id").isEmpty() || !ids.add(text(item, "id"))) throw new Failure("bad_library", s);
                out.add(item);
            }
        }
        return lib;
    }

    private void saveLibrary(ToolCall call, JsonNode lib) throws Exception {
        String raw = JSON.writeValueAsString(normalize(lib));
        writeChunked(libraryKey(call), raw);
    }

    /**
     * 设置值在服务器的 MySQL 上是 TEXT（64 KB）：按 UTF-8 字节切成 ≤ 60 KB 的段保存。
     * 每次保存写一代新键 {@code <key>.g<代>.<i>}，最后才把主键改成 {@code #g<代>:<段数>}；
     * 中途失败（如宿主每分钟配额用完）时主键仍指向上一代完整内容。旧代的段随后清空。
     */
    static final int CHUNK_BYTES = 60_000;
    static final int MAX_STORE_BYTES = 1_000_000;
    private static final java.util.regex.Pattern HEAD = java.util.regex.Pattern.compile("#g(\\d+):(\\d+)");

    private String readChunked(String key) {
        String head = host.settings().get(key);
        if (head == null || !head.startsWith("#")) return head;
        java.util.regex.Matcher m = HEAD.matcher(head);
        if (!m.matches()) throw new Failure("bad_library");
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < Integer.parseInt(m.group(2)); i++) {
            String part = host.settings().get(key + ".g" + m.group(1) + "." + i);
            if (part == null) throw new Failure("bad_library");
            sb.append(part);
        }
        return sb.toString();
    }

    private void writeChunked(String key, String value) {
        if (value.getBytes(StandardCharsets.UTF_8).length > MAX_STORE_BYTES) throw new Failure("library_too_large");
        List<String> parts = new ArrayList<>();
        int start = 0;
        int bytes = 0;
        for (int i = 0; i < value.length(); ) {
            int cp = value.codePointAt(i);
            int len = cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
            if (bytes + len > CHUNK_BYTES) { parts.add(value.substring(start, i)); start = i; bytes = 0; }
            bytes += len;
            i += Character.charCount(cp);
        }
        parts.add(value.substring(start));
        String head = host.settings().get(key);
        java.util.regex.Matcher old = head == null ? null : HEAD.matcher(head);
        boolean hadOld = old != null && old.matches();
        long gen = hadOld ? Long.parseLong(old.group(1)) + 1 : 1;
        for (int i = 0; i < parts.size(); i++) host.settings().set(key + ".g" + gen + "." + i, parts.get(i));
        host.settings().set(key, "#g" + gen + ":" + parts.size());
        if (hadOld) {
            // 宿主 SPI 没有删除接口：旧代各段清成空串（失败不影响新内容）
            try {
                for (int i = 0; i < Integer.parseInt(old.group(2)); i++) host.settings().set(key + ".g" + old.group(1) + "." + i, "");
            } catch (RuntimeException ignored) { /* 配额用完时留到下次 */ }
        }
    }

    private JsonNode loadMatrix(ToolCall call) throws Exception {
        String raw = readChunked(matrixKey(call));
        return raw == null || raw.isBlank() ? JSON.nullNode() : JSON.readTree(raw);
    }

    private void saveMatrix(ToolCall call, JsonNode matrix) throws Exception {
        if (!matrix.isObject() || !matrix.path("items").isArray()) throw new Failure("bad_params", "matrix");
        if (matrix.path("items").size() > 300) throw new Failure("matrix_too_large");
        String raw = JSON.writeValueAsString(matrix);
        if (raw.getBytes(StandardCharsets.UTF_8).length > MAX_STORE_BYTES) throw new Failure("matrix_too_large");
        writeChunked(matrixKey(call), raw);
    }

    // ------------------------------------------------------------------ 报价

    private JsonNode findQuote(ToolCall call, JsonNode args) throws Exception {
        if (args.path("quote").isObject()) return args.path("quote");
        return byId(loadLibrary(call).path("quotes"), text(args, "quoteId"), "quote_missing");
    }

    private static Map<String, Object> quoteView(Quote.Result r, boolean zh) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("rows", Quote.rows(r, zh));
        m.put("subtotal", Quote.money(r.subtotal(), true));
        m.put("total", Quote.money(r.total(), true));
        m.put("totalCents", r.total());
        m.put("upper", r.upper());
        m.put("note", r.note());
        return m;
    }

    // ------------------------------------------------------------------ 文件

    private Map<String, Object> exportLibrary(ToolCall call, boolean zh) throws Exception {
        requireProject(call);
        byte[] bytes = JSON.writerWithDefaultPrettyPrinter().writeValueAsBytes(loadLibrary(call));
        String date = LocalDate.now().format(DateTimeFormatter.BASIC_ISO_DATE);
        FileInfo info = write(call, zh ? "投标库导出" : "Pitch library exports",
                (zh ? "业绩与团队库-" : "pitch-library-") + date + ".json", bytes);
        return Map.of("path", info.path());
    }

    private Map<String, Object> writeSamples(ToolCall call, boolean zh) throws Exception {
        requireProject(call);
        String folder = zh ? "投标模板" : "Pitch templates";
        FileInfo d = write(call, folder, zh ? "投标书模板（示例）.docx" : "Bid template (sample).docx", sample("docx"));
        FileInfo p = write(call, folder, zh ? "提案模板（示例）.pptx" : "Proposal template (sample).pptx", sample("pptx"));
        return Map.of("paths", List.of(d.path(), p.path()));
    }

    static byte[] sample(String kind) throws Exception {
        String res = "docx".equals(kind) ? "/pitch-samples/bid-template.docx" : "/pitch-samples/proposal-template.pptx";
        try (InputStream in = PitchTools.class.getResourceAsStream(res)) {
            if (in == null) throw new Failure("template_missing");
            return in.readAllBytes();
        }
    }

    private FileInfo write(ToolCall call, String folder, String name, byte[] bytes) {
        FileInfo dir = host.files().createFolderPath(call.projectId(), List.of(folder));
        return host.files().write(call.projectId(), dir.id(), name, new ByteArrayInputStream(bytes), ConflictPolicy.RENAME);
    }

    private byte[] readTemplate(ToolCall call, String path, String kind) throws Exception {
        if (path.isEmpty() || "sample".equals(path)) return sample(kind);
        String want = path.replaceFirst("^/+", "");
        FileInfo hit = null;
        for (FileInfo f : host.files().list(call.projectId(), null, true)) {
            if (!f.folder() && want.equals(f.path())) { hit = f; break; }
        }
        if (hit == null) throw new Failure("template_missing", path);
        if (!want.toLowerCase(Locale.ROOT).endsWith("." + kind)) throw new Failure("template_kind", path);
        if (hit.size() > MAX_TEMPLATE) throw new Failure("template_too_large", path);
        try (InputStream in = host.files().open(call.projectId(), hit.id())) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            long n = 0;
            int r;
            while ((r = in.read(buf)) > 0) {
                n += r;
                if (n > MAX_TEMPLATE) throw new Failure("template_too_large", path);
                out.write(buf, 0, r);
            }
            return out.toByteArray();
        }
    }

    // ------------------------------------------------------------------ 生成

    private Map<String, Object> generate(ToolCall call, JsonNode args, boolean zh) throws Exception {
        requireProject(call);
        String kind = text(args, "kind");
        if (!kind.equals("docx") && !kind.equals("pptx")) throw new Failure("bad_params", "kind");
        ObjectNode lib = loadLibrary(call);
        JsonNode matrix = args.path("includeMatrix").asBoolean(true) ? loadMatrix(call) : JSON.nullNode();
        Build build = new Build(lib, args, matrix, zh);
        Ooxml.Data data = build.data();
        byte[] template = readTemplate(call, text(args, "template"), kind);
        Ooxml.Result filled = Ooxml.fill(template, kind.equals("pptx"), data);
        List<String> leaks = build.outward ? leakCheck(Ooxml.text(filled.bytes(), kind.equals("pptx")), build.secretNames()) : List.of();
        String client = text(args, "client");
        String project = text(args, "project");
        // 项目名本身以招标人开头时不再重复拼客户名
        String prefix = client.isEmpty() || project.startsWith(client) ? "" : client + "-";
        String base = sanitize(prefix + (project.isEmpty()
                ? (zh ? (kind.equals("docx") ? "投标书" : "提案") : (kind.equals("docx") ? "Bid" : "Proposal"))
                : project + (zh ? (kind.equals("docx") ? "-投标书" : "-提案") : (kind.equals("docx") ? "-bid" : "-proposal"))));
        FileInfo info = write(call, zh ? "投标材料" : "Pitch materials", base + "." + kind, filled.bytes());
        if (call.conversationId() != null) {
            try { host.docs().refreshFiles(); host.docs().openFile(info.id(), null); } catch (RuntimeException ignored) { /* 面板自己打开 */ }
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("path", info.path());
        out.put("fileId", info.id());
        out.put("unknownPlaceholders", filled.unknown());
        out.put("overflowSlides", filled.overflowSlides());
        // 对话里只回泄露条数，不把真实客户名交给模型
        if (fromAgent(call)) out.put("leakCount", leaks.size()); else out.put("leaks", leaks);
        out.put("missingAliases", build.missingAliases);
        out.put("quote", build.quoteView);
        return out;
    }

    /** 对外材料复查：库里真实客户名（与对外称谓不同的）不得出现在生成文件里。 */
    static List<String> leakCheck(String text, Collection<String> secrets) {
        String flat = text.replaceAll("\\s+", "");
        List<String> hits = new ArrayList<>();
        for (String s : secrets) {
            String k = s.replaceAll("\\s+", "");
            if (k.length() >= 2 && flat.contains(k)) hits.add(s);
        }
        return hits;
    }

    static String sanitize(String name) {
        String s = name.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "").replaceAll("\\s+", " ").trim();
        if (s.length() > 80) s = s.substring(0, 80);
        return s.isEmpty() ? "pitch" : s;
    }

    // ------------------------------------------------------------------ 工具函数

    static String text(JsonNode n, String field) {
        JsonNode v = n == null ? null : n.get(field);
        if (v == null || v.isNull() || v.isContainerNode()) return "";
        return v.asText("").trim();
    }

    static JsonNode byId(JsonNode arr, String id, String missing) {
        for (JsonNode it : arr) if (id.equals(text(it, "id"))) return it;
        throw new Failure(missing, id);
    }

    private static String ok(Object data) throws Exception {
        ObjectNode out = JSON.createObjectNode();
        out.put("success", true);
        out.set("data", JSON.valueToTree(data));
        return JSON.writeValueAsString(out);
    }

    private static String error(String code, String detail) {
        ObjectNode out = JSON.createObjectNode();
        out.put("success", false);
        out.put("code", code);
        out.put("detail", detail);
        return out.toString();
    }

    /** 把库 + 选择 + 对照表组装成模板数据。 */
    static final class Build {
        final boolean outward;
        final boolean zh;
        final List<String> missingAliases = new ArrayList<>();
        Map<String, Object> quoteView = Map.of();
        private final JsonNode lib;
        private final JsonNode args;
        private final JsonNode matrix;
        private final Map<String, String> aliasOf = new LinkedHashMap<>();

        Build(JsonNode lib, JsonNode args, JsonNode matrix, boolean zh) {
            this.lib = lib;
            this.args = args;
            this.matrix = matrix;
            this.zh = zh;
            this.outward = !args.has("outward") || args.path("outward").asBoolean(true);
            List<String> aliases = new ArrayList<>();
            for (JsonNode c : lib.path("credentials")) if (!text(c, "clientAlias").isEmpty()) aliases.add(text(c, "clientAlias"));
            for (JsonNode c : lib.path("credentials")) {
                String client = text(c, "client");
                String alias = text(c, "clientAlias");
                if (client.length() < 2 || client.equals(alias)) continue;
                for (String v : nameVariants(client)) {
                    // 简称出现在某个对外称谓里就不用（与 web/pitch-core.js aliasPairs 同一口径）
                    if (!v.equals(client) && aliases.stream().anyMatch(a -> a.contains(v))) continue;
                    aliasOf.putIfAbsent(v, alias.isEmpty() ? (zh ? "某客户" : "a client") : alias);
                }
            }
        }

        private static final java.util.regex.Pattern FORM = java.util.regex.Pattern.compile("(股份有限公司|有限责任公司|集团有限公司|集团股份有限公司|有限公司|股份公司|集团公司|集团|公司)$");
        private static final java.util.regex.Pattern REGION = java.util.regex.Pattern.compile("^(北京|上海|天津|重庆|深圳|广州|杭州|南京|苏州|成都|武汉|西安|香港|澳门|[\\u4e00-\\u9fa5]{2,3}(省|市|自治区|新区))");
        private static final java.util.regex.Pattern TRADE = java.util.regex.Pattern.compile("(智能科技|信息技术|科技|技术|实业|控股|投资|发展|建设|置业|贸易|咨询)$");

        /** 客户名的常见简称（与 web/pitch-core.js nameVariants 同一规则；简称至少 4 个字）。 */
        static List<String> nameVariants(String name) {
            Set<String> out = new LinkedHashSet<>();
            String n = name.trim();
            out.add(n);
            n = n.replaceAll("[（(][^）)]*[）)]", "").trim();
            out.add(n);
            for (int i = 0; i < 3 && FORM.matcher(n).find(); i++) { n = FORM.matcher(n).replaceAll(""); out.add(n); }
            String noRegion = REGION.matcher(n).replaceAll("");
            out.add(noRegion);
            out.add(TRADE.matcher(noRegion).replaceAll(""));
            out.add(TRADE.matcher(n).replaceAll(""));
            List<String> res = new ArrayList<>();
            for (String v : out) if (v.equals(name.trim()) || v.length() >= 4) res.add(v);
            return res;
        }

        Set<String> secretNames() { return aliasOf.keySet(); }

        /** 对外模式：库里任何真实客户名都换成它的对外称谓（简介、律师简介里也常提到客户）。 */
        String mask(String s) {
            if (!outward || s.isEmpty()) return s;
            String out = s;
            List<String> names = new ArrayList<>(aliasOf.keySet());
            names.sort((a, b) -> b.length() - a.length());
            for (String n : names) out = out.replace(n, aliasOf.get(n));
            return out;
        }

        private List<JsonNode> pick(String section, String idsField) {
            JsonNode ids = args.path(idsField);
            List<JsonNode> out = new ArrayList<>();
            if (!ids.isArray()) return out;
            for (JsonNode id : ids) out.add(byId(lib.path(section), id.asText(), "item_missing"));
            return out;
        }

        Ooxml.Data data() {
            Map<String, String> sc = new LinkedHashMap<>();
            Map<String, List<Map<String, String>>> lists = new LinkedHashMap<>();
            sc.put("律所名称", text(lib.path("firm"), "name"));
            sc.put("律所简介", mask(text(lib.path("firm"), "intro")));
            sc.put("客户名称", text(args, "client"));
            sc.put("项目名称", text(args, "project"));
            LocalDate today = LocalDate.now();
            sc.put("日期", zh ? today.getYear() + "年" + today.getMonthValue() + "月" + today.getDayOfMonth() + "日"
                    : today.format(DateTimeFormatter.ofPattern("d MMMM yyyy", Locale.ENGLISH)));

            List<Map<String, String>> creds = new ArrayList<>();
            int n = 0;
            for (JsonNode c : pick("credentials", "credentialIds")) {
                Map<String, String> m = new LinkedHashMap<>();
                m.put("序号", String.valueOf(++n));
                m.put("名称", mask(text(c, "title")));
                String client = text(c, "client");
                String alias = text(c, "clientAlias");
                if (outward && alias.isEmpty() && !client.isEmpty()) missingAliases.add(mask(text(c, "title")));
                m.put("客户", outward ? (alias.isEmpty() ? (client.isEmpty() ? "" : (zh ? "某客户" : "a client")) : alias) : client);
                m.put("领域", text(c, "area"));
                m.put("年份", text(c, "year"));
                m.put("金额", args.path("hideAmounts").asBoolean(false) ? "" : mask(text(c, "amount")));
                m.put("角色", text(c, "role"));
                m.put("简介", mask(text(c, "summary")));
                m.put("律师", join(c.path("lawyers")));
                creds.add(m);
            }
            lists.put("业绩", creds);

            List<Map<String, String>> lawyers = new ArrayList<>();
            n = 0;
            for (JsonNode l : pick("lawyers", "lawyerIds")) {
                Map<String, String> m = new LinkedHashMap<>();
                m.put("序号", String.valueOf(++n));
                m.put("姓名", text(l, "name"));
                m.put("职务", text(l, "title"));
                m.put("领域", join(l.path("areas")));
                m.put("执业年份", text(l, "since"));
                m.put("教育", text(l, "education"));
                m.put("简介", mask(text(l, "bio")));
                lawyers.add(m);
            }
            lists.put("律师", lawyers);
            sc.put("团队负责人", lawyers.isEmpty() ? "" : lawyers.get(0).get("姓名"));

            List<Map<String, String>> quals = new ArrayList<>();
            n = 0;
            for (JsonNode q : pick("qualifications", "qualificationIds")) {
                Map<String, String> m = new LinkedHashMap<>();
                m.put("序号", String.valueOf(++n));
                m.put("名称", text(q, "name"));
                m.put("类型", text(q, "kind"));
                m.put("颁发机构", text(q, "issuer"));
                m.put("年份", text(q, "year"));
                quals.add(m);
            }
            lists.put("资质", quals);

            List<String> services = new ArrayList<>();
            List<JsonNode> chosen = pick("services", "serviceIds");
            for (JsonNode s : chosen) {
                String title = text(s, "title");
                String content = mask(text(s, "content"));
                services.add(chosen.size() > 1 && !title.isEmpty() ? title + "\n" + content : content);
            }
            sc.put("服务方案", String.join("\n", services));

            String quoteId = text(args, "quoteId");
            if (!quoteId.isEmpty()) {
                Quote.Result r = Quote.compute(byId(lib.path("quotes"), quoteId, "quote_missing"), zh);
                lists.put("报价", Quote.rows(r, zh));
                sc.put("报价方式", r.name());
                sc.put("报价合计", Quote.money(r.total(), true));
                sc.put("报价大写", r.upper());
                sc.put("报价说明", r.note());
                quoteView = quoteView(r, zh);
            } else {
                lists.put("报价", List.of());
            }
            lists.put("对照", matrixRows());
            return new Ooxml.Data(sc, lists);
        }

        private List<Map<String, String>> matrixRows() {
            List<Map<String, String>> out = new ArrayList<>();
            if (matrix == null || !matrix.isObject()) return out;
            Map<String, String> names = new HashMap<>();
            names.put("firm", text(lib.path("firm"), "name"));
            for (JsonNode c : lib.path("credentials")) names.put(text(c, "id"), mask(text(c, "title")));
            for (JsonNode l : lib.path("lawyers")) names.put(text(l, "id"), text(l, "name"));
            for (JsonNode q : lib.path("qualifications")) names.put(text(q, "id"), text(q, "name"));
            for (JsonNode s : lib.path("services")) names.put(text(s, "id"), text(s, "title"));
            int n = 0;
            for (JsonNode it : matrix.path("items")) {
                Map<String, String> m = new LinkedHashMap<>();
                m.put("序号", String.valueOf(++n));
                m.put("类型", label("kind", text(it, "kind")));
                m.put("要求", text(it, "text"));
                m.put("分值", text(it, "score"));
                m.put("结论", label("status", text(it, "status")));
                List<String> ev = new ArrayList<>();
                for (JsonNode id : it.path("evidence")) {
                    String name = names.get(id.asText());
                    if (name != null && !name.isEmpty()) ev.add(name);
                }
                String note = mask(text(it, "note"));
                // 依据只列库条目；没有条目时才用判断理由，避免表格行过高
                m.put("依据", ev.isEmpty() ? note : String.join(zh ? "；" : "; ", ev));
                m.put("缺口", mask(text(it, "gap")));
                out.add(m);
            }
            return out;
        }

        private String label(String type, String v) {
            Map<String, String[]> t = Map.of(
                    "qualification", new String[]{"资格要求", "Qualification"},
                    "scoring", new String[]{"评分项", "Scoring item"},
                    "met", new String[]{"满足", "Met"},
                    "partial", new String[]{"部分满足", "Partly met"},
                    "missing", new String[]{"缺材料", "Missing"},
                    "na", new String[]{"不适用", "N/A"},
                    "pending", new String[]{"待对照", "Pending"});
            String[] hit = t.get(v);
            return hit == null ? v : hit[zh ? 0 : 1];
        }

        private String join(JsonNode arr) {
            List<String> out = new ArrayList<>();
            if (arr.isArray()) for (JsonNode a : arr) if (!a.asText("").isBlank()) out.add(a.asText().trim());
            else if (arr.isTextual()) out.add(arr.asText());
            return String.join(zh ? "、" : ", ", out);
        }
    }

    static byte[] utf8(String s) { return s.getBytes(StandardCharsets.UTF_8); }
}
