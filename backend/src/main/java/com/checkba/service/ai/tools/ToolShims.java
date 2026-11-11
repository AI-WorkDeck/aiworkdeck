// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ai.tools;

import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * 已删除的旧工具名（tool-system-v2 V4/V5 合并，V9 删掉了 {@code @ToolShim} 兼容壳）→ 新名。
 *
 * <p>旧名不再注册为工具，但仍会从旧对话、XML 兜底、用户自建 skill / 插件的工具白名单、本地 MCP 客户端里冒出来，
 * 所以这张表保留下来，三处用它：
 * <ul>
 *   <li>{@code ToolRegistry}：调到旧名时，{@link #SAME_ARGS} 里参数完全相同的纯改名直接按新名执行（回执末尾附提示），
 *       其余返回 {@link #renamedMessage} 那句「已改名为 X，请改调 X(…)」——参数要换判别字段，不替模型猜；</li>
 *   <li>{@code SkillRegistry.migrateRenamedTools}：skill 白名单里的旧名映射成新名；</li>
 *   <li>{@code ToolShimContractTest}：钉住旧名都已不是注册工具、新名都已注册。</li>
 * </ul>
 */
public final class ToolShims {

    private ToolShims() {
    }

    /** 旧名改到哪个新名，以及给模型看的新调用写法。 */
    public record Rename(String replacedBy, String call) {
    }

    private static Map.Entry<String, Rename> rename(String oldName, String replacedBy, String call) {
        return Map.entry(oldName, new Rename(replacedBy, call));
    }

    private static final Map<String, Rename> RENAMED = Map.ofEntries(
            rename("doc_accept_revision", "doc_revisions", "doc_revisions(action=accept, index)"),
            rename("doc_reject_revision", "doc_revisions", "doc_revisions(action=reject, index)"),
            rename("doc_accept_all_revisions", "doc_revisions", "doc_revisions(action=accept_all)"),
            rename("doc_reject_all_revisions", "doc_revisions", "doc_revisions(action=reject_all)"),
            rename("doc_reply_comment", "doc_update_comment", "doc_update_comment(commentId, action=reply, text)"),
            rename("doc_resolve_comment", "doc_update_comment", "doc_update_comment(commentId, action=resolve|reopen)"),
            rename("doc_table_add_row", "doc_table_insert", "doc_table_insert(axis=row, before, count)"),
            rename("doc_table_add_col", "doc_table_insert", "doc_table_insert(axis=col, before, count)"),
            rename("doc_table_delete_row", "doc_table_delete", "doc_table_delete(axis=row, target, count)"),
            rename("doc_table_delete_col", "doc_table_delete", "doc_table_delete(axis=col, target, count)"),
            rename("doc_insert_footnote", "doc_insert_note", "doc_insert_note(kind=footnote, text, anchorId)"),
            rename("doc_insert_endnote", "doc_insert_note", "doc_insert_note(kind=endnote, text, anchorId)"),
            rename("doc_goto", "doc_select", "doc_select(target=start|end)"),
            rename("doc_select_anchor", "doc_select", "doc_select(target=anchor, anchorId)"),
            rename("doc_select_paragraph", "doc_select", "doc_select(target=paragraph, index, endIndex)"),
            rename("doc_collapse_cursor", "doc_select", "doc_select(target=collapse_start|collapse_end)"),
            rename("office_accept_revision", "office_revisions", "office_revisions(action=accept|accept_all, revisionIndex)"),
            rename("office_reject_revision", "office_revisions", "office_revisions(action=reject|reject_all, revisionIndex)"),
            rename("office_reply_comment", "office_update_comment", "office_update_comment(action=reply, commentId, reply)"),
            rename("office_resolve_comment", "office_update_comment", "office_update_comment(action=resolve|reopen, commentId)"),
            rename("office_excel_reply_comment", "office_excel_update_comment", "office_excel_update_comment(action=reply, cellAddress, reply)"),
            rename("office_excel_resolve_comment", "office_excel_update_comment", "office_excel_update_comment(action=resolve|reopen, cellAddress)"),
            rename("office_table_add_row", "office_table_insert", "office_table_insert(axis=row, at, count)"),
            rename("office_table_add_col", "office_table_insert", "office_table_insert(axis=col, at, count)"),
            rename("office_table_delete_row", "office_table_delete", "office_table_delete(axis=row, at, count)"),
            rename("office_table_delete_col", "office_table_delete", "office_table_delete(axis=col, at, count)"),
            rename("office_insert_footnote", "office_insert_note", "office_insert_note(kind=footnote, anchorText, text)"),
            rename("office_insert_endnote", "office_insert_note", "office_insert_note(kind=endnote, anchorText, text)"),
            rename("office_file_create", "office_file", "office_file(action=create)"),
            rename("office_file_save", "office_file", "office_file(action=save)"),
            rename("office_file_export_pdf", "office_file", "office_file(action=export_pdf, fileName)"),
            rename("office_file_open", "office_file", "office_file(action=open, fileId)"),
            rename("office_excel_set_formulas", "office_excel_set_values", "office_excel_set_values(sheetName, rangeAddress, valuesJson)，整块以 = 开头即按公式写入"),
            rename("pdf_split", "pdf_pages", "pdf_pages(fileId, op=split, ranges)"),
            rename("pdf_extract_pages", "pdf_pages", "pdf_pages(fileId, op=extract, ranges)"),
            rename("pdf_rotate_pages", "pdf_pages", "pdf_pages(fileId, op=rotate, ranges, degrees)"),
            rename("pptx_generate_outline", "pptx_outline", "pptx_outline(action=create, topic)"),
            rename("pptx_refine_outline", "pptx_outline", "pptx_outline(action=refine, serviceProjectId, userRequirement)"),
            rename("law_search_keyword", "law_search", "law_search(mode=keyword, title, fulltext)"),
            rename("text_write_file", "write_file", "write_file(mode=overwrite, fileId, content)"),
            rename("move_files_batch", "move_files", "move_files(movesJson)"),
            rename("move_project_file", "move_files", "move_files(movesJson=[{sourcePath, destPath}])"),
            rename("list_project_folders", "doc_list_project_files", "doc_list_project_files(foldersOnly=true)"),
            rename("search_across_projects", "search_project_files", "search_project_files(fileNamePattern, scope=all)"),
            rename("capability_apply", "capability_install", "capability_install(planId)"),
            rename("meeting_list_recordings", "meeting_list", "meeting_list(source=recording)"),
            rename("tmeet_list_meetings", "meeting_list", "meeting_list(source=tencent, keyword)"),
            rename("tmeet_get_transcript", "meeting_get_transcript", "meeting_get_transcript(meetingId, source=tencent)"));

    /**
     * 参数与新工具完全相同的纯改名：{@code ToolRegistry} 直接按新名执行。
     * move_files_batch(movesJson) ≡ move_files(movesJson)；capability_apply(planId) ≡ capability_install(planId)（只传 planId 即安装，确认闸按新名判）。
     */
    static final Set<String> SAME_ARGS = Set.of("move_files_batch", "capability_apply");

    private static final Map<String, String> REPLACED_BY = RENAMED.entrySet().stream()
            .collect(Collectors.toUnmodifiableMap(Map.Entry::getKey, e -> e.getValue().replacedBy()));

    /** 旧名对应的新名；不是已删除的旧名时原样返回。 */
    public static String canonical(String toolName) {
        return REPLACED_BY.getOrDefault(toolName, toolName);
    }

    /** 旧名 → 新名（只读）。 */
    public static Map<String, String> replacements() {
        return REPLACED_BY;
    }

    /** 参数完全相同、可直接按新名执行的旧名返回新名，否则 null。 */
    public static String sameArgsTarget(String toolName) {
        return toolName != null && SAME_ARGS.contains(toolName) ? REPLACED_BY.get(toolName) : null;
    }

    /** 已删除的旧名返回「改名为 X」的错误回执，否则 null。 */
    public static String renamedMessage(String toolName) {
        Rename r = toolName == null ? null : RENAMED.get(toolName);
        return r == null ? null
                : "Error: tool '" + toolName + "' was renamed to '" + r.replacedBy() + "' and the old name has been removed."
                        + " Call " + r.call() + " instead.（工具 " + toolName + " 已并入 " + r.replacedBy()
                        + "，旧名已删除，请改调 " + r.call() + "）";
    }

    /** 在回执末尾追加「已并入」提示（纯改名按新名执行后用）。 */
    public static String hint(String result, String toolName) {
        Rename r = RENAMED.get(toolName);
        return (result == null ? "" : result)
                + "\n（提示：" + toolName + " 已并入 " + r.replacedBy() + "，下次请直接调用 " + r.call() + "）";
    }
}
