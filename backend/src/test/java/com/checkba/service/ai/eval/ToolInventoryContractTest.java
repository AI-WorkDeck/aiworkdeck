// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ai.eval;

import com.checkba.service.ai.PluginService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

/**
 * 工具清单契约（docs/plans/tool-system-v2.md E 节 V0）。
 *
 * <p>① 注册表里的每个工具（内置 {@code @Tool} + 官方插件的 manifest 声明 / JAR {@code @Tool}）
 * 必须与 {@code docs/plans/tool-system-v2-inventory.csv} 的「现存工具」行一一对应——
 * 加工具、删工具都要同提交改 CSV。
 *
 * <p>② 描述门禁（A5 模板）：首句 ≤80 字符、单一语言（中文，不夹英文词组）、动词开头。
 * CSV 裁决为 {@code keep}（描述已合规）或 {@code new}（新工具）的行<b>强制</b>；
 * 其余（待重写 / 待合并 / 待删除）只打印清单。描述重写 PR 把行改成 {@code keep} 即纳入强制。
 */
class ToolInventoryContractTest {

    static final int FIRST_LINE_MAX = 80;
    private static final Path CSV = Path.of("..", "docs", "plans", "tool-system-v2-inventory.csv");
    private static final Path PLUGINS = Path.of("..", "official-plugins");
    private static final Set<String> ENFORCED_VERDICTS = Set.of("keep", "new");
    private static final ObjectMapper JSON = new ObjectMapper();

    private record Tool(String name, String source, String description) {
    }

    // ---------------------------------------------------------------- 规则

    /** 首句：到第一个换行 / 「。」 / 后跟空白的英文句点，句末标点不计入长度。 */
    static String firstLine(String description) {
        String t = description.replace("\\n", "\n").strip();
        Matcher m = Pattern.compile("[。\\n]|\\.(?=\\s|$)").matcher(t);
        String line = m.find() ? t.substring(0, m.start()) : t;
        return line.strip();
    }

    private static final Pattern QUOTED = Pattern.compile("`[^`]*`|<[^>]*>|'[^']*'|\"[^\"]*\"|「[^」]*」");
    private static final Pattern LATIN = Pattern.compile("[A-Za-z][A-Za-z0-9_'\\-]*");
    /** 括号里纯 ASCII 的英文同义词（A5 允许，如 {@code （compare, redline）}）与文件扩展名（{@code .docx}）不算行文。 */
    private static final Pattern ALLOWED_ASCII = Pattern.compile("[（(][\\x00-\\x7F]*[）)]|\\.[A-Za-z0-9]+");
    private static final Set<String> SHORT_PROSE = Set.of("the", "and", "for", "not", "use", "with", "all", "can");

    /** zh = 含中日韩字符且没有英文行文词；en = 无中日韩字符；mixed = 中文里夹英文词组。标识符 / 引用 / 大写专名 / 缩写不算。 */
    static String language(String line) {
        if (!line.codePoints().anyMatch(c -> Character.UnicodeScript.of(c) == Character.UnicodeScript.HAN)) {
            return "en";
        }
        Matcher m = LATIN.matcher(ALLOWED_ASCII.matcher(QUOTED.matcher(line).replaceAll("")).replaceAll(""));
        while (m.find()) {
            String w = m.group();
            boolean identifier = w.contains("_") || w.matches(".*\\d.*") || w.matches(".*[a-z][A-Z].*");
            if (identifier || !Character.isLowerCase(w.charAt(0))) continue;
            if (w.length() >= 4 || SHORT_PROSE.contains(w)) return "mixed";
        }
        return "zh";
    }

    private static final List<String> NOT_VERB_FIRST = List.of("用户", "仅", "当", "如", "本工具", "该工具", "这个", "此工具",
            "只", "需要", "必须", "若", "凡", "每次", "先", "不要", "禁止", "不能", "不可", "所有", "任何", "一个", "工具");

    /** 动词开头：去掉前导【标签】后，不以名词 / 条件 / 禁令起手词开头。 */
    static boolean verbFirst(String line) {
        String t = line.replaceFirst("^(【[^】]*】\\s*)+", "");
        return !t.isEmpty() && NOT_VERB_FIRST.stream().noneMatch(t::startsWith);
    }

