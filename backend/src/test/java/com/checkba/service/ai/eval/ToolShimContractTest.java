// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ai.eval;

import com.checkba.service.ai.ClientCapabilityService;
import com.checkba.service.ai.PluginService;
import com.checkba.service.ai.ToolRegistry;
import com.checkba.service.ai.tools.AgentToolComponent;
import com.checkba.service.ai.tools.ToolMeta;
import com.checkba.service.ai.tools.ToolShims;
import dev.langchain4j.agent.tool.Tool;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.lang.reflect.Method;
import java.util.List;
import java.util.Set;
import java.util.TreeSet;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * V4/V5 合并留下的旧工具名：V9 已删掉全部 {@code @ToolShim} 兼容壳（docs/plans/tool-system-v2.md E1）。
 *
 * <p>钉住三件事：旧名不再是注册的 {@code @Tool} 方法；{@link ToolShims} 的旧名 → 新名表覆盖全部 48 个旧名且新名都已注册并下发；
 * 调到旧名时，参数完全相同的纯改名（{@code move_files_batch}、{@code capability_apply}）按新名执行，其余返回「已改名为 X」的错误。
 */
public class ToolShimContractTest {

    /** V4 合并删掉的 45 个旧名。 */
    static final Set<String> V4_REMOVED = Set.of(
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

    /** V5 会议合流删掉的 3 个旧名。 */
    static final Set<String> V5_REMOVED = Set.of("meeting_list_recordings", "tmeet_list_meetings", "tmeet_get_transcript");

    /** 参数与新工具完全相同、调到时直接按新名执行的旧名。 */
    static final Set<String> SAME_ARGS = Set.of("move_files_batch", "capability_apply");

    private static Set<String> allRemoved() {
        Set<String> all = new TreeSet<>(V4_REMOVED);
        all.addAll(V5_REMOVED);
        return all;
    }

    @Test
    @DisplayName("旧名都不再是 @Tool 方法，也不再注册；映射表恰好覆盖这 48 个旧名，指向的新名已注册并下发")
    void removedNamesAreGoneAndMapToOfferedTools() {
        Set<String> toolMethods = new TreeSet<>();
        for (AgentToolComponent bean : RealToolBeans.instantiateAll()) {
            for (Method m : bean.getClass().getDeclaredMethods()) {
                if (m.isAnnotationPresent(Tool.class)) toolMethods.add(m.getName());
            }
        }
        Set<String> leftover = new TreeSet<>(allRemoved());
        leftover.retainAll(toolMethods);
        assertTrue(leftover.isEmpty(), "这些旧名又成了 @Tool 方法：" + leftover);

        assertEquals(allRemoved(), new TreeSet<>(ToolShims.replacements().keySet()));

        RecordingToolRegistry registry = new RecordingToolRegistry(RealToolBeans.instantiateAll(), new PluginService());
        registry.init();
        Set<String> offered = new TreeSet<>();
        registry.getAllSpecifications().forEach(spec -> offered.add(spec.name()));
        ToolShims.replacements().forEach((oldName, newName) -> {
            assertTrue(registry.resolve(oldName).isEmpty(), oldName + " 不该再注册");
            assertFalse(offered.contains(oldName), oldName);
            assertTrue(offered.contains(newName), oldName + " 指向的 " + newName + " 必须已注册并下发");
        });
        assertEquals("doc_revisions", ToolShims.canonical("doc_accept_revision"));
        assertEquals("doc_revisions", ToolShims.canonical("doc_revisions"));
    }

    @Test
    @DisplayName("调到旧名：纯改名按新名执行并附提示，其余返回「renamed to X」错误且 found=false；未知名字仍是原那句")
    void callingRemovedNamesResolvesOrErrs() {
        for (String oldName : allRemoved()) {
            String target = ToolShims.sameArgsTarget(oldName);
            if (SAME_ARGS.contains(oldName)) {
                assertEquals(ToolShims.canonical(oldName), target);
            } else {
                assertNull(target, oldName + " 参数和新工具不同，不能静默改道");
                String msg = ToolRegistry.unknownToolMessage(oldName);
                assertTrue(msg.startsWith("Error: tool '" + oldName + "' was renamed to '" + ToolShims.canonical(oldName) + "'"), msg);
                assertTrue(msg.contains("Call " + ToolShims.canonical(oldName) + "("), msg);
            }
        }
        assertEquals("Tool not found or arguments invalid.", ToolRegistry.unknownToolMessage("no_such_tool"));

        ToolRegistry registry = new ToolRegistry(List.of(new FakeTools()), new PluginService(), new ClientCapabilityService());
        registry.init();
        // 渲染期（无 ctx）也能走通：旧名 → 新名执行、回执末尾附提示
        ToolRegistry.ToolResult moved = registry.execute("move_files_batch", "{\"movesJson\":\"[]\"}", null);
        assertTrue(moved.found());
        assertTrue(moved.output().startsWith("moved []"), moved.output());
        assertTrue(moved.output().contains("move_files_batch 已并入 move_files"), moved.output());

        ToolRegistry.ToolResult renamed = registry.execute("doc_accept_revision", "{\"index\":1}", null);
        assertFalse(renamed.found());
        assertTrue(renamed.output().contains("was renamed to 'doc_revisions'"), renamed.output());
    }

    @Test
    @DisplayName("确认闸按新名判：纯改名的旧名指向 destructive 工具时同样要确认")
    void sameArgsRenameIsGatedLikeTheNewTool() {
        ToolRegistry registry = new ToolRegistry(List.of(new FakeTools()), new PluginService(), new ClientCapabilityService());
        registry.init();
        assertTrue(registry.requiresConfirmation("capability_install"));
        assertTrue(registry.requiresConfirmation("capability_apply"));
        assertFalse(registry.requiresConfirmation("move_files_batch"));
    }

    @Test
    @DisplayName("TOOL_NAME_ALIASES 保持空表：旧名走 ToolShims 的改名表，不走静默别名")
    void aliasTableStaysEmpty() {
        assertTrue(ToolRegistry.TOOL_NAME_ALIASES.isEmpty());
    }

    public static class FakeTools implements AgentToolComponent {
        @ToolMeta(displayName = "移动")
        @Tool("move")
        public String move_files(String movesJson) { return "moved " + movesJson; }

        @ToolMeta(displayName = "安装", access = ToolMeta.Access.DESTRUCTIVE)
        @Tool("install")
        public String capability_install(String planId) { return "installed " + planId; }

        @ToolMeta(displayName = "修订")
        @Tool("revisions")
        public String doc_revisions(String action, Integer index) { return "ok"; }
    }
}
