// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ai.eval;

import com.checkba.service.ai.PluginService;
import com.checkba.service.ai.ToolRegistry;
import com.checkba.service.ai.tools.AgentToolComponent;
import com.checkba.service.ai.tools.ToolMeta;
import com.checkba.service.ai.tools.ToolShim;
import com.fasterxml.jackson.databind.ObjectMapper;
import dev.langchain4j.agent.tool.Tool;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.lang.reflect.Method;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * V4 兼容壳的契约与到期绊线（docs/plans/tool-system-v2.md E1）。
 *
 * <p>壳 = 带 {@link ToolShim} 的旧名方法：注册但不下发（offerToModel=false），指向的新工具必须存在且下发；
 * 逐名钉住，新增/删除都要来改 {@link #V4_SHIMS}。{@link #shimsMustBeDeletedBeforeTheirUntilVersion} 读
 * {@code desktop/package.json} 的版本号，到 0.83 变红——提醒删壳，别让兼容壳像 deep_search 一样滞留五个版本。
 */
class ToolShimContractTest {

    /** V4 合并留下的 45 个旧名壳（0.83 删除）。 */
    static final Set<String> V4_SHIMS = Set.of(
            "doc_accept_revision", "doc_reject_revision", "doc_accept_all_revisions", "doc_reject_all_revisions",
            "doc_reply_comment", "doc_resolve_comment",
            "doc_table_add_row", "doc_table_delete_row", "doc_table_add_col", "doc_table_delete_col",
            "doc_insert_footnote", "doc_insert_endnote",
            "doc_goto", "doc_select_anchor", "doc_select_paragraph", "doc_collapse_cursor",
            "office_accept_revision", "office_reject_revision",
            "office_reply_comment", "office_resolve_comment", "office_excel_reply_comment", "office_excel_resolve_comment",
            "office_table_add_row", "office_table_delete_row", "office_table_add_col", "office_table_delete_col",
            "office_insert_footnote", "office_insert_endnote",
            "office_file_create", "office_file_save", "office_file_export_pdf", "office_file_open",
            "office_excel_set_formulas",
            "pdf_split", "pdf_extract_pages", "pdf_rotate_pages",
            "pptx_generate_outline", "pptx_refine_outline",
            "law_search_keyword", "text_write_file", "move_files_batch", "move_project_file",
            "list_project_folders", "search_across_projects", "capability_apply");

    private record Shim(String name, ToolShim shim, ToolMeta meta) {
    }

    private static Map<String, Shim> declaredShims() {
        Map<String, Shim> out = new TreeMap<>();
        for (AgentToolComponent bean : RealToolBeans.instantiateAll()) {
            for (Method m : bean.getClass().getDeclaredMethods()) {
                ToolShim shim = m.getAnnotation(ToolShim.class);
                if (shim != null) {
                    assertTrue(m.isAnnotationPresent(Tool.class), m.getName() + " 带 @ToolShim 却不是 @Tool");
                    out.put(m.getName(), new Shim(m.getName(), shim, m.getAnnotation(ToolMeta.class)));
                }
            }
        }
        return out;
    }

    @Test
    @DisplayName("兼容壳逐名钉住；每个壳都是只登记不下发，且指向的新工具已注册并下发")
    void shimsArePinnedHiddenAndPointAtOfferedTools() {
        Map<String, Shim> shims = declaredShims();
        assertEquals(new TreeSet<>(V4_SHIMS), shims.keySet());

        ToolRegistry registry = new RecordingToolRegistry(RealToolBeans.instantiateAll(), new PluginService());
        ((RecordingToolRegistry) registry).init();
        Set<String> offered = new TreeSet<>();
        registry.getAllSpecifications().forEach(spec -> offered.add(spec.name()));
        for (Shim s : shims.values()) {
            assertTrue(s.meta() != null && !s.meta().offerToModel(), s.name() + " 是兼容壳，必须 offerToModel=false");
            assertTrue(registry.resolve(s.name()).isPresent(), s.name() + " 兼容壳必须仍注册（旧对话回放与 XML 兜底）");
            assertFalse(offered.contains(s.name()), s.name() + " 不该下发给模型");
            assertTrue(offered.contains(s.shim().replacedBy()), s.name() + " 指向的 " + s.shim().replacedBy() + " 必须已注册并下发");
            assertTrue(registry.resolve(s.shim().replacedBy()).isPresent());
        }
    }

    @Test
    @DisplayName("ToolShims 的旧名→新名映射表与各 @ToolShim(replacedBy) 逐项一致（SkillRegistry 迁移用户自建 skill 白名单靠它）")
    void replacementTableMatchesAnnotations() {
        Map<String, String> fromAnnotations = new TreeMap<>();
        declaredShims().forEach((name, shim) -> fromAnnotations.put(name, shim.shim().replacedBy()));
        assertEquals(fromAnnotations, new TreeMap<>(com.checkba.service.ai.tools.ToolShims.replacements()));
        assertEquals("doc_revisions", com.checkba.service.ai.tools.ToolShims.canonical("doc_accept_revision"));
        assertEquals("doc_revisions", com.checkba.service.ai.tools.ToolShims.canonical("doc_revisions"));
    }

    @Test
    @DisplayName("TOOL_NAME_ALIASES 保持空表：更名走 @ToolShim，不走静默别名")
    void aliasTableStaysEmpty() {
        assertTrue(ToolRegistry.TOOL_NAME_ALIASES.isEmpty());
    }

    @Test
    @DisplayName("绊线：desktop/package.json 版本到兼容壳的 until（0.83）就变红——删掉所有 @ToolShim 方法、V4_SHIMS、CSV 里的壳行与 toolDisplayNames 之外的引用")
    void shimsMustBeDeletedBeforeTheirUntilVersion() throws Exception {
        Path pkg = Path.of("..", "desktop", "package.json");
        org.junit.jupiter.api.Assumptions.assumeTrue(Files.isRegularFile(pkg), "单独跑 backend 模块时没有 desktop/，跳过");
        String version = new ObjectMapper().readTree(pkg.toFile()).path("version").asText();
        for (Shim s : declaredShims().values()) {
            assertTrue(compare(version, s.shim().until()) < 0,
                    "当前版本 " + version + " 已到 " + s.name() + " 兼容壳的 until=" + s.shim().until()
                            + "：按 tool-system-v2 E1 删除所有 @ToolShim 壳（V9 收尾），不要往后顺延");
        }
    }

    /** 逐段比较 major.minor.patch（忽略预发布后缀）。 */
    static int compare(String a, String b) {
        String[] x = a.split("[.-]");
        String[] y = b.split("[.-]");
        for (int i = 0; i < 3; i++) {
            int xi = i < x.length && x[i].matches("\\d+") ? Integer.parseInt(x[i]) : 0;
            int yi = i < y.length && y[i].matches("\\d+") ? Integer.parseInt(y[i]) : 0;
            if (xi != yi) return Integer.compare(xi, yi);
        }
        return 0;
    }

    @Test
    @DisplayName("版本比较自检：0.82.9 < 0.83，0.83.0 == 0.83，0.100 > 0.83")
    void versionCompareBehaves() {
        assertTrue(compare("0.82.9", "0.83") < 0);
        assertEquals(0, compare("0.83.0", "0.83"));
        assertTrue(compare("0.100.0", "0.83") > 0);
    }
}
