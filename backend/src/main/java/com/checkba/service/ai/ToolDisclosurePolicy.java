// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ai;

import com.checkba.service.ai.skill.SkillRouter;
import dev.langchain4j.agent.tool.ToolSpecification;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.function.Supplier;

/**
 * 工具渐进披露（dev-board#810 B 档，审计 A1 / C-07）。
 *
 * <p><b>要治的病</b>：工具规格是<b>每一轮</b>都要重发的，一条消息跑五到七个往返就付五到七遍。
 * 实测默认工作台会话每轮 192 个工具规格约 2.4 万 token，占固定前缀 5.2 万的将近一半；
 * 而其中绝大多数（litigation_* 的六个出图工具、pdf_* 的七个、pptx_* 的九个、表格与版式那几十个）
 * 在一次普通的「读一份合同、改两处措辞」里一个都用不到。
 *
 * <p><b>做法</b>：默认只下发一份<b>核心集</b>，其余按<b>类目</b>收进目录，模型用
 * {@code list_tools} 查目录、按类目展开。展开<b>只在下一轮生效</b>——这是
 * {@code AgentOrchestrator.RunGuard.activeDocKind} 那条「一轮内工具集不变」契约的延伸：
 * 模型已经在 messages 里宣布要调的工具，下一轮不能消失，否则通道直接 400。
 * 本类的裁剪<b>只做加法</b>（展开集单调增长），所以永远不会让已宣布的工具消失。
 *
 * <p><b>三条安全性质</b>，缺一条这套机制就会变成「模型以为自己没这个能力」：
 * <ol>
 *   <li><b>只裁 spec，不裁 resolve/execute</b>（与 dev-board#729 的活跃文档裁剪同一口径）：
 *       没下发的工具仍然登记着，XML 兜底路径按名字解析得到，所以模型看完
 *       {@code list_tools(category)} 的输出可以<b>当轮</b>就用 {@code <tool_code>} 调它，
 *       不必等下一轮；原生 function calling 那条路才需要多一轮。</li>
 *   <li><b>目录里没有黑洞</b>：{@link #categoryOf} 是全函数——任何工具要么在核心集，
 *       要么落进某个类目，实在认不出的落 {@code misc}，{@code list_tools()} 一定列得出来。
 *       新增工具不需要改本类就已经在目录里（只是不进核心集）。</li>
 *   <li><b>skill 已经裁过就不再裁</b>：skill 的 allowed_tools 本身就是一次披露，
 *       两层叠起来会把 skill 精心挑出来的工具又藏掉一半。判据在
 *       {@code AgentOrchestrator}（skill 返回的集合是否比候选集小）。</li>
 * </ol>
 *
 * <p><b>为什么核心集是一份人工清单而不是 {@code @ToolMeta} 上的一个布尔</b>：
 * 「这个工具算不算高频」不是工具自身的属性（{@code requiresHost} / {@code fileEffect} 才是），
 * 而是一次横切的取舍——要判断它得把四十个候选<b>放在一起</b>看覆盖面，
 * 散在三十四个文件的注解里没人能一眼看出「读一份合同」这条链是不是断的。
 * 清单集中在这里，配套的覆盖面断言也集中在 {@code ToolDisclosurePolicyTest}。
 *
 * <p><b>默认打开</b>（{@code ai.tools.progressive-disclosure.enabled=true}，2026-09-29，dev-board#1064 第二步；
 * 环境变量 {@code AI_TOOLS_PROGRESSIVE_DISCLOSURE=false} 可关）。此前默认关，理由是回放评测用的是脚本模型，
 * 证明不了真实模型找不找得到 {@code list_tools}，而 2026-09-22 那组真实模型对照里「读文件总结」3 次有 1 次不收尾。
 * 09-29 复查查清了那一次：无头后端没有 LOWA 编辑器，{@code doc_get_document_text} 必然等满编辑器桥 122 秒超时，
 * 关掉披露照样复现——是测试环境的假象，不是披露造成的。在最终代码上跑的隔离后端真实模型矩阵
 * （纯对话会话，三类任务 × DeepSeek V4 Flash / Kimi K3 × 10 次）：60 次里 list_tools 一次都没调，
 * 58 次正常收尾；没达标的几次（模型先反问「读哪一份」、只看文件名就作答）在同一构建披露关着时
 * 同样出现、频率不更低，与披露无关。数据与方法写在 ai-chat.md。
 * 翻开关之前同批补上的三件事，是它能默认开的前提：
 * <ol>
 *   <li>核心集按「通用段 + 各宿主段」重定（T-18），每一类会话都有自己那一份「读 + 找 + 写」；</li>
 *   <li>起跑时的关键词 / skill 预放回不再只在活跃文档类目裁剪时做，披露开着就做
 *       （{@code AgentOrchestrator.prepareToolCategoryPutBack}）——「帮我建个事项」不必先查一轮目录；</li>
 *   <li>system prompt 的目录规则把片段里「清单里没有就执行不了」那句改读成「目录也列不出来才执行不了」。</li>
 * </ol>
 * <b>已知代价</b>：任务要用一个非核心类目、而关键词没猜到时，多一轮 {@code list_tools}，且展开后那一轮
 * 工具集变了、提示缓存整段失效一次。接受它，是因为每一轮都省下的那一大块规格远大于偶尔多付的这一轮。
 *
 * <p><b>另一把独立的刀：活跃文档类目裁剪</b>（dev-board#1064，
 * {@code ai.tools.doc-session-category-trim.enabled}，<b>默认开</b>）。开着一份文档时，
 * 与「改这份文档 / 就这份文档答疑」无关的整类工具（PDF、诉讼出图、演示文稿、企业数据、
 * 插件开发与能力安装、会议录音、Python）默认不下发，见 {@link #HIDDEN_CATEGORIES_BY_DOC_KIND}。
 * 它与渐进披露<b>同一个形状</b>：可见 = 候选 − （本类型隐藏的类目 − 已放回的类目），放回集就是
 * 渐进披露那份 {@code RunGuard.expandedToolCategories}，只增不减、下一轮生效，没有第二套机制。
 * 两者叠用时先按类目裁、再按核心集收窄，结果仍是「核心集 ∪ 已展开类目」的子集。
 *
 * <p>放回的四个触发点：本轮用户输入命中关键词（{@link #categoriesHintedBy}，起跑时一次算定）、
 * 本轮生效的 skill 白名单涉及的类目（{@link #categoriesCoveredBy}）、模型调 {@code list_tools(category)}、
 * 模型经 XML 兜底直接点名调了一个没下发的工具（它的同类工具下一轮回来）。
 *
 * <p>两把刀的分工：类目裁剪藏的是「开着一份文档时几乎用不到」的整类，渐进披露再把剩下的收窄到核心集。
 * 任何一把单独关掉，另一把照常工作；两者共用同一份放回集与同一个 {@code list_tools} 入口。
 */
@Service
public class ToolDisclosurePolicy {

    /** 目录工具名。它自己永远在核心集里，否则展开机制就没有入口。 */
    public static final String CATALOG_TOOL = "list_tools";

