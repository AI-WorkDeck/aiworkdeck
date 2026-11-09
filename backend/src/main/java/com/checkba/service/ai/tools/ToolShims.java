// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ai.tools;

/** {@link ToolShim} 兼容壳共用的回执提示，以及「旧名 → 新名」映射表（用户自建 skill 的 allowed_tools 迁移用）。 */
public final class ToolShims {

    private ToolShims() {
    }

    /**
     * 旧名 → 新名。与各 {@code @ToolShim(replacedBy)} 逐项一致，由 {@code ToolShimContractTest} 钉住；
     * 0.83 删壳时整张表一起删。
     */
    private static final java.util.Map<String, String> REPLACED_BY = java.util.Map.ofEntries(
            java.util.Map.entry("doc_accept_revision", "doc_revisions"),
            java.util.Map.entry("doc_reject_revision", "doc_revisions"),
            java.util.Map.entry("doc_accept_all_revisions", "doc_revisions"),
            java.util.Map.entry("doc_reject_all_revisions", "doc_revisions"),
            java.util.Map.entry("doc_reply_comment", "doc_update_comment"),
            java.util.Map.entry("doc_resolve_comment", "doc_update_comment"),
            java.util.Map.entry("doc_table_add_row", "doc_table_insert"),
            java.util.Map.entry("doc_table_add_col", "doc_table_insert"),
            java.util.Map.entry("doc_table_delete_row", "doc_table_delete"),
            java.util.Map.entry("doc_table_delete_col", "doc_table_delete"),
            java.util.Map.entry("doc_insert_footnote", "doc_insert_note"),
            java.util.Map.entry("doc_insert_endnote", "doc_insert_note"),
            java.util.Map.entry("doc_goto", "doc_select"),
            java.util.Map.entry("doc_select_anchor", "doc_select"),
            java.util.Map.entry("doc_select_paragraph", "doc_select"),
            java.util.Map.entry("doc_collapse_cursor", "doc_select"),
            java.util.Map.entry("office_accept_revision", "office_revisions"),
            java.util.Map.entry("office_reject_revision", "office_revisions"),
            java.util.Map.entry("office_reply_comment", "office_update_comment"),
            java.util.Map.entry("office_resolve_comment", "office_update_comment"),
            java.util.Map.entry("office_excel_reply_comment", "office_excel_update_comment"),
            java.util.Map.entry("office_excel_resolve_comment", "office_excel_update_comment"),
            java.util.Map.entry("office_table_add_row", "office_table_insert"),
            java.util.Map.entry("office_table_add_col", "office_table_insert"),
            java.util.Map.entry("office_table_delete_row", "office_table_delete"),
            java.util.Map.entry("office_table_delete_col", "office_table_delete"),
            java.util.Map.entry("office_insert_footnote", "office_insert_note"),
            java.util.Map.entry("office_insert_endnote", "office_insert_note"),
            java.util.Map.entry("office_file_create", "office_file"),
            java.util.Map.entry("office_file_save", "office_file"),
            java.util.Map.entry("office_file_export_pdf", "office_file"),
            java.util.Map.entry("office_file_open", "office_file"),
            java.util.Map.entry("office_excel_set_formulas", "office_excel_set_values"),
            java.util.Map.entry("pdf_split", "pdf_pages"),
            java.util.Map.entry("pdf_extract_pages", "pdf_pages"),
            java.util.Map.entry("pdf_rotate_pages", "pdf_pages"),
            java.util.Map.entry("pptx_generate_outline", "pptx_outline"),
            java.util.Map.entry("pptx_refine_outline", "pptx_outline"),
            java.util.Map.entry("law_search_keyword", "law_search"),
            java.util.Map.entry("text_write_file", "write_file"),
            java.util.Map.entry("move_files_batch", "move_files"),
            java.util.Map.entry("move_project_file", "move_files"),
            java.util.Map.entry("list_project_folders", "doc_list_project_files"),
            java.util.Map.entry("search_across_projects", "search_project_files"),
            java.util.Map.entry("capability_apply", "capability_install"));

    /** 旧名对应的新名；不是壳名字时原样返回。 */
    public static String canonical(String toolName) {
        return REPLACED_BY.getOrDefault(toolName, toolName);
    }

    /** 映射表本身（只读），供契约测试逐项对拍 {@code @ToolShim}。 */
    public static java.util.Map<String, String> replacements() {
        return REPLACED_BY;
    }

    /** 在回执末尾追加「已并入」提示；{@code call} 是新工具的调用写法示例，如 {@code doc_revisions(action=accept, index=…)}。 */
    public static String hint(String result, String replacedBy, String call) {
        return (result == null ? "" : result)
                + "\n（提示：此工具已并入 " + replacedBy + "，下次请直接调用 " + call + "）";
    }
}