    /** 违规原因；空 = 合规。 */
    static List<String> violations(String description) {
        String line = firstLine(description);
        List<String> v = new ArrayList<>();
        if (line.length() > FIRST_LINE_MAX) v.add("首句 " + line.length() + " 字符 > " + FIRST_LINE_MAX);
        String lang = language(line);
        if (!"zh".equals(lang)) v.add("首句语言 " + lang);
        if (!verbFirst(line)) v.add("首句非动词开头");
        return v;
    }

    @Test
    @DisplayName("门禁规则自检")
    void rulesBehave() {
        assertTrue(violations("读取项目文件的纯文本。何时用：…").isEmpty());
        assertTrue(violations("【批注】删除一条批注（commentId 来自 doc_get_comments 返回的 id）。").isEmpty());
        assertTrue(violations("Ask the user ONE clarifying question.").toString().contains("en"));
        assertTrue(violations("按 the plan 读取").toString().contains("mixed"));
        assertTrue(violations("比对两份合同（compare, redline）").isEmpty());
        assertTrue(violations("用 Markdown 新建 .docx 文件").isEmpty());
        assertTrue(violations("用户问到群聊时用。").toString().contains("动词"));
        assertTrue(violations("读".repeat(81)).toString().contains("81"));
    }

    // ---------------------------------------------------------------- 清单

    @Test
    @DisplayName("注册的全部工具 == 清单 CSV 的现存工具行；描述门禁（keep/new 强制，其余仅报告）")
    void registeredToolsMatchInventoryAndDescriptionGate() throws Exception {
        assumeTrue(Files.isRegularFile(CSV) && Files.isDirectory(PLUGINS), "单独跑 backend 模块（没有 docs/ 与 official-plugins/）时跳过");
        Map<String, String> verdicts = new TreeMap<>();
        Set<String> planned = new TreeSet<>();
        for (Map<String, String> row : readCsv()) {
            if ("NEW".equals(row.get("source"))) planned.add(row.get("name"));
            else verdicts.put(row.get("name"), row.get("verdict"));
        }
        Map<String, Tool> registered = registeredTools();

        Set<String> missingFromCsv = new TreeSet<>(registered.keySet());
        missingFromCsv.removeAll(verdicts.keySet());
        Set<String> goneFromRegistry = new TreeSet<>(verdicts.keySet());
        goneFromRegistry.removeAll(registered.keySet());
        assertTrue(missingFromCsv.isEmpty() && goneFromRegistry.isEmpty(),
                "注册表与 docs/plans/tool-system-v2-inventory.csv 不一致。\n  已注册但 CSV 没有（新增工具：补一行，verdict=new，描述须过门禁；"
                        + "若是 CSV 里 source=NEW 的计划项，把 source 改成 builtin / plugin-*）：" + missingFromCsv
                        + "\n  CSV 有但已不存在（删除工具：删对应行）：" + goneFromRegistry
                        + "\n  计划中的 NEW 行：" + planned);

        List<String> enforced = new ArrayList<>();
        List<String> report = new ArrayList<>();
        int enforcedCount = 0;
        for (Tool tool : registered.values()) {
            List<String> v = violations(tool.description());
            boolean enforce = ENFORCED_VERDICTS.contains(verdicts.get(tool.name()));
            if (enforce) enforcedCount++;
            if (v.isEmpty()) continue;
            (enforce ? enforced : report).add(tool.name() + " [" + verdicts.get(tool.name()) + "] " + v + "  «"
                    + firstLine(tool.description()) + "»");
        }
        System.out.println("[tool-inventory] 已注册 " + registered.size() + " 个；门禁强制 " + enforcedCount
                + " 个，仅报告（待重写/合并/删除）违规 " + report.size() + " 个");
        report.forEach(l -> System.out.println("  [report-only] " + l));
        assertTrue(enforcedCount > 0, "没有任何强制行，裁决列读错了？");
        assertTrue(enforced.isEmpty(), "以下工具描述违反 A5 模板（首句 ≤" + FIRST_LINE_MAX
                + " 字符、单一语言中文、动词开头；见 docs/plans/tool-system-v2.md A5）：\n  " + String.join("\n  ", enforced));
    }

    // ---------------------------------------------------------------- 枚举