    /**
     * 核心集：任何会话都先下发这些（再与会话能力 / 活跃文档类型 / skill 白名单求交集）。
     *
     * <p>挑选判据是<b>把一条完整的活干完需要哪些工具</b>，不是按调用次数排名：
     * 少一个「读」类工具模型就绕路，少一个「写」类工具它就停在半路告诉用户做不了。
     * 每一组后面的注释写的是这组保证哪条链不断。
     *
     * <p>这是<b>一份扁平集合</b>，按段写只为读得清：通用段之外的每一段都挑宿主，
     * 上游的会话能力闸（{@code ClientCapabilityService.isToolVisible}）与活跃文档闸
     * 会把别家宿主的那几段整段裁掉，所以一份 docx 会话实际拿到的是「通用段 + docx 段」
     * 再加上 kind 无关的 {@code sheet_create_file}；逐会话的实数由
     * {@code ToolDisclosurePolicyTest.corePerSessionIsSmallAndComplete} 打印并钉住。
     */
    static final Set<String> CORE = java.util.Collections.unmodifiableSet(new LinkedHashSet<>(java.util.Arrays.asList(
            // ==================== 通用段：任何会话都要有（22 个）====================
            // —— 目录入口与编排：少了 list_tools 整套机制就没有入口；ask_user 是「拿不准先问」
            //    的唯一入口（dev-board#868），藏进目录里等于让模型先查目录才能想起来问；
            //    use_skill 是模型自己切到专门流程的入口（dev-board#1065），与 list_tools 的 skill 目录配套 ——
            CATALOG_TOOL, "todo_write", "dispatch_subtask", "ask_user", "use_skill",

            // —— 项目材料：找文件（按名 / 按正文）→ 拿 fileId → 读全文 → 落一份新文件 → 整理 ——
            // doc_list_project_files 自 dev-board#1065 T-01 起三档会话都可见（纯后端清单），
            // 所以纯对话与 Office 任务窗格会话也不必为「这是什么文件」先查一次目录（#1064 实测病灶）。
            // read_document 已删除（V3，Java 方法仅供内部调用），入口统一是 extract_file_text。
            "doc_list_project_files", "search_project_files", "search_project_content", "extract_file_text",
            "write_docx",
            // 跨文件硬规则要求先列后读；reference 没有关键词预放回，不能再让模型先查目录。
            "ref_list", "ref_read",

            // V2：create_folder / move_files（原 move_files_batch）/ move_to_trash 退到 files 类目（关键词预放回）；
            // list_attached_files 改为条件核心（本轮有附件时由编排器补）。
            // —— 记忆：检索与保存各一个（memory_list/read 由编排器每轮另补，memory_search 退到 memory 类目；write/edit/delete 走 memory 类目，skill 收窄时由编排器兜底，dev-board#1073）——
            "query_memory", "save_memory",

            // —— 法源与公网：律师最高频的外部检索。law_search 的 mode=keyword 已并入（V4），
            //    law_recognition 等退到 legal 类目（「法规」「法条」等关键词会在起跑时把它预先放回）。
            //    case_search（P7，2026-11-11）：基底 prompt 的法规检索一节把「法条 + 案例」当一条链教，
            //    被点名的工具首轮就得在清单里；同源同闸（法宝），规格约 126 token，比改写那一节划算 ——
            "law_search", "get_law_article", "case_search", "search_web", "browse_url",

            // ==================== LOWA 文字（docx）段：15 个 ====================
            // 能力闸与活跃文档闸会把它们从 xlsx / pptx / 任务窗格 / 纯对话会话里裁掉，不占位。
            // —— 读：打开、通读、找、看光标处、看条款、机械核对 ——
            // doc_get_outline / doc_get_paragraph 退到 edit 类目：doc_get_document_text 分页读已覆盖通读，
            // doc_get_cursor_context 覆盖「看选区与上下文」（T-15）。
            "doc_open_file", "doc_get_document_text", "doc_find_text", "doc_get_cursor_context",
            "doc_get_clauses", "doc_audit_structure",
            // —— 写：改一处、插一段（含锚点前后插入，T-16）、整篇起草、插表、套标准格式 ——
            // doc_insert_table 进核心集：活跃文档末位提醒点名要求「新表整表一次提交」，
            // 被点名的工具藏在目录里，弱模型就会改成逐行写表把步数耗光（2026-09-07 实测回归 B4）。
            // doc_replace_selection / doc_select（原 select_anchor / select_paragraph）退到 edit 类目：
            // 锚点替换与查找替换已覆盖「改一处」，先选中再替换是两步走的旧路。
            "doc_find_replace", "doc_replace_at_anchor", "doc_insert_at_cursor", "doc_start_stream",
            "doc_insert_table",
            // —— 批注与后悔药 ——
            // doc_get_comments 退到 revision 类目（与回复 / 解决 / 删除批注同类；「批注」「修订」等关键词会预先放回）。
            // Impress 上 doc_undo 是空操作（引擎不记撤销栈，lowa-e2e undo-redo-kinds 实测），
            // pptx 会话里 doc_restore_checkpoint 是唯一的后悔药，所以 pptx 常驻（条件核心）。
            "doc_add_comment", "doc_undo",
            // office-tier1：看真实画面（Word/PPT/Excel 通用，ClientCapabilityService 列为 kind 无关）
            "doc_view_pages",
            // V2：doc_restore_checkpoint 改为条件核心（本轮已有检查点、或 pptx 会话时由编排器补）；
            // doc_apply_standard_format 退到 format 类目、doc_export_pdf 退到 pdf 类目（关键词预放回）。

            // ==================== LOWA 表格（xlsx）段：11 个（边框 / 行高列宽 / 筛选靠 TOOL_KEYWORDS 按名放回；「批注」是 revision 类目关键词，不能再挂工具关键词）====================
            // sheet_create_file / slide_create_file 不在核心集（tool-surface-audit S1，已拍板 #1）：
            // 有文档开着时靠「表格 / excel / ppt / 幻灯片」关键词预放回；没开文件时见 NOFILE_ENTRY_EXTRA。
            "sheet_get_overview", "sheet_read_range", "sheet_write_cells", "sheet_find_replace",
            // office-tier1（2026-11-12）：开着 xlsx 时律师最常说的「加一列 / 排序 / 冻结首行 / 加粗标黄 / 做个图 /
            // 加个工作表 / 合并单元格 / 加边框 / 调列宽 / 筛选 / 批注」原先都要先 list_tools，弱模型常直接说「做不到」。
            // 上游 visibleForDocKind 只在 xlsx 会话放行 sheet_*，docx/pptx 会话不为它们付规格。
            "sheet_format_cells", "sheet_edit_rows_cols", "sheet_sort_range", "sheet_freeze_panes",
            // sheet_manage_sheets 不进：「工作表」是 spreadsheet 类目关键词，「加一个工作表」整类放回
            "sheet_add_chart", "sheet_merge_cells", "sheet_add_comment",

            // ==================== LOWA 演示（pptx）段：12 个 ====================
            "slide_get_overview", "slide_get_page", "slide_set_shape_text", "slide_replace_text", "slide_add_page",
            // office-tier1：删页 / 调页序 / 改字体颜色加粗 / 插表 / 加文本框 / 写备注 / 改表格单元格，
            // 同上只在 pptx 会话放行（visibleForDocKind 按 slide_ 前缀）。删形状不进（每会话核心集上限 32）。
            "slide_delete_page", "slide_move_page", "slide_format_text", "slide_add_table", "slide_add_text_box",
            "slide_write_notes", "slide_table_set_cell",

            // ==================== Office 任务窗格·Word 段：7 个（T-18）====================
            // office_pass_step 是 Word 窗格整篇大改的入口（分段过卷，dev-board#422）；office_add_comment 是审查的交付物。
            "office_get_text", "office_search", "office_insert_text", "office_replace_text",
            "office_replace_batch", "office_add_comment", "office_pass_step",

            // ==================== Office 任务窗格·Excel 段：5 个（T-18）====================
            // 三类宿主的执行器互不相通，Word 面的 office_* 在 Excel 窗格里一个都不可见，
            // 所以每个宿主都要有自己那一份「读 + 找 + 写」。
            "office_excel_get_overview", "office_excel_get_range", "office_excel_set_values",
            "office_excel_search", "office_excel_replace",

            // ==================== Office 任务窗格·PowerPoint 段：4 个（T-18）====================
            "office_ppt_get_slides", "office_ppt_replace_text", "office_ppt_format_text", "office_ppt_add_slide"
    )));

