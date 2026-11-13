// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ai;

import java.util.List;
import java.util.Set;

/**
 * 网页版客户端（{@link ClientCapabilityService.Capability#WEB}）的工具面：<b>白名单</b>，不是黑名单
 *（W1 设计 §4.2 / §4.6，readiness/w1/W1-design.md）。
 *
 * <p>网页工作台（官网 {@code /web/}）跑在浏览器里：编辑器是同一个 LOWA 执行器
 *（{@code createIframeEditorExecutor}），但只开 DOCX；没有本机文件夹、终端、Python、git、
 * PPT 服务、浏览器面板，也没有 Office 任务窗格。远端执行类工具在客户端没有执行器时就是
 * 30 秒超时死路径，所以 WEB 档只放这里点名的工具，<b>其余一律不可见</b>（含插件工具，
 * 见 {@link ClientCapabilityService#isToolVisible}）。
 *
 * <p><b>每个已注册的内置工具都必须在这里被归类</b>（三张表之一，或命中 {@link #DENIED_PREFIXES}）：
 * {@code ClientCapabilityWebSurfaceTest} 枚举真实注册表，新增工具没归类就红——新工具不会
 * 悄悄漏到网页上，也不会悄悄缺席。
 */
public final class WebClientToolSurface {

    private WebClientToolSurface() {
    }

    /**
     * 网页执行器能执行的 Writer 编辑器工具（经 {@code client_action editor_command} 下发到浏览器里的
     * iframe LOWA），外加带 doc_ 前缀的纯后端 / 打开类工具。仍受活跃文档类型闸约束
     *（{@link ClientCapabilityService#visibleForDocKind}）。
     *
     * <p>W1 只开 DOCX：{@code sheet_* / slide_*} 等 W2。不在这里的 doc_* 见 {@link #DENIED_TOOLS}。
     * 最终要与官网 vendor 版本导出的执行器能力清单对拍（设计 §4.3，P1 交付后补那条测试）。
     */
    public static final Set<String> EDITOR_TOOLS = Set.of(
            // 看
            "doc_get_document_text", "doc_get_clauses", "doc_get_paragraph", "doc_get_outline",
            "doc_get_cursor_context", "doc_get_formatting", "doc_get_comments", "doc_audit_structure",
            "doc_list_revisions", "doc_table_read",
            // 找 / 选
            "doc_find_text", "doc_select",
            // 改（带修订）
            "doc_replace_at_anchor", "doc_replace_selection", "doc_find_replace", "doc_insert_at_cursor",
            "doc_insert_under_heading", "doc_modify_paragraph", "doc_delete_selection", "doc_insert_break",
            "doc_insert_note", "doc_insert_image", "doc_insert_table", "doc_insert_toc", "doc_set_hyperlink",
            "doc_undo", "doc_redo",
            // 格式
            "doc_format_selection", "doc_set_paragraph_format", "doc_set_style", "doc_set_numbering",
            "doc_set_page_setup", "doc_edit_header_footer", "doc_format_table", "doc_apply_standard_format",
            "doc_apply_style_profile",
            // 表格
            "doc_table_insert", "doc_table_set_cell", "doc_table_delete",
            // 批注与修订
            "doc_add_comment", "doc_update_comment", "doc_delete_comment", "doc_revisions",
            // 证据链接
            "doc_link_evidence", "doc_list_evidence",
            // 文件：清单（纯后端）/ 打开 / 流式新建 / 回到检查点
            "doc_list_project_files", "doc_open_file", "doc_start_stream", "doc_restore_checkpoint");

    /** 纯后端工具（在云后端执行，不依赖任何客户端执行器或本机环境）。 */
    public static final Set<String> BACKEND_TOOLS = Set.of(
            // 编排
            "ask_user", "list_tools", "use_skill", "dispatch_subtask", "todo_write", "list_attached_files",
            // 项目文件
            "read_file", "extract_file_text", "list_files", "search_project_files", "search_project_content",
            "write_docx", "write_file", "create_folder", "copy_files", "move_files", "rename_project_file",
            "move_to_trash", "update_project_info", "create_file_from_template", "list_contributed_templates",
            "docx_inspect_template", "compare_docx_summary", "web_verify_import", "dd_export",
            // PDF（纯后端读与产出新文件；改原文件的 pdf_* 声明了 LOWA，在拒绝表里）
            "pdf_inspect", "pdf_inspect_visual", "pdf_pages", "pdf_merge", "pdf_delete_pages",
            "pdf_add_page_numbers",
            // 法规、检索与外部数据
            "law_search", "law_recognition", "get_law_article", "case_search", "search_web", "browse_url",
            "qichacha_query", "qichacha_ipr", "tushare_query",
            // 记忆与证据
            "memory_list", "memory_read", "memory_search", "memory_write", "memory_edit", "memory_delete",
            "save_memory", "query_memory", "retrieve_evidence", "evidence_verify",
            // 事务
            "deadline_compute", "tag_file", "tag_list", "tag_remove_from_file", "task_create", "task_list",
            "task_update");

    /**
     * 点名拒绝的内置工具（设计 §4.2「W2 再评估」与「永不」两行）。前缀族见 {@link #DENIED_PREFIXES}。
     */
    public static final Set<String> DENIED_TOOLS = Set.of(
            // 编辑器里的视觉/导出与修订比对：要编辑器隐藏引擎或画面导出（W2 再评估）
            "doc_view_pages", "doc_export_pdf", "compare_docx_redline",
            // 纯文本标签（text_*）：网页没有文本标签
            "text_find_replace",
            // 改原 PDF：收尾要在编辑器里打开/重载 PDF，网页不开 PDF
            "pdf_highlight", "pdf_annotate", "pdf_redact", "pdf_replace_text", "pdf_to_word",
            // PPT 素材生成（slides 类目）
            "image_generate_asset", "image_get_generation",
            // 会议录音 / 腾讯会议：桌面专属
            "meeting_list", "meeting_get_transcript",
            // 本机执行与扩展：Python 沙箱、把 skill 写到本机
            "run_python", "create_skill");

    /**
     * 整族拒绝的前缀：Office 任务窗格（office_*）、参考来源（ref_*，只为任务窗格服务）、
     * 表格与演示（sheet_* / slide_*，W2）、PPT 服务（pptx_*，云端没有）、诉讼可视化出图（litigation_*）、
     * 项目版本库（version_*，git）、插件开发与能力安装（plugin_dev_* / capability_*）。
     */
    public static final List<String> DENIED_PREFIXES = List.of(
            "office_", "ref_", "sheet_", "slide_", "pptx_", "litigation_", "version_", "plugin_dev_",
            "capability_");

    /** 内置工具在 WEB 档是否可见（插件工具另走 manifest 声明，见 {@link ClientCapabilityService}）。 */
    static boolean allowsBuiltin(String toolName) {
        return EDITOR_TOOLS.contains(toolName) || BACKEND_TOOLS.contains(toolName);
    }

    /** 被显式拒绝（点名或前缀族）。 */
    static boolean denies(String toolName) {
        if (DENIED_TOOLS.contains(toolName)) {
            return true;
        }
        for (String prefix : DENIED_PREFIXES) {
            if (toolName.startsWith(prefix)) {
                return true;
            }
        }
        return false;
    }
}
