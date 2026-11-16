// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ai;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 网页版编辑器工具 ⊆ 网页执行器能力（W1 设计 §4.3 / §4.6 第二条测试）。
 *
 * <p>{@link WebClientToolSurface#EDITOR_EXECUTED_TOOLS} 里的每个工具，逐个映射到它经
 * {@code EditorBridgeService.executeEditorCommand} 发出的编辑器 action（{@link #EMITTED_ACTIONS}），
 * 映射与源码对拍（不许漂移），action 必须全在官网 vendor 版本导出的执行器能力清单里。
 *
 * <p><b>能力清单副本</b>：{@code src/test/resources/web-client/editor-capabilities.json}，
 * 取自官网仓 {@code AI-WorkDeck/aiworkdeck-website} 的 {@code web-workbench/src/editor-capabilities.json}，
 * 钉在 {@link #PINNED_WEBSITE_COMMIT}（清单自己的 {@code source.commit} 记的是它 vendor 的主仓编辑器版本）。
 * 官网 vendor 追版后刷新：
 * <pre>
 * gh api "repos/AI-WorkDeck/aiworkdeck-website/contents/web-workbench/src/editor-capabilities.json?ref=&lt;官网提交&gt;" \
 *   -H 'Accept: application/vnd.github.raw' &gt; backend/src/test/resources/web-client/editor-capabilities.json
 * </pre>
 * 然后把 {@link #PINNED_WEBSITE_COMMIT} / {@link #PINNED_CORE_COMMIT} / {@link #PINNED_ENGINE} 改成新值。
 * 这条测试红了，意思是后端会下发网页执行器不认识的 action（静默错改或 30 秒死等）：
 * 要么追平网页 vendor，要么把那个工具移出 WEB 白名单。
 */
class ClientCapabilityWebEditorActionsTest {

    /** 官网仓提交（PR #26 feat/web-editor-engine-sync 的头）。 */
    static final String PINNED_WEBSITE_COMMIT = "c58948352fca3e0d31bf03e04edf049882096f7a";
    /** 清单 source.commit：官网 vendor 的主仓编辑器版本。 */
    static final String PINNED_CORE_COMMIT = "f8ccb05363fbe0a94c215059ff10c3e0eb731ce1";
    static final String PINNED_ENGINE = "24.2.8-zhcn-r8";

    /** 编辑器执行的工具 → 它发出的编辑器 action（与源码对拍，见 {@link #emittedBySource}）。 */
    static final Map<String, Set<String>> EMITTED_ACTIONS = new TreeMap<>(Map.ofEntries(
            Map.entry("doc_get_document_text", Set.of("get_document_text")),
            Map.entry("doc_get_clauses", Set.of("get_clauses")),
            Map.entry("doc_get_paragraph", Set.of("get_paragraph")),
            Map.entry("doc_get_outline", Set.of("get_outline")),
            Map.entry("doc_get_cursor_context", Set.of("get_cursor_context")),
            Map.entry("doc_get_formatting", Set.of("get_formatting")),
            Map.entry("doc_get_comments", Set.of("list_comments")),
            Map.entry("doc_audit_structure", Set.of("list_revisions")),
            Map.entry("doc_list_revisions", Set.of("list_revisions")),
            Map.entry("doc_table_read", Set.of("table_read")),
            Map.entry("doc_find_text", Set.of("find_text_locations")),
            Map.entry("doc_select", Set.of("goto", "set_selection", "select_paragraph", "collapse_selection")),
            Map.entry("doc_replace_at_anchor", Set.of("replace_at_position")),
            Map.entry("doc_replace_selection", Set.of("replace_selection")),
            Map.entry("doc_find_replace", Set.of("find_replace")),
            Map.entry("doc_insert_at_cursor", Set.of("insert_at_cursor", "set_selection", "collapse_selection")),
            Map.entry("doc_insert_under_heading", Set.of("insert_under_heading")),
            Map.entry("doc_modify_paragraph", Set.of("modify_paragraph")),
            Map.entry("doc_delete_selection", Set.of("delete_selection")),
            Map.entry("doc_insert_break", Set.of("insert_break")),
            Map.entry("doc_insert_note", Set.of("insert_footnote", "insert_endnote")),
            Map.entry("doc_insert_image", Set.of("insert_image")),
            Map.entry("doc_insert_table", Set.of("insert_table")),
            Map.entry("doc_insert_toc", Set.of("insert_toc")),
            Map.entry("doc_set_hyperlink", Set.of("set_hyperlink_at_anchor")),
            Map.entry("doc_undo", Set.of("undo")),
            Map.entry("doc_redo", Set.of("redo")),
            Map.entry("doc_format_selection", Set.of("format_selection")),
            Map.entry("doc_set_paragraph_format", Set.of("set_paragraph_format")),
            Map.entry("doc_set_style", Set.of("set_style")),
            Map.entry("doc_set_numbering", Set.of("set_numbering")),
            Map.entry("doc_set_page_setup", Set.of("set_page_setup")),
            Map.entry("doc_edit_header_footer", Set.of("edit_header_footer")),
            Map.entry("doc_format_table", Set.of("format_table")),
            Map.entry("doc_apply_standard_format", Set.of("apply_house_style")),
            Map.entry("doc_apply_style_profile", Set.of("apply_style_profile", "set_style_profile")),
            Map.entry("doc_table_insert", Set.of("table_add_row", "table_add_col")),
            Map.entry("doc_table_set_cell", Set.of("table_set_cell")),
            Map.entry("doc_table_delete", Set.of("table_delete_row", "table_delete_col")),
            Map.entry("doc_add_comment", Set.of("add_comment")),
            Map.entry("doc_update_comment", Set.of("reply_comment", "set_comment_resolved")),
            Map.entry("doc_delete_comment", Set.of("delete_comment")),
            Map.entry("doc_revisions", Set.of("list_revisions", "resolve_revision", "resolve_all_revisions")),
            Map.entry("doc_link_evidence", Set.of("find_text_locations", "set_selection", "bookmark_selection",
                    "set_selection_hyperlink", "get_bookmark_context", "clear_anchors"))));

    /** 工具把编辑器调用委托给别的类时，连那个类一起扫（工具名 → 源文件）。 */
    private static final Map<String, Path> DELEGATES = Map.of(
            "doc_link_evidence", Path.of("src/main/java/com/checkba/service/evidence/EvidenceAnchorService.java"));

    /**
     * 宿主处理的工具发出的、<b>不</b>由编辑器执行的 action（网页客户端 P5 自己实现宿主处理器）。
     * 宿主处理的工具若发出这之外的编辑器 action，那个 action 同样必须在能力清单里。
     */
    private static final Set<String> HOST_ACTIONS = Set.of("doc_open_file_sync");

    private static final Path TOOLS_DIR = Path.of("src/main/java/com/checkba/service/ai/tools");
    private static final Pattern LITERAL_ACTION =
            Pattern.compile("executeEditorCommand\\(\\s*\"([a-z_]+)\"");

    private static JsonNode capabilities() throws IOException {
        try (InputStream in = ClientCapabilityWebEditorActionsTest.class
                .getResourceAsStream("/web-client/editor-capabilities.json")) {
            return new ObjectMapper().readTree(in);
        }
    }

    private static Set<String> editorActions() throws IOException {
        Set<String> actions = new TreeSet<>();
        capabilities().path("editorActions").forEach(a -> actions.add(a.asText()));
        return actions;
    }

    @Test
    @DisplayName("能力清单副本钉在已知来源：官网提交、主仓编辑器版本、引擎、只开 docx")
    void capabilityCopyIsPinned() throws IOException {
        JsonNode caps = capabilities();
        assertEquals(1, caps.path("schemaVersion").asInt());
        assertEquals(PINNED_CORE_COMMIT, caps.path("source").path("commit").asText());
        assertEquals(PINNED_ENGINE, caps.path("engineVersion").asText());
        assertEquals("[\"docx\"]", caps.path("documentKinds").toString());
        assertTrue(editorActions().size() > 100, "清单太短，副本坏了");
        assertEquals(40, PINNED_WEBSITE_COMMIT.length());
    }

    @Test
    @DisplayName("映射表恰好覆盖编辑器执行的 WEB 工具（宿主处理与纯后端的不在里面）")
    void mappingCoversExactlyTheEditorExecutedTools() {
        assertEquals(new TreeSet<>(WebClientToolSurface.EDITOR_EXECUTED_TOOLS), new TreeSet<>(EMITTED_ACTIONS.keySet()));
        for (String tool : WebClientToolSurface.HOST_HANDLED_TOOLS) {
            assertFalse(WebClientToolSurface.EDITOR_EXECUTED_TOOLS.contains(tool), tool);
        }
        for (String tool : List.of("doc_list_project_files", "doc_list_evidence")) {
            assertTrue(WebClientToolSurface.BACKEND_TOOLS.contains(tool), tool + " 是纯后端");
            assertFalse(WebClientToolSurface.EDITOR_TOOLS.contains(tool), tool);
        }
    }

    @Test
    @DisplayName("每个编辑器执行工具发出的 action 都在网页执行器能力清单里")
    void everyEmittedActionIsSupportedByTheWebExecutor() throws IOException {
        Set<String> supported = editorActions();
        List<String> missing = new ArrayList<>();
        EMITTED_ACTIONS.forEach((tool, actions) -> {
            for (String action : actions) if (!supported.contains(action)) missing.add(tool + " → " + action);
        });
        assertTrue(missing.isEmpty(), "网页执行器（vendor " + PINNED_CORE_COMMIT + "）不认识这些 action："
                + missing + "。追平官网 vendor 并刷新能力清单副本，或把工具移出 WEB 白名单。");
    }

    @Test
    @DisplayName("映射表与源码一致：工具实际发出的 action 不多不少")
    void mappingMatchesTheSource() throws IOException {
        List<String> drift = new ArrayList<>();
        for (String tool : WebClientToolSurface.EDITOR_EXECUTED_TOOLS) {
            Set<String> fromSource = emittedBySource(tool);
            assertFalse(fromSource.isEmpty(), tool + "：源码里一个编辑器 action 都没扫到（扫描口径坏了，还是它其实不经编辑器？）");
            if (!fromSource.equals(EMITTED_ACTIONS.get(tool))) {
                drift.add(tool + " 源码=" + fromSource + " 映射=" + EMITTED_ACTIONS.get(tool));
            }
        }
        assertTrue(drift.isEmpty(), "改了工具发出的编辑器 action，请同步 EMITTED_ACTIONS：\n  "
                + String.join("\n  ", drift));
    }

    @Test
    @DisplayName("宿主处理的工具不发能力清单外的编辑器 action（除了宿主自己拦截的那几个）")
    void hostHandledToolsOnlyEmitHostActions() throws IOException {
        Set<String> supported = editorActions();
        for (String tool : WebClientToolSurface.HOST_HANDLED_TOOLS) {
            for (String action : emittedBySource(tool)) {
                assertTrue(HOST_ACTIONS.contains(action) || supported.contains(action), tool + " → " + action);
            }
        }
        assertEquals(Set.of("doc_open_file_sync"), emittedBySource("doc_start_stream"),
                "doc_start_stream 的打开指令由宿主拦截；变了就回头看网页客户端的宿主处理器");
    }

    // ---------------------------------------------------------------- 源码扫描

    /**
     * 工具方法体 + 它直接调用的同类方法体里，{@code executeEditorCommand("字面量"} 的 action；
     * 以及传给「把首参原样当 action 转发」的辅助方法的字面量（如 {@code dispatchInsertNote("insert_footnote", …)}）。
     * 委托类（{@link #DELEGATES}）整类扫。
     */
    static Set<String> emittedBySource(String tool) throws IOException {
        Path file = sourceOf(tool);
        String text = Files.readString(file);
        String masked = mask(text);
        Set<String> actions = new TreeSet<>();
        for (String body : bodies(text, masked, tool)) {
            actions.addAll(literalActions(body));
            Matcher call = Pattern.compile("(?<![\\w.])(\\w+)\\(\\s*(?:\"([a-z_]+)\")?").matcher(body);
            while (call.find()) {
                String callee = call.group(1);
                if (callee.equals(tool)) continue;
                for (String helper : bodies(text, masked, callee)) {
                    actions.addAll(literalActions(helper));
                    if (call.group(2) != null && Pattern.compile("executeEditorCommand\\(\\s*action\\b").matcher(helper).find()) {
                        actions.add(call.group(2));
                    }
                }
            }
        }
        Path delegate = DELEGATES.get(tool);
        if (delegate != null) actions.addAll(literalActions(Files.readString(delegate)));
        return actions;
    }

    private static Path sourceOf(String tool) throws IOException {
        try (var files = Files.list(TOOLS_DIR)) {
            for (Path p : files.filter(f -> f.toString().endsWith(".java")).sorted().toList()) {
                if (Pattern.compile("String " + tool + "\\(").matcher(Files.readString(p)).find()) return p;
            }
        }
        throw new IllegalStateException("找不到工具 " + tool + " 的源文件");
    }

    private static Set<String> literalActions(String text) {
        Set<String> out = new TreeSet<>();
        Matcher m = LITERAL_ACTION.matcher(text);
        while (m.find()) out.add(m.group(1));
        return out;
    }

    /** 方法声明（不是调用）对应的方法体；括号与花括号在 masked 文本上配对，取原文。 */
    private static List<String> bodies(String text, String masked, String name) {
        List<String> out = new ArrayList<>();
        Matcher m = Pattern.compile("\\b" + Pattern.quote(name) + "\\s*\\(").matcher(masked);
        while (m.find()) {
            String before = masked.substring(Math.max(0, m.start() - 60), m.start());
            if (!Pattern.compile("[\\w>\\]]\\s+$").matcher(before).find()
                    || Pattern.compile("(?:return|new|throw)\\s+$").matcher(before).find()) continue;
            int k = m.end();
            int depth = 1;
            while (depth > 0) {
                char c = masked.charAt(k++);
                if (c == '(') depth++;
                else if (c == ')') depth--;
            }
            Matcher open = Pattern.compile("^\\s*(?:throws[^{;]*)?\\{").matcher(masked.substring(k));
            if (!open.find()) continue;
            int start = k + open.end() - 1;
            int end = start;
            depth = 0;
            do {
                char c = masked.charAt(end++);
                if (c == '{') depth++;
                else if (c == '}') depth--;
            } while (depth > 0);
            out.add(text.substring(start, end));
        }
        return out;
    }

    /** 抹掉字符串、字符字面量与注释的内容（保留长度与换行），让括号配对不被字面量里的括号干扰。 */
    static String mask(String t) {
        char[] o = t.toCharArray();
        int i = 0;
        int n = t.length();
        while (i < n) {
            if (t.startsWith("\"\"\"", i)) {
                int j = t.indexOf("\"\"\"", i + 3);
                for (int k = i + 3; k < j; k++) if (o[k] != '\n') o[k] = ' ';
                i = j + 3;
            } else if (t.charAt(i) == '"' || t.charAt(i) == '\'') {
                char q = t.charAt(i);
                int j = i + 1;
                while (t.charAt(j) != q) j += t.charAt(j) == '\\' ? 2 : 1;
                for (int k = i + 1; k < j; k++) o[k] = 'x';
                i = j + 1;
            } else if (t.startsWith("//", i)) {
                int j = t.indexOf('\n', i);
                if (j < 0) j = n;
                for (int k = i; k < j; k++) o[k] = ' ';
                i = j;
            } else if (t.startsWith("/*", i)) {
                int j = t.indexOf("*/", i) + 2;
                for (int k = i; k < j; k++) if (o[k] != '\n') o[k] = ' ';
                i = j;
            } else {
                i++;
            }
        }
        return new String(o);
    }
}