    /**
     * 没开文件态（LOWA 且起跑时无活跃文档，tool-surface-audit S1）额外放进核心集的入口工具：
     * 新建一份表格 / 演示文稿。它们不在 {@link #CORE}（有文档开着时靠关键词预放回），
     * 但没开文件时「新建」就是入口，不该先查目录。
     */
    static final Set<String> NOFILE_ENTRY_EXTRA = Set.of("sheet_create_file", "slide_create_file");

    /**
     * 没开文件态保留的 doc_* / sheet_* / slide_* 核心工具：找 / 打开 / 新建入口。
     * 其余文档编辑原语在没有文档时一个都用不上，打开或新建文档后由编排器放回（只增不减）。
     */
    static final Set<String> NOFILE_KEPT_DOC_TOOLS = Set.of("doc_open_file", "doc_start_stream");

    private static boolean isDocEditPrimitive(String name) {
        return (name.startsWith("doc_") || name.startsWith("sheet_") || name.startsWith("slide_"))
                && !"doc_list_project_files".equals(name);
    }

    /**
     * 类目 → 这个类目收哪些工具。按<b>声明顺序</b>匹配，第一个命中的类目即归属，
     * 所以顺序本身是契约的一部分（{@code doc_table_*}、edit 与 files 里点名的 doc_* 都必须排在 {@code doc_} 通配之前）。
     *
     * <p>值里 {@code "name:"} 开头的是精确工具名，其余是名字前缀。
     */
    private static final Map<String, List<String>> CATEGORIES = new LinkedHashMap<>();

    static {
        CATEGORIES.put("table", List.of("doc_table_", "name:doc_insert_table"));
        CATEGORIES.put("revision", List.of(
                "name:doc_restore_checkpoint", "name:doc_get_comments", "name:doc_list_revisions", "name:doc_revisions", "name:doc_update_comment",
                "name:doc_delete_comment"));
        CATEGORIES.put("evidence", List.of(
                "name:doc_link_evidence", "name:doc_list_evidence",
                "name:evidence_verify", "name:retrieve_evidence",
                // 尽调底稿导出与核验导入都是「证据」这条链上的动作（T-19），不是文件整理、也不是企业数据
                "name:dd_export", "name:web_verify_import"));
        CATEGORIES.put("template", List.of(
                "name:docx_inspect_template", "name:doc_apply_style_profile",
                "name:create_file_from_template", "name:list_contributed_templates",
                "name:contribute_template"));
        // 定位 / 删改 / 按段落取改（dev-board#1065 T-19）。原先它们都掉进下面的 doc_ 通配归了 format，
        // 模型想「删掉选中的字」「改第 3 段」时不会去查一个叫 format 的类目。
        // doc_select / doc_get_paragraph / doc_get_outline / doc_replace_selection
        // 在 #1064 第二步退出核心集后就归这里。必须排在 format 之前。
        CATEGORIES.put("edit", List.of(
                "name:doc_select", "name:doc_delete_selection", "name:doc_redo",
                "name:doc_modify_paragraph",
                "name:doc_get_paragraph",
                "name:doc_get_outline", "name:doc_insert_under_heading", "name:doc_replace_selection"));
        // 两份 docx 比对（V7 D1）：不带 doc_ 前缀，归类只为让「比对 / 对比」关键词能预放回
        CATEGORIES.put("compare", List.of("compare_docx_"));
        // pdf 与 files 排在 format 之前，只为 doc_export_pdf：它带 doc_ 前缀，排在后面就会被 format 通配吃掉。
        // V2：doc_export_pdf 从核心集退到 pdf 类目（「导出PDF / 转PDF」命中 pdf 关键词）。
        CATEGORIES.put("pdf", List.of("name:doc_export_pdf", "pdf_"));
        CATEGORIES.put("files", List.of(
                "name:create_folder", "name:move_files", "name:move_to_trash",
                "name:list_files", "name:read_file", "name:write_file",
                "name:rename_project_file", "text_",
                "name:copy_files"));
        // doc_* 里剩下的全是版式与排版：字符格式、段落格式、页面、页眉页脚、目录、脚注、图片、超链接……
        CATEGORIES.put("format", List.of("doc_"));
        CATEGORIES.put("spreadsheet", List.of("sheet_"));
        CATEGORIES.put("slides", List.of("slide_", "pptx_", "image_generate_asset", "image_get_generation"));
        CATEGORIES.put("office", List.of("office_"));
        CATEGORIES.put("litigation", List.of("litigation_"));
        CATEGORIES.put("reference", List.of("ref_"));
        CATEGORIES.put("version", List.of("version_"));
        // update_project_info 写的是项目记忆（project_memory），不是外部企业数据（T-19）
        CATEGORIES.put("memory", List.of("memory_", "name:update_project_info"));
        CATEGORIES.put("enterprise-data", List.of("qichacha_", "name:tushare_query"));
        // law_search / get_law_article 在核心集，这里收的是剩下的 law_recognition：
        // 归进 legal 比落 misc 好找——模型要的是「法规这一族还有什么」，不是「杂项里翻翻看」。
        CATEGORIES.put("legal", List.of("law_", "name:get_law_article", "name:case_search"));
        CATEGORIES.put("meeting", List.of("meeting_", "tmeet_"));
        CATEGORIES.put("task", List.of("task_", "name:deadline_compute"));
        // 文件标签不是事项（T-19）：tag_list / tag_file / tag_remove_from_file 原先挂在 task 下
        CATEGORIES.put("tag", List.of("tag_"));
        CATEGORIES.put("mcp", List.of("user_mcp_"));
        CATEGORIES.put("plugin", List.of("plugin_dev_", "capability_"));
        CATEGORIES.put("python", List.of("name:run_python"));
    }

    /** 认不出归属的工具落这里——目录里绝不允许出现黑洞。 */
    public static final String FALLBACK_CATEGORY = "misc";

    /**
     * 运行期由插件 JAR 注册的工具（dev-board#1065 T-20）。它们的名字不会命中上面任何一条规则，
     * 原先一律落 misc，与遗留的记忆辅助工具混在一起；单独成类，模型查目录时看得出「这是装的插件带来的」。
     */
    public static final String PLUGIN_TOOLS_CATEGORY = "plugin-tools";

    /**
     * 插件工具名的来源，由 {@code ToolRegistry} 初始化时交进来（活视图，插件热加载后自动跟上）。
     * 不直接依赖 ToolRegistry：它经工具组件间接依赖本类（ToolDiscoveryTools），反过来注入就成环了。
     * 没人交进来（手工 new 的单测、EvalHarness）时视为没有插件工具。
     */
    private volatile Supplier<Set<String>> pluginToolNames = Set::of;