    private static Map<String, Tool> registeredTools() throws IOException {
        Map<String, Tool> all = new TreeMap<>();
        RecordingToolRegistry registry = new RecordingToolRegistry(RealToolBeans.instantiateAll(), new PluginService());
        registry.init();
        for (String name : registry.toolNamesLongestFirst()) {
            all.put(name, new Tool(name, "builtin", registry.resolve(name).orElseThrow().spec().description()));
        }
        try (Stream<Path> dirs = Files.list(PLUGINS)) {
            for (Path dir : dirs.sorted().toList()) {
                Path manifest = dir.resolve("manifest.json");
                if (!Files.isRegularFile(manifest)) continue;
                JsonNode tools = JSON.readTree(manifest.toFile()).path("tools");
                if (!tools.isArray()) continue;
                Map<String, String> jarDescriptions = jarToolDescriptions(dir);
                JsonNode l10n = zhL10n(dir);
                for (JsonNode t : tools) {
                    String name = t.path("name").asText();
                    String desc = jarDescriptions.getOrDefault(name, t.path("description").asText());
                    if (desc.startsWith("%") && desc.endsWith("%")) {
                        desc = l10n.path(desc.substring(1, desc.length() - 1)).asText(desc);
                    }
                    all.put(name, new Tool(name, "plugin:" + dir.getFileName(), desc));
                }
            }
        }
        return all;
    }

    private static JsonNode zhL10n(Path pluginDir) throws IOException {
        Path file = pluginDir.resolve("l10n").resolve("zh-CN.json");
        return Files.isRegularFile(file) ? JSON.readTree(file.toFile()) : JSON.createObjectNode();
    }

    private static final Pattern JAR_TOOL =
            Pattern.compile("@Tool\\(\"((?:[^\"\\\\]|\\\\.)*)\"\\)\\s*public\\s+String\\s+(\\w+)\\(");

    /** 插件 JAR 的 {@code @Tool} 文案才是模型看到的描述（manifest 里的 description 只是目录文案）。 */
    private static Map<String, String> jarToolDescriptions(Path pluginDir) throws IOException {
        Map<String, String> out = new LinkedHashMap<>();
        Path src = pluginDir.resolve("backend").resolve("src").resolve("main").resolve("java");
        if (!Files.isDirectory(src)) return out;
        try (Stream<Path> files = Files.walk(src)) {
            for (Path f : files.filter(p -> p.toString().endsWith(".java")).toList()) {
                Matcher m = JAR_TOOL.matcher(Files.readString(f, StandardCharsets.UTF_8));
                while (m.find()) out.put(m.group(2), m.group(1).replace("\\\"", "\"").replace("\\n", "\n"));
            }
        }
        return out;
    }

    // ---------------------------------------------------------------- CSV

    private static List<Map<String, String>> readCsv() throws IOException {
        List<List<String>> records = parseCsv(Files.readString(CSV, StandardCharsets.UTF_8));
        List<String> header = records.get(0);
        List<Map<String, String>> rows = new ArrayList<>();
        for (List<String> r : records.subList(1, records.size())) {
            Map<String, String> row = new LinkedHashMap<>();
            for (int i = 0; i < header.size(); i++) row.put(header.get(i), i < r.size() ? r.get(i) : "");
            rows.add(row);
        }
        return rows;
    }

    /** RFC 4180 的最小实现：双引号字段内可含逗号、换行与 "" 转义。 */
    static List<List<String>> parseCsv(String text) {
        List<List<String>> records = new ArrayList<>();
        List<String> cur = new ArrayList<>();
        StringBuilder field = new StringBuilder();
        boolean quoted = false;
        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            if (quoted) {
                if (c == '"' && i + 1 < text.length() && text.charAt(i + 1) == '"') {
                    field.append('"');
                    i++;
                } else if (c == '"') {
                    quoted = false;
                } else {
                    field.append(c);
                }
            } else if (c == '"') {
                quoted = true;
            } else if (c == ',') {
                cur.add(field.toString());
                field.setLength(0);
            } else if (c == '\n' || c == '\r') {
                if (c == '\r' && i + 1 < text.length() && text.charAt(i + 1) == '\n') i++;
                cur.add(field.toString());
                field.setLength(0);
                records.add(cur);
                cur = new ArrayList<>();
            } else {
                field.append(c);
            }
        }
        if (field.length() > 0 || !cur.isEmpty()) {
            cur.add(field.toString());
            records.add(cur);
        }
        records.removeIf(r -> r.size() == 1 && r.get(0).isEmpty());
        return records;
    }
}