    /**
     * 活跃文档类型 → 默认不下发的类目（dev-board#1064）。键同 {@code ClientCapabilityService.DOC_KIND_*}。
     *
     * <p>只列<b>类目</b>：slide_* / sheet_* 在上游已经按前缀裁过（{@code visibleForDocKind}），
     * 这里列 {@code slides} 是为了 {@code pptx_*}——它不带 slide_ 前缀，上游一个都裁不掉，
     * 而一份 docx 会话里十个 pptx_* 规格每轮白付。
     *
     * <p><b>刻意留着的</b>：legal / task / tag / memory / evidence / template / revision / edit / format / table /
     * files / reference / plugin-tools / misc，以及核心集里的 {@code search_web} / {@code browse_url}。
     * 网页浏览看上去与「改文档」无关，但它和法规检索是律师改合同时最高频的两类外部查证
     * （查监管口径、查一个陌生术语），两个加起来一千字符出头，藏掉换来的是每次都要先查目录。
     *
     * <p>kind 为 null / "text" / 未知值一律不裁——与 {@code visibleForDocKind} 同一条
     * 「判不准倒向全集」。
     */
    static final Map<String, Set<String>> HIDDEN_CATEGORIES_BY_DOC_KIND = Map.of(
            "doc", Set.of("pdf", "litigation", "slides", "enterprise-data", "plugin", "meeting", "python"),
            "sheet", Set.of("pdf", "litigation", "slides", "enterprise-data", "plugin", "meeting", "python"),
            "slide", Set.of("pdf", "litigation", "spreadsheet", "enterprise-data", "plugin", "meeting", "python"));

    /**
     * 类目 → 用户输入里出现就把该类目预先放回的关键词（dev-board#1064）。比较时一律小写；
     * 匹配口径复用 {@link SkillRouter#containsTrigger}：中文是子串，拉丁串两端要求整词
     * （「pptx」不会被「ppt」吃掉，所以两个都列）。
     *
     * <p>这张表只做<b>预先放回</b>，漏词的代价是模型多查一次目录（或经 XML 直接点名），不是能力丢失；
     * 多词的代价是这一轮多付那一类的规格。所以它宁可宽一点，但不收「文件」「合同」这种每句都有的词。
     */
    static final Map<String, List<String>> CATEGORY_KEYWORDS = new LinkedHashMap<>();

    static {
        CATEGORY_KEYWORDS.put("pdf", List.of("pdf"));
        CATEGORY_KEYWORDS.put("compare", List.of("比对", "对比", "比较两", "比一下", "回稿", "修订稿", "改了哪", "改了什么", "动了哪", "差异", "有什么不同", "有何不同", "两个版本",
                "compare", "redline", "comparison",
                "diff", "compare versions", "compare two versions", "what changed", "differences between",
                "what's different", "what is different"));
        CATEGORY_KEYWORDS.put("version", List.of("版本", "提交改动", "提交修改", "取回", "自动合并", "git", "commit", "pull", "restore",
                "version history", "previous version", "earlier version", "older version", "roll back", "rollback",
                "revert"));
        CATEGORY_KEYWORDS.put("litigation", List.of("时间轴", "关系图", "流程图", "可视化",
                "timeline", "diagram", "relationship graph", "flowchart", "flow chart", "gantt", "chronology",
                "org chart", "mind map", "visualize", "visualise", "visualization", "visualisation"));
        CATEGORY_KEYWORDS.put("slides", List.of("ppt", "pptx", "幻灯片", "演示文稿", "slides", "slide", "presentation", "slide deck",
                "pitch deck", "powerpoint", "keynote"));
        CATEGORY_KEYWORDS.put("mcp", List.of("mcp", "MCP", "外部连接", "自配连接", "GitHub", "Tavily", "元典"));
        CATEGORY_KEYWORDS.put("enterprise-data", List.of("工商", "企业信息", "企查查", "股东", "注册资本",
                "公司背景", "tushare", "股票", "上市公司",
                "qichacha", "business registration", "company registry", "corporate registry", "registered capital",
                "company background", "company profile", "shareholder structure", "who owns", "beneficial owner",
                "legal representative", "stock price", "listed company", "ticker"));
        CATEGORY_KEYWORDS.put("plugin", List.of("插件", "plugin", "plugins", "能力安装", "capability", "capabilities"));
        // 不收裸「录音」：「整理这份录音文件夹」是文件整理，不是会议（V5 矩阵实测会误放回 meeting 类目）
        CATEGORY_KEYWORDS.put("meeting", List.of("会议", "纪要", "转写", "逐字稿", "会议录音", "录音转写", "录音逐字稿", "录音记录", "开会录的",
                "会议的录音", "的录音", "meeting", "meetings", "transcript", "transcripts", "transcribe", "transcription",
                "meeting minutes", "the minutes", "take minutes", "write minutes", "draft minutes", "generate minutes",
                "minutes of", "recording", "recordings", "audio recording", "voice memo"));
        // 插件工具统一落 plugin-tools；腾讯会议插件的 tencent_meeting_action 靠这些词在首轮就可见
        CATEGORY_KEYWORDS.put("plugin-tools", List.of("会议", "纪要", "腾讯会议", "逐字稿", "转写",
                "meeting minutes", "tencent meeting", "transcript",
                "the minutes", "take minutes", "write minutes", "draft minutes", "generate minutes", "minutes of",
                "meeting recording", "meeting recordings", "transcripts", "meeting transcript"));
        CATEGORY_KEYWORDS.put("python", List.of("python", "脚本", "计算一下", "跑一段代码",
                "run code", "run a script", "run some code", "write a script", "python script"));
        // 「表格」两边都放：docx 里说的「表格」是文档内的表（table 类目的 doc_table_*），
        // xlsx 会话或「做一张表格」说的是电子表格；分不清就两类都放回，多付的是一轮里两类的规格。
        CATEGORY_KEYWORDS.put("spreadsheet", List.of("表格", "excel", "xlsx", "工作表", "电子表格", "一张表",
                "spreadsheet", "spreadsheets", "worksheet", "worksheets", "workbook", "csv"));
        // 不含「表格」二字的说法也要放回（V4 矩阵：「价目表最后插一行」没命中）；不收光秃秃的「行」「列」。
        CATEGORY_KEYWORDS.put("table", List.of("表格", "table", "单元格", "合并单元格",
                "价目表", "表里", "这张表", "表中", "那一行",
                "tables", "row", "rows", "column", "columns", "cells", "cell", "merge cells",
                "price table", "pricing table", "price list", "fee table", "tabular"));
        CATEGORY_KEYWORDS.put("task", List.of("事项", "日程", "提醒", "待办", "截止", "deadline",
                "期限", "到期", "开庭", "庭审", "时效", "截止日",
                "上诉期", "答辩期", "举证期限", "几号到期", "哪天到期", "再审期限", "最迟", "届满",
                // 英文：不收裸 due（due diligence）、裸 schedule（合同里的 Schedule A）、裸 minutes
                "deadlines", "task", "tasks", "reminder", "reminders", "remind", "to-do", "to-dos", "todo", "todos",
                "due date", "due dates", "due by", "due on", "due in", "due today", "due tomorrow", "overdue",
                "hearing", "hearings", "court date", "trial date", "calendar", "my schedule", "schedule a hearing",
                "schedule a call", "schedule a deposition", "schedule a task", "schedule a reminder", "schedule the", "appeal period", "appeal deadline", "limitation period",
                "limitations period", "statute of limitations", "time limit",
                "filing deadline", "expires", "expiry", "expiration", "this week", "next week", "this month",
                "upcoming"));
        // 以下几类是渐进披露默认打开后补的（dev-board#1064 第二步）：律师最常说的几类请求，
        // 起跑时就把那一类放回，免得先花一轮查目录、再让下一轮的提示缓存整段失效。
        CATEGORY_KEYWORDS.put("revision", List.of("修订", "批注", "接受", "拒绝", "评论",
                "comment", "comments", "commented", "revision", "revisions", "track changes", "tracked change",
                "tracked changes", "track change", "annotate", "annotation",
                "annotations", "accept all", "accept the", "accept this", "accept these", "accept every",
                "accept each", "accept it", "reject all", "reject the", "reject this", "reject these",
                "reject every", "reject each", "reject it", "resolve the comment", "resolve comments"));
        CATEGORY_KEYWORDS.put("template", List.of("模板", "套用", "template", "templates", "house style", "style profile", "firm style"));
        CATEGORY_KEYWORDS.put("evidence", List.of("证据", "依据", "证据整理", "整理证据", "证据目录", "证据清单",
                "evidence", "organize evidence", "organise evidence", "exhibit", "exhibits"));
        // 不收单独的「目录」：它在中文里也是「文件夹」（「项目目录下有什么」），误中就白付整个 format 类目
        // 四十个规格；只收明确指文档目录的短语。
        CATEGORY_KEYWORDS.put("format", List.of("格式", "字体", "字号", "段落", "页眉", "页脚", "脚注", "排版",
                "插入目录", "生成目录", "更新目录", "font", "format", "heading",
                "fonts", "font size", "formatting", "formatted", "headings", "line spacing", "indent", "indentation",
                "margin", "margins", "footnote", "footnotes", "page number", "page numbers", "table of contents",
                "bold", "italic", "underline", "typography"));
        // 不收「整理」：「整理一下录音 / 要点」远比「整理文件夹」常见，而建文件夹、批量移动、移入回收站在 V2 起也退到 files 类目（靠「文件夹 / 移动 / 回收站 / 删除文件」预放回）；
        // 但明确指文件归档的「文件整理」「整理文件」「归档」直接预先放回 files 全集（含单文件移动与重命名）。
        CATEGORY_KEYWORDS.put("files", List.of("重命名", "文件整理", "整理文件",
                "rename", "organize files", "file organization",
                "renamed", "organise files", "organize the files", "organise the files", "sort the files",
                "tidy up the files", "clean up the files", "copy files", "copy the file"));
        // 退出核心集的 8 个工具里「说法很明确」的那几个，改走下面 TOOL_KEYWORDS 的精确放回（只放该工具，不放整类）；
        // 这里只留更宽的说法（重命名 / 整理文件），它们要的是 files 全集（含单文件移动与重命名）。
        // 「法》」「条例》」：用户一写书名号引一部法（《公司法》《劳动合同法》《著作权法实施条例》）就是在查法条，
        // 比「法规」「法条」这类泛称命中得准。
        CATEGORY_KEYWORDS.put("legal", List.of("法规", "法条", "条文", "司法解释", "法》", "条例》",
                "案例", "判例", "查询案号", "检索案号", "判决书", "case law", "judgment",
                "law", "laws", "statute", "statutes", "statutory", "regulation", "regulations", "legislation",
                "civil code", "caselaw", "precedent", "precedents", "judgement", "ruling", "court decision",
                "case number", "similar cases", "find cases"));
        // memory 类目里是 memory_write / memory_edit / memory_delete 三个写入工具（只读三个编排器每轮都补，
        // dev-board#1073）；「记下」「忘掉」是要改记忆文件的说法。不收「别忘」「forget」：
        // 「别忘了加页码」是叮嘱不是记忆。
        CATEGORY_KEYWORDS.put("memory", List.of("记住", "记忆", "偏好", "记下", "忘掉", "remember", "memory", "memories", "memorize", "memorise",
                "preference", "preferences", "note down", "jot down"));
        // edit 刻意不收关键词：「删除 / 改成 / 替换 / 插入」几乎每句改文档的话都有，而真正常用的
        // 删改原语（锚点替换、查找替换、光标处插入）本来就在核心集里。
    }

    /**
     * 退出核心集的 8 个工具里说法明确的那几个：用户输入命中就在首轮<b>只放回该工具</b>（不连带整个类目），
     * 比类目关键词精确——「统一成律所标准格式」只需要 {@code doc_apply_standard_format}，不该付 format 全类 40 个规格。
     * 命中的短语会从文本里抠掉再去匹配类目关键词（「标准格式」里的「格式」不再把 format 类目拉回来）。
     * 比较一律小写，口径同 {@link #CATEGORY_KEYWORDS}。tool-system-v2 V2。
     */
    static final Map<String, List<String>> TOOL_KEYWORDS = new LinkedHashMap<>();

    /** 表格插/删行列的中英说法。英文用「动词 + 可选限定词 + row/column」展开，不收裸 row（交给 table 类目关键词）。 */
    private static final List<String> TABLE_INSERT_ZH_EN = tableEditPhrases(
            List.of("插一行", "插入一行", "加一行", "新增一行", "插一列", "插入一列", "加一列", "新增一列"),
            List.of("insert", "add", "append"));
    private static final List<String> TABLE_DELETE_ZH_EN = tableEditPhrases(
            List.of("删一行", "删除一行", "删掉一行", "删一列", "删除一列", "删掉一列"),
            List.of("delete", "remove", "drop"));

    private static List<String> tableEditPhrases(List<String> zh, List<String> verbs) {
        List<String> out = new ArrayList<>(zh);
        for (String verb : verbs) {
            for (String mid : List.of("", "a ", "an ", "one ", "another ", "a new ", "an extra ", "a blank ",
                    "an empty ", "the ", "this ", "that ", "the first ", "the last ", "the second ", "the third ",
                    "the top ", "the bottom ", "the empty ", "the blank ", "new ", "extra ")) {
                for (String noun : List.of("row", "rows", "column", "columns")) {
                    out.add(verb + " " + mid + noun);
                }
            }
        }
        return List.copyOf(out);
    }

    static {
        TOOL_KEYWORDS.put("create_folder", List.of("新建文件夹", "建个文件夹", "创建文件夹", "建文件夹", "文件夹", "create folder", "new folder",
                "create a folder", "make a folder", "add a folder", "folder", "folders"));
        // 「放进 / 放入」（P7）：「新建文件夹叫 X，把合同.docx放进去」（gate-35 g15）原先只靠基底 prompt 点名 move_files 兜住
        // 「分好类 / 归类 / 放到 / 放「X」」（tasks-10 t06）：律师整理文件的常见说法，原先漏了，模型得先 list_tools 找 move_files
        TOOL_KEYWORDS.put("move_files", List.of("移动", "移到", "归档", "放进", "放入", "分类", "分好类", "归类", "放到", "挪到",
                "放「", "放“", "move files",
                "move", "moved", "moving", "archive", "archived", "archiving", "relocate", "put", "file them into"));
        TOOL_KEYWORDS.put("doc_table_insert", TABLE_INSERT_ZH_EN);
        TOOL_KEYWORDS.put("doc_table_delete", TABLE_DELETE_ZH_EN);
        TOOL_KEYWORDS.put("office_table_insert", TABLE_INSERT_ZH_EN);
        TOOL_KEYWORDS.put("office_table_delete", TABLE_DELETE_ZH_EN);
        TOOL_KEYWORDS.put("move_to_trash", List.of("回收站", "删除", "删掉", "删了", "move to trash", "delete file",
                "delete", "deleted", "deleting", "trash", "recycle bin", "throw away", "get rid of"));
        TOOL_KEYWORDS.put("doc_apply_standard_format", List.of("标准格式", "统一格式", "律所格式", "排版",
                "standard format", "standard formatting", "firm's standard", "firm standard", "firm's format",
                "firm format", "firm's style", "firm style", "house style", "house format", "uniform format",
                "uniform formatting", "unify the format", "unify formatting", "standardize the format",
                "standardise the format", "standardize formatting", "standardise formatting"));
        TOOL_KEYWORDS.put("doc_export_pdf", List.of("导出pdf", "导出成pdf", "导出为pdf", "转pdf", "转成pdf", "存成pdf",
                "存为pdf", "另存为pdf", "export pdf", "export to pdf",
                "export as pdf", "export as a pdf", "export it as pdf", "export it as a pdf", "export it to pdf",
                "export to a pdf", "save as pdf", "save as a pdf", "save it as pdf", "save it as a pdf",
                "convert to pdf", "convert it to pdf", "convert into pdf", "print to pdf"));
        // office-tier1：xlsx 会话里不在核心集的常用格式工具，按说法精确放回（上游只在 xlsx 会话放行 sheet_*）
        TOOL_KEYWORDS.put("sheet_set_borders", List.of("边框", "框线", "加框", "border", "borders", "gridlines"));
        TOOL_KEYWORDS.put("sheet_set_row_col", List.of("列宽", "行高", "调宽", "调高", "加宽", "自适应宽", "column width", "row height", "autofit"));
        TOOL_KEYWORDS.put("sheet_set_autofilter", List.of("筛选", "过滤", "filter", "autofilter"));
        TOOL_KEYWORDS.put("memory_search", List.of("记得", "之前说过", "上次说", "之前提过", "之前聊过",
                "do you remember", "you remember", "did i tell you", "did i say", "did i mention", "what did i say",
                "what did i tell", "i told you", "i mentioned", "last time", "we discussed", "we talked about",
                "recall"));
    }

    /** 「删除/移动」这类动词在改文档的句子里是诱饵（「删除第三条」「把光标移到…」）：这两个工具要句子里提到文件才放回。 */
    private static final Set<String> FILE_VERB_TOOLS = Set.of("move_to_trash", "move_files");
    private static final List<String> FILE_CONTEXT_WORDS = List.of(
            "文件", "文档", "文件夹", "回收站", "草稿", ".docx", ".doc", ".pdf", ".xlsx", ".pptx", ".txt",
            "file", "files", "folder", "folders", "document", "documents", "doc", "docs", "draft", "drafts");

    /** 用户这一句话精确点到了哪几个退出核心集的工具（{@link #TOOL_KEYWORDS}）；不知道有没有开文档，按没开处理。 */
    public Set<String> toolsHintedBy(String userMessage) {
        return toolsHintedBy(userMessage, null);
    }

    /**
     * @param activeDocKind 当前活跃文档类型；非空表示已开着文档，此时 {@link #FILE_VERB_TOOLS} 只在句子提到文件时才放回。
     */
    public Set<String> toolsHintedBy(String userMessage, String activeDocKind) {
        if (userMessage == null || userMessage.isBlank()) {
            return Set.of();
        }
        String normalized = normalize(userMessage);
        boolean mentionsFile = activeDocKind == null
                || FILE_CONTEXT_WORDS.stream().anyMatch(w -> SkillRouter.containsTrigger(normalized, w));
        Set<String> hinted = new LinkedHashSet<>();
        for (Map.Entry<String, List<String>> entry : TOOL_KEYWORDS.entrySet()) {
            if (!mentionsFile && FILE_VERB_TOOLS.contains(entry.getKey())) {
                continue;
            }
            for (String keyword : entry.getValue()) {
                if (SkillRouter.containsTrigger(normalized, keyword)) {
                    hinted.add(entry.getKey());
                    break;
                }
            }
        }
        return hinted;
    }

    /** 小写并把弯引号撇号换成直撇号（「firm’s」与「firm's」同一个词）。 */
    private static String normalize(String text) {
        return text.toLowerCase(Locale.ROOT).replace('\u2019', '\'');
    }

    /** 把命中的工具关键词短语抠掉（换成空格），再交给类目关键词匹配。 */
    private static String withoutToolKeywords(String normalized) {
        String text = normalized;
        for (List<String> keywords : TOOL_KEYWORDS.values()) {
            for (String keyword : keywords) {
                if (SkillRouter.containsTrigger(text, keyword)) {
                    text = stripKeyword(text, keyword);
                }
            }
        }
        return text;
    }

    /** 抠掉关键词：拉丁串两端按整词抠（「move」不吃「remove」的一截），中文照旧子串。 */
    private static String stripKeyword(String text, String keyword) {
        boolean latinStart = isAsciiWordChar(keyword.charAt(0));
        boolean latinEnd = isAsciiWordChar(keyword.charAt(keyword.length() - 1));
        if (!latinStart && !latinEnd) {
            return text.replace(keyword, " ");
        }
        String pattern = (latinStart ? "(?<![a-z0-9])" : "") + java.util.regex.Pattern.quote(keyword)
                + (latinEnd ? "(?![a-z0-9])" : "");
        return text.replaceAll(pattern, " ");
    }

    private static boolean isAsciiWordChar(char c) {
        return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9');
    }

    private final boolean enabled;
    private final boolean docSessionCategoryTrim;

    /** 只管渐进披露的旧入口：类目裁剪关着。存量单测靠它保持改动前的行为。 */
    public ToolDisclosurePolicy(boolean enabled) {
        this(enabled, false);
    }

    @Autowired
    public ToolDisclosurePolicy(
            @Value("${ai.tools.progressive-disclosure.enabled:true}") boolean enabled,
            @Value("${ai.tools.doc-session-category-trim.enabled:true}") boolean docSessionCategoryTrim) {
        this.enabled = enabled;
        this.docSessionCategoryTrim = docSessionCategoryTrim;
    }

    public boolean isEnabled() {
        return enabled;
    }

    /** 活跃文档类目裁剪开没开（dev-board#1064）。与 {@link #isEnabled()} 互相独立。 */
    public boolean isDocSessionCategoryTrimEnabled() {
        return docSessionCategoryTrim;
    }

    /**
     * 这种活跃文档类型下默认不下发的类目。开关关着、或 kind 判不准时返回空集。
     */
    public Set<String> hiddenCategoriesFor(String activeDocKind) {
        if (!docSessionCategoryTrim || activeDocKind == null) {
            return Set.of();
        }
        return HIDDEN_CATEGORIES_BY_DOC_KIND.getOrDefault(activeDocKind, Set.of());
    }

    /**
     * 按活跃文档类型再裁一刀（dev-board#1064）：去掉「属于本类型隐藏类目、且还没被放回」的工具。
     *
     * <p>纯函数、只收窄：核心集与 {@code list_tools} 永不裁（前者 {@link #categoryOf} 返回 core，
     * 后者本身就在核心集里）。开关关着或 kind 判不准时原样返回。
     */
    public List<ToolSpecification> trimForDocKind(List<ToolSpecification> candidates, String activeDocKind,
                                                  Set<String> expanded) {
        return trimForDocKind(candidates, activeDocKind, expanded, Set.of());
    }

    /** @param extraNames 生效 skill 白名单点名的工具：即使所在类目被藏也按名保留。 */
    public List<ToolSpecification> trimForDocKind(List<ToolSpecification> candidates, String activeDocKind,
                                                  Set<String> expanded, Set<String> extraNames) {
        Set<String> hidden = hiddenCategoriesFor(activeDocKind);
        if (hidden.isEmpty() || candidates == null) {
            return candidates;
        }
        Set<String> open = expanded == null ? Set.of() : expanded;
        List<ToolSpecification> kept = new ArrayList<>();
        for (ToolSpecification spec : candidates) {
            String category = categoryOf(spec.name());
            if (!hidden.contains(category) || open.contains(category)
                    || (extraNames != null && extraNames.contains(spec.name()))) {
                kept.add(spec);
            }
        }
        return kept;
    }

    /**
     * 用户这一句话提示了哪些类目（关键词表 {@link #CATEGORY_KEYWORDS}）。
     * 「这是什么文件？」这种中性问句返回空集。只返回 {@link #categoryNames()} 里真有的类目。
     */
    public Set<String> categoriesHintedBy(String userMessage) {
        if (userMessage == null || userMessage.isBlank()) {
            return Set.of();
        }
        String normalized = withoutToolKeywords(normalize(userMessage));
        Set<String> known = categoryNames();
        Set<String> hinted = new LinkedHashSet<>();
        for (Map.Entry<String, List<String>> entry : CATEGORY_KEYWORDS.entrySet()) {
            if (!known.contains(entry.getKey())) {
                continue;
            }
            for (String keyword : entry.getValue()) {
                if (SkillRouter.containsTrigger(normalized, keyword.toLowerCase(Locale.ROOT))) {
                    hinted.add(entry.getKey());
                    break;
                }
            }
        }
        if (!hinted.contains(PLUGIN_TOOLS_CATEGORY)) {
            try {
                for (String keyword : pluginToolKeywords.get()) {
                    if (keyword != null && !keyword.isBlank()
                            && SkillRouter.containsTrigger(normalized, keyword.toLowerCase(Locale.ROOT))) {
                        hinted.add(PLUGIN_TOOLS_CATEGORY);
                        break;
                    }
                }
            } catch (RuntimeException ignored) {
                // 判不准就不提示：披露是优化，不能让它掀翻起跑
            }
        }
        return hinted;
    }

    /** 单轮关键词预放回类目上限（tool-surface-audit S1）。其余留给模型 {@code list_tools(category)}。 */
    public static final int MAX_KEYWORD_PUTBACK = 3;

    /** 同分时的固定先后：越靠前越先放回（律师日常最高频、规格最小的优先）。 */
    private static final List<String> PUTBACK_PRIORITY = List.of(
            "task", "legal", "revision", "memory", "spreadsheet", "slides", "format", "table", "files",
            "template", "evidence", "pdf", "meeting", "plugin-tools", "version", "enterprise-data",
            "litigation", "python", "plugin", "mcp");

    /**
     * {@link #categoriesHintedBy} 的限量版：最多 {@value #MAX_KEYWORD_PUTBACK} 类，
     * 按命中强度（命中关键词的总长度，越长越具体）从高到低取，同分按 {@link #PUTBACK_PRIORITY}，
     * 确定性。没进前三的类目模型仍可 {@code list_tools(category)} 展开。
     */
    public Set<String> categoriesPutBackFor(String userMessage) {
        Set<String> hinted = categoriesHintedBy(userMessage);
        if (hinted.size() <= MAX_KEYWORD_PUTBACK) {
            return hinted;
        }
        String normalized = withoutToolKeywords(normalize(userMessage));
        Map<String, Integer> score = new LinkedHashMap<>();
        for (String category : hinted) {
            int total = 0;
            for (String keyword : CATEGORY_KEYWORDS.getOrDefault(category, List.of())) {
                if (SkillRouter.containsTrigger(normalized, keyword.toLowerCase(Locale.ROOT))) {
                    total += keyword.length();
                }
            }
            score.put(category, Math.max(total, 1));
        }
        List<String> ranked = new ArrayList<>(hinted);
        ranked.sort((a, b) -> {
            int byScore = Integer.compare(score.get(b), score.get(a));
            if (byScore != 0) {
                return byScore;
            }
            int pa = PUTBACK_PRIORITY.indexOf(a);
            int pb = PUTBACK_PRIORITY.indexOf(b);
            return Integer.compare(pa < 0 ? Integer.MAX_VALUE : pa, pb < 0 ? Integer.MAX_VALUE : pb);
        });
        return new LinkedHashSet<>(ranked.subList(0, MAX_KEYWORD_PUTBACK));
    }

    /** 关键词表覆盖的类目（只读）。契约测试据它核对每个键都是目录认得的类目——认不得就永远不会被提示。 */
    public Set<String> keywordCategories() {
        return java.util.Collections.unmodifiableSet(CATEGORY_KEYWORDS.keySet());
    }

    /**
     * 一组工具名涉及哪些类目（不含 core）。用于 skill 放回：skill 白名单里点名的工具，
     * 它们所在的类目整类放回——skill 作者列了 run_python，就是说这一轮要用 Python。
     */
    public Set<String> categoriesCoveredBy(Collection<String> toolNames) {
        if (toolNames == null || toolNames.isEmpty()) {
            return Set.of();
        }
        Set<String> covered = new LinkedHashSet<>();
        for (String name : toolNames) {
            String category = categoryOf(name);
            if (!"core".equals(category)) {
                covered.add(category);
            }
        }
        return covered;
    }

    /**
     * 下发给模型的工具规格的规范顺序：核心集按 {@link #CORE} 声明顺序在前，其余按（类目在 {@link #CATEGORIES}
     * 里的声明序、plugin-tools、misc，再按名字）排。纯函数，与 JVM、bean 扫描顺序、反射方法顺序无关——
     * 供应商的 prompt 缓存要求 tools 前缀逐字节一致，顺序漂移 = 跨会话缓存全废。
     */
    public List<ToolSpecification> canonicalOrder(List<ToolSpecification> specs) {
        List<String> coreOrder = new ArrayList<>(CORE);
        List<String> categoryOrder = new ArrayList<>(CATEGORIES.keySet());
        categoryOrder.add(PLUGIN_TOOLS_CATEGORY);
        categoryOrder.add(FALLBACK_CATEGORY);
        Map<String, int[]> rank = new LinkedHashMap<>();
        for (ToolSpecification spec : specs) {
            String name = spec.name();
            int core = coreOrder.indexOf(name);
            if (core >= 0) {
                rank.put(name, new int[] {0, core});
            } else {
                int cat = categoryOrder.indexOf(categoryOf(name));
                rank.put(name, new int[] {1, cat < 0 ? categoryOrder.size() : cat});
            }
        }
        List<ToolSpecification> sorted = new ArrayList<>(specs);
        sorted.sort(java.util.Comparator
                .<ToolSpecification>comparingInt(sp -> rank.get(sp.name())[0])
                .thenComparingInt(sp -> rank.get(sp.name())[1])
                .thenComparing(ToolSpecification::name));
        return sorted;
    }

    /** 核心集（只读）。供契约测试核对「名字是不是真的存在」与常用链的覆盖面。 */
    public Set<String> coreToolNames() {
        return CORE;
    }

    /** 启用插件在 manifest 里声明的 keywords（规范 v2.13 §20）：命中即预放回 plugin-tools 类目。活视图。 */
    private volatile Supplier<List<String>> pluginToolKeywords = List::of;

    /** 由 {@code ToolRegistry} 在初始化时调一次。 */
    public void setPluginToolKeywords(Supplier<List<String>> source) {
        this.pluginToolKeywords = source == null ? List::of : source;
    }

    /** 由 {@code ToolRegistry} 在初始化时调一次（见 {@link #pluginToolNames}）。null 视为没有插件工具。 */
    public void setPluginToolNames(Supplier<Set<String>> source) {
        this.pluginToolNames = source == null ? Set::of : source;
    }

    /** 这个工具属于哪个类目。核心集里的工具返回 {@code "core"}。全函数，永不返回 null。 */
    public String categoryOf(String toolName) {
        if (toolName == null) {
            return FALLBACK_CATEGORY;
        }
        if (CORE.contains(toolName)) {
            return "core";
        }
        return ruleCategoryOf(toolName);
    }

    /** 忽略核心集、只按类目规则归属（core 工具的「本来所属类目」，供 list_tools 展开时列全）。 */
    public String ruleCategoryOf(String toolName) {
        if (toolName == null) {
            return FALLBACK_CATEGORY;
        }
        if (isPluginTool(toolName)) {
            return PLUGIN_TOOLS_CATEGORY;
        }
        for (Map.Entry<String, List<String>> entry : CATEGORIES.entrySet()) {
            for (String rule : entry.getValue()) {
                boolean hit = rule.startsWith("name:")
                        ? toolName.equals(rule.substring(5))
                        : toolName.startsWith(rule);
                if (hit) {
                    return entry.getKey();
                }
            }
        }
        return FALLBACK_CATEGORY;
    }

    /** 插件工具判定。来源抛异常一律当「不是」：判不准就落回普通规则，绝不让目录整个挂掉。 */
    private boolean isPluginTool(String toolName) {
        try {
            Set<String> names = pluginToolNames.get();
            return names != null && names.contains(toolName);
        } catch (RuntimeException e) {
            return false;
        }
    }

    /** 目录里出现过的全部类目名（不含 core），供 {@code list_tools} 的描述与校验用。 */
    public Set<String> categoryNames() {
        Set<String> names = new LinkedHashSet<>(CATEGORIES.keySet());
        names.add(PLUGIN_TOOLS_CATEGORY);
        names.add(FALLBACK_CATEGORY);
        return names;
    }

    /**
     * 本轮真正下发的工具集 = 核心集 ∪ 已展开类目里的工具。
     *
     * <p>入参是上游三层闸（会话能力 / 活跃文档类型 / 运行期可用性）过完的候选集，
     * 本方法只在它上面再收窄一次，绝不放宽。
     */
    public List<ToolSpecification> narrow(List<ToolSpecification> candidates, Set<String> expanded) {
        return narrow(candidates, expanded, false);
    }

    /**
     * @param noFile 没开文件态（LOWA 且无活跃文档）：文档编辑原语（doc_/sheet_/slide_，核心集与已展开类目里的，
     *               除打开 / 流式新建入口外）暂不下发，新建表格 / 演示文稿作为入口补进来；
     *               其余类目照常按展开集放行。
     */
    public List<ToolSpecification> narrow(List<ToolSpecification> candidates, Set<String> expanded, boolean noFile) {
        return narrow(candidates, expanded, noFile, Set.of());
    }

    /** @param extraNames 生效 skill 白名单里点名的工具：按名字放行，不连带整个类目。 */
    public List<ToolSpecification> narrow(List<ToolSpecification> candidates, Set<String> expanded, boolean noFile,
                                          Set<String> extraNames) {
        Set<String> open = expanded == null ? Set.of() : expanded;
        List<ToolSpecification> kept = new ArrayList<>();
        for (ToolSpecification spec : candidates) {
            String name = spec.name();
            String category = categoryOf(name);
            if (extraNames != null && extraNames.contains(name)) {
                kept.add(spec);
            } else if (noFile && NOFILE_ENTRY_EXTRA.contains(name)) {
                kept.add(spec);
            } else if (noFile && isDocEditPrimitive(name) && !NOFILE_KEPT_DOC_TOOLS.contains(name)) {
                // 没有文档时编辑原语（含被关键词放回的类目里的）一个都用不上；打开 / 新建后 noFile 清零，随展开集回来
                continue;
            } else if ("core".equals(category)) {
                kept.add(spec);
            } else if (open.contains(category)) {
                kept.add(spec);
            }
        }
        return kept;
    }

    /** 每轮下发工具总数上限（tool-system-v2 B6 / V2）。超过时按 LRU 逐个收回已展开类目。 */
    public static final int MAX_OFFERED_PER_ROUND = 45;

    /** 模型经 {@code list_tools} 明确要的类目，在之后多少轮内不被收回。 */
    public static final int LIST_TOOLS_PROTECT_ROUNDS = 2;

    /**
     * 中途增长封顶：{@link #narrow} 的结果加上编排器另补的 {@code reserve} 个工具超过
     * {@link #MAX_OFFERED_PER_ROUND} 时，从已展开类目里按「最近使用轮次最小、同分按类目名」逐个收回，
     * 直到不超或无类目可收。纯函数、确定性。
     *
     * <p>永不收回：核心集（不属于任何类目）、skill 点名的工具（{@code extraNames} 按名放行）、
     * 受保护类目（{@code protectedCategories}：模型最近两轮用 list_tools 要的、本轮刚放回或刚用过的）。
     * 只考虑真对候选集有贡献的类目，收回一个零贡献的类目没有意义。
     *
     * @param lastUsed 类目 → 最近一次放回或被调用的轮次（缺省按 0）
     * @param requestedNames 按名放回的工具（关键词精确放回 / list_tools(names|query)）：与类目同池 LRU，键带 {@link #TOOL_KEY} 前缀
     * @return 被收回的键（类目名，或带前缀的工具名）；不需要收回时为空集
     */
    public Set<String> evictToBudget(List<ToolSpecification> candidates, Set<String> expanded,
                                     Set<String> requestedNames, boolean noFile,
                                     Set<String> skillNames, Map<String, Integer> lastUsed,
                                     Set<String> protectedKeys, int reserve) {
        if (candidates == null || expanded == null || (expanded.isEmpty() && requestedNames.isEmpty())) {
            return Set.of();
        }
        Set<String> contributing = new LinkedHashSet<>();
        for (ToolSpecification spec : candidates) {
            String category = categoryOf(spec.name());
            if (!"core".equals(category)) {
                contributing.add(category);
                if (!skillNames.contains(spec.name())) {
                    contributing.add(TOOL_KEY + spec.name());
                }
            }
        }
        Set<String> work = new LinkedHashSet<>(expanded);
        requestedNames.forEach(n -> work.add(TOOL_KEY + n));
        Set<String> evicted = new LinkedHashSet<>();
        int current;
        while ((current = size(candidates, work, noFile, skillNames)) + reserve > MAX_OFFERED_PER_ROUND) {
            String victim = null;
            for (String key : work) {
                if (!contributing.contains(key) || protectedKeys.contains(key)) {
                    continue;
                }
                Set<String> without = new LinkedHashSet<>(work);
                without.remove(key);
                if (size(candidates, without, noFile, skillNames) >= current) {
                    continue; // 收回它省不下一个工具（已被别的类目 / skill 覆盖）
                }
                if (victim == null) {
                    victim = key;
                    continue;
                }
                int byUse = Integer.compare(lastUsed.getOrDefault(key, 0), lastUsed.getOrDefault(victim, 0));
                if (byUse < 0 || (byUse == 0 && key.compareTo(victim) < 0)) {
                    victim = key;
                }
            }
            if (victim == null) {
                break;
            }
            work.remove(victim);
            evicted.add(victim);
        }
        return evicted;
    }

    /** {@link #evictToBudget} 里类目与「按名放回」共用一个键空间：按名的键带这个前缀。 */
    public static final String TOOL_KEY = "tool:";

    private int size(List<ToolSpecification> candidates, Set<String> work, boolean noFile, Set<String> skillNames) {
        Set<String> cats = new LinkedHashSet<>();
        Set<String> extra = new LinkedHashSet<>(skillNames);
        for (String key : work) {
            if (key.startsWith(TOOL_KEY)) {
                extra.add(key.substring(TOOL_KEY.length()));
            } else {
                cats.add(key);
            }
        }
        return narrow(candidates, cats, noFile, extra).size();
    }

    /**
     * 把 {@code list_tools} 传来的类目参数解析成真正要展开的类目名。
     * 支持逗号分隔（一次展开几个类目，省掉来回几轮）；未知类目原样丢弃。
     */
    public Set<String> parseCategories(String raw) {
        if (raw == null || raw.isBlank()) {
            return Set.of();
        }
        Set<String> known = categoryNames();
        Set<String> parsed = new LinkedHashSet<>();
        for (String piece : raw.split("[,，\\s]+")) {
            String name = piece.trim().toLowerCase(Locale.ROOT);
            if (known.contains(name)) {
                parsed.add(name);
            }
        }
        return parsed;
    }
}
