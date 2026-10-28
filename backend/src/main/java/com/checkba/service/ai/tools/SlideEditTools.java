// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ai.tools;

import com.checkba.service.ai.EditorBridgeService;
import com.checkba.service.LangText;
import dev.langchain4j.agent.tool.P;
import dev.langchain4j.agent.tool.Tool;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.util.HashMap;
import java.util.Map;

/**
 * 演示文稿（Impress / pptx）实时编辑工具集：slide_* 原语。
 *
 * 与 doc_*（Writer）/sheet_*（Calc）三分，互不相通——工具名前缀是
 * ClientCapabilityService 会话能力过滤的依据，也是 EditorBridgeService 经
 * SSE client_action 下发到前端 EDITOR_ACTIONS 白名单的 action 名（工具名 = action 名，
 * 不做映射，沿用 sheet_* 口径，doc_* 的映射表是历史包袱）。
 *
 * PowerPoint/Impress 没有修订（redline）机制，写类原语直接生效——安全网是本轮首个
 * MODIFIED 工具前建立的文档检查点（@ToolMeta fileEffect=MODIFIED）与 doc_undo，
 * 工具描述里对模型明说，避免模型误以为可以走审阅面板撤销。
 *
 * 本文件实现设计 Phase 1（打开/读取/文本编辑，7 个原语：slide_get_overview /
 * slide_get_page / slide_read_notes / slide_write_notes / slide_goto /
 * slide_set_shape_text / slide_replace_text）、Phase 2（页与形状结构，8 个原语：
 * slide_add_page / slide_delete_page / slide_move_page / slide_set_layout /
 * slide_add_text_box / slide_add_shape / slide_delete_shape / slide_set_shape_geometry）
 * 与 Phase 3（格式与表格，7 个原语：slide_format_text / slide_format_shape /
 * slide_add_table / slide_table_read / slide_table_set_cell / slide_table_set_style /
 * slide_set_hyperlink）。slide_format_shape 与 slide_table_set_style 不在 spec 的
 * 20 个原语表里，是任务方在实施指令里直接点名要补的两项（形状填充/边框、表头加粗/
 * 边框/列宽），随 Phase 3 一并落地。
 *
 * 设计依据：docs/superpowers/specs/2026-08-07-impress-bridge-design.md §4（原语表）。
 * 新建独立文件而非塞进 DocumentEditTools：后者的 doc_*+sheet_* 已 70+ 个方法，
 * ToolRegistry 经 List&lt;AgentToolComponent&gt; 自动发现，无需改动 ToolRegistry。
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class SlideEditTools implements AgentToolComponent {

    private final EditorBridgeService editorBridgeService;

    private String executeEditorCommand(String action, Map<String, Object> params) {
        String response = editorBridgeService.executeEditorCommand(action, params);
        if (response == null || !response.stripLeading().startsWith("{")) return response;
        try {
            cn.hutool.json.JSONObject result = cn.hutool.json.JSONUtil.parseObj(response);
            String code = result.getStr("errorCode", result.getStr("error"));
            if (code == null) return response;
            String message = switch (code) {
                case "SLIDE_AMBIGUOUS_SHAPE" -> LangText.of("形状名重复，请先重命名或重新定位后编辑", "Shape name is ambiguous; rename duplicates before editing");
                case "SLIDE_MISSING_REPLACE_TEXT" -> LangText.of("缺少替换文字；删除请显式传空字符串", "Missing replacement text; use an empty string to delete");
                case "SLIDE_TARGET_REQUIRED" -> LangText.of("精确替换须提供页码", "Targeted replacement requires a slide number");
                case "SLIDE_EXPECTED_TARGET_REQUIRED" -> LangText.of("原文校验须同时提供形状名", "Expected text requires a shape name");
                case "SLIDE_INVALID_NUMBER" -> LangText.of("页码须为范围内的整数，从1开始", "Slide number must be an in-range integer, starting at 1");
                case "SLIDE_STALE_TEXT" -> LangText.of("形状文字已变化，请重新读取后编辑", "Shape text changed; read the page again before editing");
                case "SLIDE_REPLACE_INTERRUPTED" -> LangText.of("替换中断，部分修改可能已生效；先回读核对，勿直接重试", "Replacement interrupted; some edits may have applied. Read back before retrying");
                case "SLIDE_INSERT_UNCERTAIN" -> LangText.of("插页结果未知，先读取总览核对，勿重复插入", "Slide insertion outcome is unknown. Read the overview; do not insert again");
                case "SLIDE_INSERT_PARTIAL" -> LangText.of("新页已创建，但后续设置未完成。勿重复插入；先读取总览，继续修复已创建的页面", "A slide was created but its setup is incomplete. Do not insert again; read the overview and repair the existing slide");
                case "SLIDE_LAYOUT_REQUIRED" -> LangText.of("版式、母版或背景颜色至少提供一项", "Supply a layout, master or background color");
                case "SLIDE_INVALID_BACKGROUND" -> LangText.of("背景色须为 #RRGGBB 格式", "Background color must be #RRGGBB");
                case "SLIDE_BACKGROUND_FAILED" -> LangText.of("设置页面背景失败，请回读当前背景后处理", "Could not set the slide background; inspect its current state");
                case "SLIDE_RIGHT_INDENT_UNSUPPORTED" -> LangText.of("当前 PPTX 引擎无法保存非零段落右缩进，本次未应用任何格式。请省略 rightIndentPt 或设为0", "The current PPTX engine cannot persist nonzero paragraph right indents. No formatting was applied; omit rightIndentPt or set it to zero");
                case "SLIDE_INVALID_PARAGRAPH_FORMAT" -> LangText.of("段落格式参数无效，请检查数值及行距模式", "Invalid paragraph format; check numeric values and line spacing mode");
                case "SLIDE_UNSUPPORTED_PARAGRAPH_STYLE" -> LangText.of("幻灯片不支持 Word 段落样式或标题级别，请使用具体格式参数", "Slides do not support Word paragraph styles or heading levels; use explicit formatting");
                case "SLIDE_PARAGRAPH_FORMAT_FAILED" -> LangText.of("段落格式设置中断，请回读核对已应用的格式", "Paragraph formatting interrupted; read back the applied formatting");
                case "SLIDE_TABLE_TEXT_TOOL_REQUIRED" -> LangText.of("表格文字请使用 slide_table_set_style，指定需要格式化的单元格范围", "Use slide_table_set_style with a cell range to format table text");
                case "SLIDE_INVALID_CELL_FORMAT" -> LangText.of("单元格格式或范围无效，请检查0起始行列号、颜色及正数字号", "Invalid cell format or range; check zero-based row/column bounds, colors and positive font size");
                case "SLIDE_CELL_FORMAT_PARTIAL" -> LangText.of("单元格格式设置中断，部分格式可能已应用，请回读核对", "Cell formatting interrupted; some formatting may have applied. Read back before retrying");
                case "SLIDE_INVALID_TABLE_DATA" -> LangText.of("表格数据须为非空二维数组，每行须为非空数组且列数相同", "Table data must be a nonempty two-dimensional array with nonempty rows of equal length");
                case "SLIDE_TABLE_WRITE_PARTIAL" -> LangText.of("表格已创建，但单元格内容写入中断。请按返回的形状名及行列位置回读并修复，勿重复创建", "Table created, but cell writing was interrupted. Inspect and repair the returned shape and cell coordinates; do not create it again");
                case "SLIDE_TABLE_SIZE_PARTIAL" -> LangText.of("表格已创建，但行列尺寸设置未完成，请回读并修复现有表格，勿重复创建", "Table created, but row/column sizing is incomplete; inspect and repair the existing table, do not create it again");
                case "SLIDE_ROW_HEIGHT_FAILED" -> LangText.of("行高设置中断，请读取实际行高核对", "Row height update interrupted; inspect the actual row heights");
                case "SLIDE_INVALID_CHART_DATA" -> LangText.of("图表分类和系列数据无效，请核对数量、数值和图表类型", "Invalid chart categories or series; check lengths, values and chart type");
                case "SLIDE_INVALID_GEOMETRY" -> LangText.of("位置须为有限数值，宽高须大于0", "Position must be finite and dimensions must be positive");
                case "SLIDE_CHART_PARTIAL" -> LangText.of("图表创建中断，请先回读现有形状再修复，勿重复创建", "Chart creation interrupted; inspect existing shapes before repairing, do not create again");
                case "SLIDE_INVALID_TRANSITION" -> LangText.of("过渡须为none/fade/push/wipe，时长须为0.1至5秒", "Use none/fade/push/wipe with a duration from 0.1 to 5 seconds");
                case "SLIDE_TRANSITION_PARTIAL" -> LangText.of("过渡设置中断，请先回读当前页设置", "Transition update interrupted; inspect current slide settings");
                case "SLIDE_INVALID_CHART_STYLE" -> LangText.of("图表样式参数无效", "Invalid chart style parameters");
                case "SLIDE_NOT_CHART" -> LangText.of("目标形状不是原生图表", "The target shape is not a native chart");
                case "SLIDE_CHART_STYLE_PARTIAL" -> LangText.of("图表样式修改中断，请回读确认后继续", "Chart styling interrupted; inspect the result before continuing");
                default -> null;
            };
            if (message == null) return response;
            result.set("errorCode", code);
            result.set("error", message);
            result.set("message", message);
            return result.toString();
        } catch (RuntimeException ignored) {
            return response;
        }
    }

    @ToolMeta(displayName = "插入原生图表", category = "document", fileEffect = "MODIFIED")
    @Tool("Create an editable native chart on a slide. chartType: column/bar/line/area/pie/doughnut/scatter. "
            + "categoriesJson is an array of category labels (numeric X labels for scatter); seriesJson is an array of {name,values:[numbers]}. "
            + "Every series must match category count. Pie/doughnut accept one nonnegative series. Geometry is in points. "
            + "Use factual source data, preserve units, and inspect the rendered chart. On partial failure read back before retrying.")
    public String slide_add_chart(
            @P("Slide number, 1-based") Integer slideNumber,
            @P("column/bar/line/area/pie/doughnut/scatter") String chartType,
            @P("JSON array of category labels") String categoriesJson,
            @P("JSON array of {name,values}") String seriesJson,
            @P("Left in points") Double left, @P("Top in points") Double top,
            @P("Width in points") Double width, @P("Height in points") Double height,
            @P(value = "Optional chart title", required = false) String title) {
        try {
            var mapper = new com.fasterxml.jackson.databind.ObjectMapper();
            Object categories = mapper.readValue(categoriesJson, java.util.List.class);
            Object series = mapper.readValue(seriesJson, java.util.List.class);
            Map<String, Object> params = new HashMap<>();
            params.put("slideNumber", slideNumber); params.put("chartType", chartType);
            params.put("categories", categories); params.put("series", series);
            params.put("left", left); params.put("top", top); params.put("width", width); params.put("height", height);
            if (title != null) params.put("title", title);
            return executeEditorCommand("slide_add_chart", params);
        } catch (Exception e) {
            return "Error: " + LangText.of("图表参数无效，请核对分类与系列JSON", "Invalid chart parameters; check category and series JSON");
        }
    }

    @ToolMeta(displayName = "设置图表样式", category = "document", fileEffect = "MODIFIED")
    @Tool("Style a native chart by its exact shapeName from slide_get_page. Colors are #RRGGBB. "
            + "seriesColorsJson is a JSON array of colors; pie/doughnut apply it to slices. "
            + "Optional values leave existing settings unchanged. Inspect actual rendered labels and contrast.")
    public String slide_format_chart(
            @P("Slide number, 1-based") Integer slideNumber, @P("Exact chart shape name") String shapeName,
            @P(value = "Chart and plot background color", required = false) String backgroundColor,
            @P(value = "Title, legend and axis text color", required = false) String textColor,
            @P(value = "Font size in points, 8 to 72", required = false) Double fontSize,
            @P(value = "JSON color array for series or slices", required = false) String seriesColorsJson,
            @P(value = "Show legend", required = false) Boolean showLegend,
            @P(value = "Show value-axis grid", required = false) Boolean showGrid) {
        try {
            Map<String, Object> params = new HashMap<>();
            params.put("slideNumber", slideNumber); params.put("shapeName", shapeName);
            if (backgroundColor != null) params.put("backgroundColor", backgroundColor);
            if (textColor != null) params.put("textColor", textColor);
            if (fontSize != null) params.put("fontSize", fontSize);
            if (seriesColorsJson != null) params.put("seriesColors", new com.fasterxml.jackson.databind.ObjectMapper().readValue(seriesColorsJson, java.util.List.class));
            if (showLegend != null) params.put("showLegend", showLegend);
            if (showGrid != null) params.put("showGrid", showGrid);
            return executeEditorCommand("slide_format_chart", params);
        } catch (Exception e) {
            return "Error: " + LangText.of("图表样式参数无效", "Invalid chart style parameters");
        }
    }

    @ToolMeta(displayName = "设置翻页过渡", category = "document", fileEffect = "MODIFIED")
    @Tool("Set a slide transition: none/fade/push/wipe, with durationSeconds from 0.1 to 5 (default 0.6). "
            + "Does not change automatic slide advancement. Static PDF cannot demonstrate motion; verify actual playback separately.")
    public String slide_set_transition(
            @P("Slide number, 1-based") Integer slideNumber,
            @P("none/fade/push/wipe") String effect,
            @P(value = "Duration in seconds, default 0.6", required = false) Double durationSeconds) {
        Map<String, Object> params = new HashMap<>();
        params.put("slideNumber", slideNumber); params.put("effect", effect);
        if (durationSeconds != null) params.put("durationSeconds", durationSeconds);
        return executeEditorCommand("slide_set_transition", params);
    }

    private static final String NO_REVISION_NOTE =
            "PPT 没有修订机制，改动直接生效，无法像 Word 那样在审阅面板里逐条撤销；" +
            "误改请用 doc_restore_checkpoint 回滚到本轮开始前的快照。";

    @Tool("【幻灯片·看】查看当前打开的演示文稿（pptx/odp）总览：每页的页码、名称、版式、母版、标题文字、" +
          "形状数、是否有备注、是否含表格。打开演示文稿后先用本工具了解结构，再决定读哪一页、改哪个形状。" +
          "Word 文档请用 doc_* 工具，电子表格请用 sheet_* 工具，本工具仅对演示文稿有效。")
    public String slide_get_overview() {
        log.info("Tool: slide_get_overview called");
        try {
            return executeEditorCommand("slide_get_overview", null);
        } catch (Exception e) {
            log.error("Failed to get slide overview", e);
            return "Error: " + e.getMessage();
        }
    }

    @Tool("【幻灯片·看】读取指定页的明细：页面尺寸（磅）、版式、母版、备注文字，以及该页每个形状的名称、" +
          "类型、位置尺寸（磅）、文字、填充边框、页面背景及段落/run 格式（字体字号、行距、段距与缩进）。" +
          "textDetails 标明 available/truncated；不足以替代视觉对照。表格形状另带行列数。返回的 shapeName 是后续原语" +
          "（slide_set_shape_text / slide_goto 等）定位该形状的依据——未命名形状会被自动分配一个稳定名" +
          "（形如 __awd_shape_3），此后按名定位，不受形状顺序变化影响。")
    public String slide_get_page(
            @P("页码，1 开始") Integer slideNumber
    ) {
        log.info("Tool: slide_get_page called slideNumber={}", slideNumber);
        if (slideNumber == null) {
            return "Error: 缺少 slideNumber 参数（1 开始）";
        }
        try {
            Map<String, Object> params = new HashMap<>();
            params.put("slideNumber", slideNumber);
            return executeEditorCommand("slide_get_page", params);
        } catch (Exception e) {
            log.error("Failed to get slide page", e);
            return "Error: " + e.getMessage();
        }
    }

    @Tool("【幻灯片·看】读取备注页（Speaker Notes）文字。不传 slideNumber 则读取全篇所有页的备注。")
    public String slide_read_notes(
            @P(value = "页码，1 开始；不传则读取全篇所有页", required = false) Integer slideNumber
    ) {
        log.info("Tool: slide_read_notes called slideNumber={}", slideNumber);
        try {
            Map<String, Object> params = new HashMap<>();
            if (slideNumber != null) params.put("slideNumber", slideNumber);
            return executeEditorCommand("slide_read_notes", params);
        } catch (Exception e) {
            log.error("Failed to read slide notes", e);
            return "Error: " + e.getMessage();
        }
    }

    @ToolMeta(displayName = "写入备注", category = "document", fileEffect = "MODIFIED")
    @Tool("【幻灯片·写】整体覆盖指定页的备注页（Speaker Notes）文字（不是追加）。" + NO_REVISION_NOTE)
    public String slide_write_notes(
            @P("页码，1 开始") Integer slideNumber,
            @P("备注文字，整体覆盖该页原有备注") String text
    ) {
        log.info("Tool: slide_write_notes called slideNumber={}", slideNumber);
        if (slideNumber == null) {
            return "Error: 缺少 slideNumber 参数（1 开始）";
        }
        try {
            Map<String, Object> params = new HashMap<>();
            params.put("slideNumber", slideNumber);
            params.put("text", text != null ? text : "");
            return executeEditorCommand("slide_write_notes", params);
        } catch (Exception e) {
            log.error("Failed to write slide notes", e);
            return "Error: " + e.getMessage();
        }
    }

    @Tool("【幻灯片·定位】把编辑器视图切到指定页（用户能看到 AI 正在操作哪一页），可选再选中该页某个形状。" +
          "改动一个形状前建议先用本工具定位，让操作过程对用户可见。")
    public String slide_goto(
            @P("页码，1 开始") Integer slideNumber,
            @P(value = "要一并选中的形状名（可选，来自 slide_get_page 返回的 shapeName）", required = false) String shapeName
    ) {
        log.info("Tool: slide_goto called slideNumber={}, shapeName={}", slideNumber, shapeName);
        if (slideNumber == null) {
            return "Error: 缺少 slideNumber 参数（1 开始）";
        }
        try {
            Map<String, Object> params = new HashMap<>();
            params.put("slideNumber", slideNumber);
            if (shapeName != null && !shapeName.isBlank()) params.put("shapeName", shapeName);
            return executeEditorCommand("slide_goto", params);
        } catch (Exception e) {
            log.error("Failed to goto slide", e);
            return "Error: " + e.getMessage();
        }
    }

    @ToolMeta(displayName = "设置形状文字", category = "document", fileEffect = "MODIFIED")
    @Tool("【幻灯片·写】整体覆盖指定形状（文本框/标题/占位符）的文字（不是追加）。形状用 slide_get_page " +
          "返回的 shapeName 定位——改之前建议先调 slide_get_page 看清该页有哪些形状。" + NO_REVISION_NOTE)
    public String slide_set_shape_text(
            @P("页码，1 开始") Integer slideNumber,
            @P("形状名，来自 slide_get_page 返回的 shapeName") String shapeName,
            @P("新文字，整体覆盖该形状原有文字") String text
    ) {
        log.info("Tool: slide_set_shape_text called slideNumber={}, shapeName={}", slideNumber, shapeName);
        if (slideNumber == null) {
            return "Error: 缺少 slideNumber 参数（1 开始）";
        }
        if (shapeName == null || shapeName.isBlank()) {
            return "Error: 缺少 shapeName 参数（先用 slide_get_page 查看该页形状名）";
        }
        try {
            Map<String, Object> params = new HashMap<>();
            params.put("slideNumber", slideNumber);
            params.put("shapeName", shapeName);
            params.put("text", text != null ? text : "");
            return executeEditorCommand("slide_set_shape_text", params);
        } catch (Exception e) {
            log.error("Failed to set shape text", e);
            return "Error: " + e.getMessage();
        }
    }

    @ToolMeta(displayName = "替换幻灯片文字", category = "document", fileEffect = "MODIFIED")
    @Tool("【幻灯片·写】查找并替换文字，覆盖普通文本框、标题、占位符与表格单元格。缺省只替换第一处命中" +
          "并返回且保留范围外格式；all=true 替换全篇（或 slideNumber 限定页内）全部匹配。" +
          "局部修改先读 slide_get_page，再传 slideNumber、shapeName 和完整 expectedText 核验原文，避免改错同名文字。" +
          NO_REVISION_NOTE)
    public String slide_replace_text(
            @P("要查找的文字") String searchText,
            @P("替换为的文字") String replaceText,
            @P(value = "限定页码，1 开始；不传则搜索全篇", required = false) Integer slideNumber,
            @P(value = "是否替换全部匹配（默认 false，只替换第一处命中）", required = false) Boolean all,
            @P(value = "限定形状名（可选，须同时给 slideNumber；来自 slide_get_page）", required = false) String shapeName,
            @P(value = "目标形状完整原文（可选，须同时给 slideNumber 与 shapeName；已变化则拒绝写入）", required = false) String expectedText
    ) {
        log.info("Tool: slide_replace_text called searchText={}, slideNumber={}, all={}", searchText, slideNumber, all);
        if (searchText == null || searchText.isEmpty()) {
            return "Error: 缺少 searchText 参数";
        }
        if (replaceText == null) {
            return LangText.of("Error: 缺少 replaceText；删除请显式传空字符串", "Error: Missing replaceText; use an empty string to delete");
        }
        if ((shapeName != null || expectedText != null) && slideNumber == null) {
            return LangText.of("Error: 精确替换须提供 slideNumber", "Error: A targeted replacement requires slideNumber");
        }
        if (expectedText != null && (shapeName == null || shapeName.isBlank())) {
            return LangText.of("Error: expectedText 须同时提供 shapeName", "Error: expectedText requires shapeName");
        }
        try {
            Map<String, Object> params = new HashMap<>();
            params.put("searchText", searchText);
            params.put("replaceText", replaceText != null ? replaceText : "");
            if (slideNumber != null) params.put("slideNumber", slideNumber);
            if (all != null) params.put("all", all);
            if (shapeName != null && !shapeName.isBlank()) params.put("shapeName", shapeName);
            if (expectedText != null) params.put("expectedText", expectedText);
            return executeEditorCommand("slide_replace_text", params);
        } catch (Exception e) {
            log.error("Failed to replace slide text", e);
            return "Error: " + e.getMessage();
        }
    }

    public String slide_replace_text(String searchText, String replaceText, Integer slideNumber, Boolean all) {
        return slide_replace_text(searchText, replaceText, slideNumber, all, null, null);
    }

    // ==================== Phase 2：页与形状结构 ====================

    @ToolMeta(displayName = "插入幻灯片", category = "document", fileEffect = "MODIFIED")
    @Tool("【幻灯片·写】插入一页新幻灯片。insertAfterPage 指插到第 N 页**之后**（页码 1 开始；" +
          "不传则插到末尾，插到末尾时可能连带让另一对既有页的相对顺序也换一次，不丢内容只是顺序细节）。" +
          "注意方向：这里是「插在第 N 页之后」，而 Office 任务窗格里的 office_ppt_add_slide 是" +
          "「插在第 N 页之前」——同一句「插在第 3 页」在两族里差一页，而错页不报错、" +
          "要用户自己翻页才发现，所以按页码插入前先用 slide_get_overview 核对当前页序；" +
          "title/body 可选，写在新页的标题/内容占位符；layout（版式常量）是独立参数，与 title/body " +
          "无关联，谨慎使用（多页文档上给已有页设置版式，真机实测过有清空相邻页占位符内容的风险，" +
          "改前后建议用 slide_get_overview 核对）。" + NO_REVISION_NOTE)
    public String slide_add_page(
            @P(value = "【已弃用，等价于 insertAfterPage】插到第 N 页之后，1 开始", required = false) Integer position,
            @P(value = "版式常量（可选，独立生效，与 title/body 无关；多页文档上谨慎使用，见工具说明）", required = false) Integer layout,
            @P(value = "标题文字（可选，以文本框形式写在新页顶部）", required = false) String title,
            @P(value = "正文文字（可选，以文本框形式写在新页中部）", required = false) String body,
            @P(value = "新页插到第几页**之后**（页码 1 开始）；不传则插到末尾", required = false) Integer insertAfterPage
    ) {
        Integer after = insertAfterPage != null ? insertAfterPage : position;
        log.info("Tool: slide_add_page called insertAfterPage={}, layout={}", after, layout);
        try {
            Map<String, Object> params = new HashMap<>();
            if (after != null) params.put("position", after);
            if (layout != null) params.put("layout", layout);
            if (title != null) params.put("title", title);
            if (body != null) params.put("body", body);
            return executeEditorCommand("slide_add_page", params);
        } catch (Exception e) {
            log.error("Failed to add slide page", e);
            return "Error: " + e.getMessage();
        }
    }

    @ToolMeta(displayName = "删除幻灯片", category = "document", fileEffect = "MODIFIED")
    @Tool("【幻灯片·写】删除指定页。演示文稿至少保留一页，删到只剩最后一页时会被拒绝。" + NO_REVISION_NOTE)
    public String slide_delete_page(
            @P("要删除的页码，1 开始") Integer slideNumber
    ) {
        log.info("Tool: slide_delete_page called slideNumber={}", slideNumber);
        if (slideNumber == null) {
            return "Error: 缺少 slideNumber 参数（1 开始）";
        }
        try {
            Map<String, Object> params = new HashMap<>();
            params.put("slideNumber", slideNumber);
            return executeEditorCommand("slide_delete_page", params);
        } catch (Exception e) {
            log.error("Failed to delete slide page", e);
            return "Error: " + e.getMessage();
        }
    }

    @ToolMeta(displayName = "移动幻灯片", category = "document", fileEffect = "MODIFIED")
    @Tool("【幻灯片·写】把指定页移动到新位置（重排顺序）。slideNumber 是移动前的页码，" +
          "toPosition 是目标位置，两者都是 1 开始。移到末尾时可能连带让另一对既有页的相对顺序也换一次" +
          "（不丢内容，只是顺序细节；改动大范围排序后建议用 slide_get_overview 核对最终顺序）。" +
          NO_REVISION_NOTE)
    public String slide_move_page(
            @P("要移动的页码（移动前），1 开始") Integer slideNumber,
            @P("目标位置，1 开始") Integer toPosition
    ) {
        log.info("Tool: slide_move_page called slideNumber={}, toPosition={}", slideNumber, toPosition);
        if (slideNumber == null || toPosition == null) {
            return "Error: 缺少 slideNumber 或 toPosition 参数（均 1 开始）";
        }
        try {
            Map<String, Object> params = new HashMap<>();
            params.put("slideNumber", slideNumber);
            params.put("toPosition", toPosition);
            return executeEditorCommand("slide_move_page", params);
        } catch (Exception e) {
            log.error("Failed to move slide page", e);
            return "Error: " + e.getMessage();
        }
    }

    @ToolMeta(displayName = "设置版式", category = "document", fileEffect = "MODIFIED")
    @Tool("【幻灯片·写】设置指定页的版式（layout，AutoLayout 常量）和/或母版（masterName，" +
          "按名字匹配现有母版），或 backgroundColor 设置页面纯色背景。三者至少给一个；只改背景无需传 layout。" +
          "谨慎使用 layout：真机实测过在多页文档上" +
          "设置某页版式可能连带清空共享同一母版的相邻页占位符内容，改前后建议用 slide_get_overview " +
          "核对相邻页未受影响，误改用 doc_restore_checkpoint 回滚。" + NO_REVISION_NOTE)
    public String slide_set_layout(
            @P("页码，1 开始") Integer slideNumber,
            @P(value = "版式常量（可选）", required = false) Integer layout,
            @P(value = "母版名（可选，按名字匹配演示文稿现有母版）", required = false) String masterName,
            @P(value = "页面纯色背景（可选，#RRGGBB；不改变布局或形状）", required = false) String backgroundColor
    ) {
        log.info("Tool: slide_set_layout called slideNumber={}, layout={}, masterName={}", slideNumber, layout, masterName);
        if (slideNumber == null) {
            return "Error: 缺少 slideNumber 参数（1 开始）";
        }
        if (layout == null && backgroundColor == null && (masterName == null || masterName.isBlank())) {
            return LangText.of("Error: layout、masterName 与 backgroundColor 至少给一个", "Error: Supply layout, masterName or backgroundColor");
        }
        try {
            Map<String, Object> params = new HashMap<>();
            params.put("slideNumber", slideNumber);
            if (layout != null) params.put("layout", layout);
            if (masterName != null && !masterName.isBlank()) params.put("masterName", masterName);
            if (backgroundColor != null) params.put("backgroundColor", backgroundColor);
            return executeEditorCommand("slide_set_layout", params);
        } catch (Exception e) {
            log.error("Failed to set slide layout", e);
            return "Error: " + e.getMessage();
        }
    }

    public String slide_set_layout(Integer slideNumber, Integer layout, String masterName) {
        return slide_set_layout(slideNumber, layout, masterName, null);
    }

    @ToolMeta(displayName = "插入文本框", category = "document", fileEffect = "MODIFIED")
    @Tool("【幻灯片·写】在指定页插入一个新文本框。位置尺寸单位为磅（pt），不传则用默认值" +
          "（left/top=100, width=300, height=80）。可选设置字号/加粗/颜色。" + NO_REVISION_NOTE)
    public String slide_add_text_box(
            @P("页码，1 开始") Integer slideNumber,
            @P("文本框文字") String text,
            @P(value = "左边距（磅，可选，默认 100）", required = false) Double left,
            @P(value = "上边距（磅，可选，默认 100）", required = false) Double top,
            @P(value = "宽度（磅，可选，默认 300）", required = false) Double width,
            @P(value = "高度（磅，可选，默认 80）", required = false) Double height,
            @P(value = "字号（磅，可选）", required = false) Double fontSize,
            @P(value = "是否加粗（可选）", required = false) Boolean bold,
            @P(value = "文字颜色，形如 #RRGGBB（可选）", required = false) String color
    ) {
        log.info("Tool: slide_add_text_box called slideNumber={}", slideNumber);
        if (slideNumber == null) {
            return "Error: 缺少 slideNumber 参数（1 开始）";
        }
        try {
            Map<String, Object> params = new HashMap<>();
            params.put("slideNumber", slideNumber);
            params.put("text", text != null ? text : "");
            if (left != null) params.put("left", left);
            if (top != null) params.put("top", top);
            if (width != null) params.put("width", width);
            if (height != null) params.put("height", height);
            if (fontSize != null) params.put("fontSize", fontSize);
            if (bold != null) params.put("bold", bold);
            if (color != null) params.put("color", color);
            return executeEditorCommand("slide_add_text_box", params);
        } catch (Exception e) {
            log.error("Failed to add text box", e);
            return "Error: " + e.getMessage();
        }
    }

    @ToolMeta(displayName = "插入形状", category = "document", fileEffect = "MODIFIED")
    @Tool("【幻灯片·写】在指定页插入一个几何形状：rectangle（矩形）/ ellipse（椭圆）/ " +
          "triangle（三角形）/ line（直线）。位置尺寸单位为磅（pt），不传则用默认值" +
          "（left/top=100, width=200, height=150）。可选填充色与形状内文字。" + NO_REVISION_NOTE)
    public String slide_add_shape(
            @P("页码，1 开始") Integer slideNumber,
            @P("形状类型：rectangle / ellipse / triangle / line") String shapeType,
            @P(value = "左边距（磅，可选，默认 100）", required = false) Double left,
            @P(value = "上边距（磅，可选，默认 100）", required = false) Double top,
            @P(value = "宽度（磅，可选，默认 200）", required = false) Double width,
            @P(value = "高度（磅，可选，默认 150）", required = false) Double height,
            @P(value = "形状内文字（可选）", required = false) String text,
            @P(value = "填充色，形如 #RRGGBB（可选）", required = false) String fillColor
    ) {
        log.info("Tool: slide_add_shape called slideNumber={}, shapeType={}", slideNumber, shapeType);
        if (slideNumber == null) {
            return "Error: 缺少 slideNumber 参数（1 开始）";
        }
        if (shapeType == null || shapeType.isBlank()) {
            return "Error: 缺少 shapeType 参数（rectangle/ellipse/triangle/line）";
        }
        try {
            Map<String, Object> params = new HashMap<>();
            params.put("slideNumber", slideNumber);
            params.put("shapeType", shapeType);
            if (left != null) params.put("left", left);
            if (top != null) params.put("top", top);
            if (width != null) params.put("width", width);
            if (height != null) params.put("height", height);
            if (text != null) params.put("text", text);
            if (fillColor != null) params.put("fillColor", fillColor);
            return executeEditorCommand("slide_add_shape", params);
        } catch (Exception e) {
            log.error("Failed to add shape", e);
            return "Error: " + e.getMessage();
        }
    }

    @ToolMeta(displayName = "删除形状", category = "document", fileEffect = "MODIFIED")
    @Tool("【幻灯片·写】按 shapeName 精确删除指定页的一个形状（来自 slide_get_page 返回的 shapeName）。" +
          NO_REVISION_NOTE)
    public String slide_delete_shape(
            @P("页码，1 开始") Integer slideNumber,
            @P("要删除的形状名，来自 slide_get_page 返回的 shapeName") String shapeName
    ) {
        log.info("Tool: slide_delete_shape called slideNumber={}, shapeName={}", slideNumber, shapeName);
        if (slideNumber == null) {
            return "Error: 缺少 slideNumber 参数（1 开始）";
        }
        if (shapeName == null || shapeName.isBlank()) {
            return "Error: 缺少 shapeName 参数（先用 slide_get_page 查看该页形状名）";
        }
        try {
            Map<String, Object> params = new HashMap<>();
            params.put("slideNumber", slideNumber);
            params.put("shapeName", shapeName);
            return executeEditorCommand("slide_delete_shape", params);
        } catch (Exception e) {
            log.error("Failed to delete shape", e);
            return "Error: " + e.getMessage();
        }
    }

    @ToolMeta(displayName = "调整形状位置尺寸", category = "document", fileEffect = "MODIFIED")
    @Tool("【幻灯片·写】移动和/或改变指定形状的位置尺寸（磅）。left/top/width/height 均可选，" +
          "不传的保留原值。用于逐步调整排版；返回值带 before/after 两组数值供核对实际生效结果。" +
          NO_REVISION_NOTE)
    public String slide_set_shape_geometry(
            @P("页码，1 开始") Integer slideNumber,
            @P("形状名，来自 slide_get_page 返回的 shapeName") String shapeName,
            @P(value = "左边距（磅，可选）", required = false) Double left,
            @P(value = "上边距（磅，可选）", required = false) Double top,
            @P(value = "宽度（磅，可选）", required = false) Double width,
            @P(value = "高度（磅，可选）", required = false) Double height
    ) {
        log.info("Tool: slide_set_shape_geometry called slideNumber={}, shapeName={}", slideNumber, shapeName);
        if (slideNumber == null) {
            return "Error: 缺少 slideNumber 参数（1 开始）";
        }
        if (shapeName == null || shapeName.isBlank()) {
            return "Error: 缺少 shapeName 参数（先用 slide_get_page 查看该页形状名）";
        }
        try {
            Map<String, Object> params = new HashMap<>();
            params.put("slideNumber", slideNumber);
            params.put("shapeName", shapeName);
            if (left != null) params.put("left", left);
            if (top != null) params.put("top", top);
            if (width != null) params.put("width", width);
            if (height != null) params.put("height", height);
            return executeEditorCommand("slide_set_shape_geometry", params);
        } catch (Exception e) {
            log.error("Failed to set shape geometry", e);
            return "Error: " + e.getMessage();
        }
    }

    // ==================== Phase 3：格式与表格 ====================

    @ToolMeta(displayName = "设置文字格式", category = "document", fileEffect = "MODIFIED")
    @Tool("【幻灯片·写】设置非表格形状文字的字体/字号/粗斜体/下划线/删除线/颜色/段落对齐。表格请使用 slide_table_set_style。不传 anchorText 时" +
          "格式化整个形状的文字；传了 anchorText 则只格式化形状文字里第一处包含该子串的文字。段落间距、行距、缩进作用于选中文字所在段落；单位与 Word 段落工具一致。" + NO_REVISION_NOTE)
    public String slide_format_text(
            @P("页码，1 开始") Integer slideNumber,
            @P("形状名，来自 slide_get_page 返回的 shapeName") String shapeName,
            @P(value = "可选：只格式化形状文字中包含该子串的第一处；不传则格式化整个形状文字", required = false) String anchorText,
            @P(value = "字体名（可选）", required = false) String fontName,
            @P(value = "字号，磅（可选）", required = false) Double fontSize,
            @P(value = "是否加粗（可选）", required = false) Boolean bold,
            @P(value = "是否斜体（可选）", required = false) Boolean italic,
            @P(value = "下划线样式：none/single/double/dotted/wave（可选）", required = false) String underline,
            @P(value = "是否加删除线（可选）", required = false) Boolean strikethrough,
            @P(value = "文字颜色，形如 #RRGGBB 或 auto（可选）", required = false) String color,
            @P(value = "段落对齐：left/right/center/justify（可选）", required = false) String alignment,
            @P(value = "Line spacing: single/1.5/double/multiple/proportional/atLeast/exactly", required = false) String lineSpacingMode,
            @P(value = "Line spacing value: multiple or percent for proportional; points for atLeast/exactly", required = false) Double lineSpacingValue,
            @P(value = "Space before in points; takes precedence over spaceBeforeLines", required = false) Double spaceBeforePt,
            @P(value = "Space after in points; takes precedence over spaceAfterLines", required = false) Double spaceAfterPt,
            @P(value = "Space before in lines (font size times 1.2)", required = false) Double spaceBeforeLines,
            @P(value = "Space after in lines (font size times 1.2)", required = false) Double spaceAfterLines,
            @P(value = "First line indent in points; negative for hanging indent", required = false) Double firstLineIndentPt,
            @P(value = "First line indent in characters; takes precedence over points", required = false) Double firstLineIndentChars,
            @P(value = "Left indent in points", required = false) Double leftIndentPt,
            @P(value = "Left indent in characters; takes precedence over points", required = false) Double leftIndentChars,
            @P(value = "Right indent in points; only 0 is supported because the PPTX engine cannot persist nonzero values", required = false) Double rightIndentPt
    ) {
        if (rightIndentPt != null && rightIndentPt != 0) {
            return "Error: " + LangText.of("当前 PPTX 引擎无法保存非零段落右缩进，本次未应用任何格式。请省略 rightIndentPt 或设为0",
                    "The current PPTX engine cannot persist nonzero paragraph right indents. No formatting was applied; omit rightIndentPt or set it to zero");
        }
        log.info("Tool: slide_format_text called slideNumber={}, shapeName={}", slideNumber, shapeName);
        if (slideNumber == null) {
            return "Error: 缺少 slideNumber 参数（1 开始）";
        }
        if (shapeName == null || shapeName.isBlank()) {
            return "Error: 缺少 shapeName 参数（先用 slide_get_page 查看该页形状名）";
        }
        try {
            Map<String, Object> params = new HashMap<>();
            params.put("slideNumber", slideNumber);
            params.put("shapeName", shapeName);
            if (anchorText != null && !anchorText.isEmpty()) params.put("anchorText", anchorText);
            if (fontName != null) params.put("fontName", fontName);
            if (fontSize != null) params.put("fontSize", fontSize);
            if (bold != null) params.put("bold", bold);
            if (italic != null) params.put("italic", italic);
            if (underline != null) params.put("underline", underline);
            if (strikethrough != null) params.put("strikethrough", strikethrough);
            if (color != null) params.put("color", color);
            if (alignment != null) params.put("alignment", alignment);
            if (lineSpacingMode != null) params.put("lineSpacingMode", lineSpacingMode);
            if (lineSpacingValue != null) params.put("lineSpacingValue", lineSpacingValue);
            if (spaceBeforePt != null) params.put("spaceBeforePt", spaceBeforePt);
            if (spaceAfterPt != null) params.put("spaceAfterPt", spaceAfterPt);
            if (spaceBeforeLines != null) params.put("spaceBeforeLines", spaceBeforeLines);
            if (spaceAfterLines != null) params.put("spaceAfterLines", spaceAfterLines);
            if (firstLineIndentPt != null) params.put("firstLineIndentPt", firstLineIndentPt);
            if (firstLineIndentChars != null) params.put("firstLineIndentChars", firstLineIndentChars);
            if (leftIndentPt != null) params.put("leftIndentPt", leftIndentPt);
            if (leftIndentChars != null) params.put("leftIndentChars", leftIndentChars);
            if (rightIndentPt != null) params.put("rightIndentPt", rightIndentPt);
            return executeEditorCommand("slide_format_text", params);
        } catch (Exception e) {
            log.error("Failed to format slide text", e);
            return "Error: " + e.getMessage();
        }
    }

    public String slide_format_text(Integer slideNumber, String shapeName, String anchorText,
                                    String fontName, Double fontSize, Boolean bold, Boolean italic,
                                    String underline, Boolean strikethrough, String color, String alignment) {
        return slide_format_text(slideNumber, shapeName, anchorText, fontName, fontSize, bold, italic,
                underline, strikethrough, color, alignment,
                null, null, null, null, null, null, null, null, null, null, null);
    }

    @ToolMeta(displayName = "设置形状样式", category = "document", fileEffect = "MODIFIED")
    @Tool("【幻灯片·写】设置指定形状的填充色/边框颜色与粗细/透明度。noFill/noLine 用于取消填充/边框。" +
          "参数至少给一个。" + NO_REVISION_NOTE)
    public String slide_format_shape(
            @P("页码，1 开始") Integer slideNumber,
            @P("形状名，来自 slide_get_page 返回的 shapeName") String shapeName,
            @P(value = "填充色，形如 #RRGGBB（可选）", required = false) String fillColor,
            @P(value = "取消填充（可选，true 时忽略 fillColor）", required = false) Boolean noFill,
            @P(value = "边框颜色，形如 #RRGGBB（可选）", required = false) String lineColor,
            @P(value = "取消边框（可选，true 时忽略 lineColor/lineWidthPt）", required = false) Boolean noLine,
            @P(value = "边框粗细，磅（可选）", required = false) Double lineWidthPt,
            @P(value = "填充透明度，0-100（可选，0=不透明）", required = false) Integer fillTransparency
    ) {
        log.info("Tool: slide_format_shape called slideNumber={}, shapeName={}", slideNumber, shapeName);
        if (slideNumber == null) {
            return "Error: 缺少 slideNumber 参数（1 开始）";
        }
        if (shapeName == null || shapeName.isBlank()) {
            return "Error: 缺少 shapeName 参数（先用 slide_get_page 查看该页形状名）";
        }
        try {
            Map<String, Object> params = new HashMap<>();
            params.put("slideNumber", slideNumber);
            params.put("shapeName", shapeName);
            if (fillColor != null) params.put("fillColor", fillColor);
            if (noFill != null) params.put("noFill", noFill);
            if (lineColor != null) params.put("lineColor", lineColor);
            if (noLine != null) params.put("noLine", noLine);
            if (lineWidthPt != null) params.put("lineWidthPt", lineWidthPt);
            if (fillTransparency != null) params.put("fillTransparency", fillTransparency);
            return executeEditorCommand("slide_format_shape", params);
        } catch (Exception e) {
            log.error("Failed to format shape", e);
            return "Error: " + e.getMessage();
        }
    }

    @ToolMeta(displayName = "插入表格", category = "document", fileEffect = "MODIFIED")
    @Tool("【幻灯片·写】在指定页插入一张表格。给 rowsJson（JSON 二维字符串数组，如 " +
          "[[\"项目\",\"金额\"],[\"咨询费\",\"10000\"]]）时按其内容与形状建表并写满；不给 rowsJson 时按 " +
          "rows/cols（默认各 2）建一张空表。位置尺寸单位为磅，不传则用默认值（left/top=100, width=400, height=200）。" +
          NO_REVISION_NOTE)
    public String slide_add_table(
            @P("页码，1 开始") Integer slideNumber,
            @P(value = "行数（可选，默认 2；给了 rowsJson 时以 rowsJson 行数为准）", required = false) Integer rows,
            @P(value = "列数（可选，默认 2；给了 rowsJson 时以 rowsJson 列数为准）", required = false) Integer cols,
            @P(value = "表格内容，JSON 二维字符串数组（可选，给了则按其内容建表并写满，忽略 rows/cols）", required = false) String rowsJson,
            @P(value = "左边距（磅，可选，默认 100）", required = false) Double left,
            @P(value = "上边距（磅，可选，默认 100）", required = false) Double top,
            @P(value = "宽度（磅，可选，默认 400）", required = false) Double width,
            @P(value = "高度（磅，可选，默认 200）", required = false) Double height
    ) {
        log.info("Tool: slide_add_table called slideNumber={}", slideNumber);
        if (slideNumber == null) {
            return "Error: 缺少 slideNumber 参数（1 开始）";
        }
        try {
            Map<String, Object> params = new HashMap<>();
            params.put("slideNumber", slideNumber);
            if (rowsJson != null && !rowsJson.isBlank()) {
                com.fasterxml.jackson.databind.ObjectMapper mapper = new com.fasterxml.jackson.databind.ObjectMapper();
                java.util.List<java.util.List<String>> data = mapper.readValue(
                        rowsJson, new com.fasterxml.jackson.core.type.TypeReference<java.util.List<java.util.List<String>>>() {});
                if (data.isEmpty() || data.get(0).isEmpty()) {
                    return "Error: rowsJson 不能为空表";
                }
                params.put("rowsJson", data);
            } else {
                if (rows != null) params.put("rows", rows);
                if (cols != null) params.put("cols", cols);
            }
            if (left != null) params.put("left", left);
            if (top != null) params.put("top", top);
            if (width != null) params.put("width", width);
            if (height != null) params.put("height", height);
            return executeEditorCommand("slide_add_table", params);
        } catch (com.fasterxml.jackson.core.JacksonException je) {
            return "Error: rowsJson 不是合法的 JSON 二维数组: " + je.getOriginalMessage();
        } catch (Exception e) {
            log.error("Failed to add table", e);
            return "Error: " + e.getMessage();
        }
    }

    @Tool("【幻灯片·看】把指定页一张表格形状读成二维数组（行列数 + 每格文本）。不传 shapeName 时要求该页" +
          "只有一张表格（否则报错要求指定 shapeName）；改表前建议先用本工具看清现状。row/col 均 0 开始。")
    public String slide_table_read(
            @P("页码，1 开始") Integer slideNumber,
            @P(value = "表格形状名（可选；不传则要求该页只有一张表格）", required = false) String shapeName,
            @P(value = "最多读多少行，默认 50", required = false) Integer maxRows,
            @P(value = "最多读多少列，默认 20", required = false) Integer maxCols
    ) {
        log.info("Tool: slide_table_read called slideNumber={}, shapeName={}", slideNumber, shapeName);
        if (slideNumber == null) {
            return "Error: 缺少 slideNumber 参数（1 开始）";
        }
        try {
            Map<String, Object> params = new HashMap<>();
            params.put("slideNumber", slideNumber);
            if (shapeName != null && !shapeName.isBlank()) params.put("shapeName", shapeName);
            if (maxRows != null) params.put("maxRows", maxRows);
            if (maxCols != null) params.put("maxCols", maxCols);
            return executeEditorCommand("slide_table_read", params);
        } catch (Exception e) {
            log.error("Failed to read slide table", e);
            return "Error: " + e.getMessage();
        }
    }

    @ToolMeta(displayName = "写表格单元格", category = "document", fileEffect = "MODIFIED")
    @Tool("【幻灯片·写】改指定页一张表格形状的一格文本。不传 shapeName 时要求该页只有一张表格。" +
          "row/col 均 0 开始（与 slide_table_read 的坐标一致）。" + NO_REVISION_NOTE)
    public String slide_table_set_cell(
            @P("页码，1 开始") Integer slideNumber,
            @P(value = "表格形状名（可选；不传则要求该页只有一张表格）", required = false) String shapeName,
            @P("行号，0 开始") Integer row,
            @P("列号，0 开始") Integer col,
            @P("新文本") String text
    ) {
        log.info("Tool: slide_table_set_cell called slideNumber={}, row={}, col={}", slideNumber, row, col);
        if (slideNumber == null) {
            return "Error: 缺少 slideNumber 参数（1 开始）";
        }
        if (row == null || col == null) {
            return "Error: 缺少 row 或 col 参数（均 0 开始）";
        }
        try {
            Map<String, Object> params = new HashMap<>();
            params.put("slideNumber", slideNumber);
            if (shapeName != null && !shapeName.isBlank()) params.put("shapeName", shapeName);
            params.put("row", row);
            params.put("col", col);
            params.put("text", text != null ? text : "");
            return executeEditorCommand("slide_table_set_cell", params);
        } catch (Exception e) {
            log.error("Failed to set slide table cell", e);
            return "Error: " + e.getMessage();
        }
    }

    @ToolMeta(displayName = "设置表格样式", category = "document", fileEffect = "MODIFIED")
    @Tool("【幻灯片·写】给指定页一张表格形状设置整体样式：表头（第一行）加粗、边框颜色与粗细、各列宽度。" +
          "也可用 fontName/fontSize/bold/color/fillColor/alignment 设置单元格。row/col/endRow/endCol 为0起始闭区间；不传范围作用全表，仅传row或col则限定该行或列。范围仅影响单元格格式，旧表头、边框和列宽参数保留原语义。参数至少给一个；不传 shapeName 时要求该页只有一张表格。Impress 表格的 UNO API 比 Word/Calc 有限，" +
          "边框与列宽这两项若引擎不支持会在返回值里明确说明未生效，不会假装成功。" + NO_REVISION_NOTE)
    public String slide_table_set_style(
            @P("页码，1 开始") Integer slideNumber,
            @P(value = "表格形状名（可选；不传则要求该页只有一张表格）", required = false) String shapeName,
            @P(value = "表头（第一行）是否加粗（可选）", required = false) Boolean headerBold,
            @P(value = "边框粗细，磅（可选，需与 borderColor 至少给一个生效）", required = false) Double borderWidthPt,
            @P(value = "边框颜色，形如 #RRGGBB（可选，不传默认黑色）", required = false) String borderColor,
            @P(value = "各列宽度，JSON 数字数组（磅），如 [120,80,80]（可选，按列序对应，超出实际列数的忽略）", required = false) String columnWidthsJson,
            @P(value = "First row, zero-based; omitted starts at 0", required = false) Integer row,
            @P(value = "First column, zero-based; omitted starts at 0", required = false) Integer col,
            @P(value = "Last row inclusive; defaults to row when provided, otherwise last table row", required = false) Integer endRow,
            @P(value = "Last column inclusive; defaults to col when provided, otherwise last table column", required = false) Integer endCol,
            @P(value = "Cell font name", required = false) String fontName,
            @P(value = "Cell font size in points, greater than zero", required = false) Double fontSize,
            @P(value = "Cell text bold", required = false) Boolean bold,
            @P(value = "Cell text color #RRGGBB", required = false) String color,
            @P(value = "Cell background #RRGGBB", required = false) String fillColor,
            @P(value = "Cell paragraph alignment: left/center/right/justify", required = false) String alignment,
            @P(value = "Row heights as a JSON array of positive point values, indexed from row 0; text may enforce a larger actual height", required = false) String rowHeightsJson
    ) {
        log.info("Tool: slide_table_set_style called slideNumber={}, shapeName={}", slideNumber, shapeName);
        if (slideNumber == null) {
            return "Error: 缺少 slideNumber 参数（1 开始）";
        }
        boolean hasStyleParam = headerBold != null || borderWidthPt != null || borderColor != null
                || (columnWidthsJson != null && !columnWidthsJson.isBlank())
                || (rowHeightsJson != null && !rowHeightsJson.isBlank())
                || fontName != null || fontSize != null || bold != null || color != null || fillColor != null || alignment != null;
        if (!hasStyleParam) {
            return "Error: " + LangText.of("至少提供一项表格或单元格格式参数", "Supply at least one table or cell formatting parameter");
        }
        try {
            Map<String, Object> params = new HashMap<>();
            params.put("slideNumber", slideNumber);
            if (shapeName != null && !shapeName.isBlank()) params.put("shapeName", shapeName);
            if (headerBold != null) params.put("headerBold", headerBold);
            if (borderWidthPt != null) params.put("borderWidthPt", borderWidthPt);
            if (borderColor != null) params.put("borderColor", borderColor);
            if (columnWidthsJson != null && !columnWidthsJson.isBlank()) {
                com.fasterxml.jackson.databind.ObjectMapper mapper = new com.fasterxml.jackson.databind.ObjectMapper();
                java.util.List<Double> widths = mapper.readValue(
                        columnWidthsJson, new com.fasterxml.jackson.core.type.TypeReference<java.util.List<Double>>() {});
                params.put("columnWidthsPt", widths);
            }
            if (row != null) params.put("row", row);
            if (col != null) params.put("col", col);
            if (endRow != null) params.put("endRow", endRow);
            if (endCol != null) params.put("endCol", endCol);
            if (fontName != null) params.put("fontName", fontName);
            if (fontSize != null) params.put("fontSize", fontSize);
            if (bold != null) params.put("bold", bold);
            if (color != null) params.put("color", color);
            if (fillColor != null) params.put("fillColor", fillColor);
            if (alignment != null) params.put("alignment", alignment);
            if (rowHeightsJson != null && !rowHeightsJson.isBlank()) {
                java.util.List<Double> heights = new com.fasterxml.jackson.databind.ObjectMapper().readValue(
                        rowHeightsJson, new com.fasterxml.jackson.core.type.TypeReference<java.util.List<Double>>() {});
                if (heights == null || heights.isEmpty() || heights.stream().anyMatch(h -> h == null || !Double.isFinite(h) || h <= 0))
                    return "Error: " + LangText.of("行高须为非空的正数数组（磅）", "Row heights must be a nonempty array of positive point values");
                params.put("rowHeightsPt", heights);
            }
            return executeEditorCommand("slide_table_set_style", params);
        } catch (com.fasterxml.jackson.core.JacksonException je) {
            return "Error: " + LangText.of("行高或列宽不是合法的 JSON 数字数组", "Row heights or column widths are not a valid JSON numeric array");
        } catch (Exception e) {
            log.error("Failed to set slide table style", e);
            return "Error: " + e.getMessage();
        }
    }

    public String slide_table_set_style(Integer slideNumber, String shapeName, Boolean headerBold,
                                        Double borderWidthPt, String borderColor, String columnWidthsJson) {
        return slide_table_set_style(slideNumber, shapeName, headerBold, borderWidthPt, borderColor,
                columnWidthsJson, null, null, null, null, null, null, null, null, null, null);
    }

    public String slide_table_set_style(Integer slideNumber, String shapeName, Boolean headerBold,
            Double borderWidthPt, String borderColor, String columnWidthsJson,
            Integer row, Integer col, Integer endRow, Integer endCol, String fontName,
            Double fontSize, Boolean bold, String color, String fillColor, String alignment) {
        return slide_table_set_style(slideNumber, shapeName, headerBold, borderWidthPt, borderColor,
                columnWidthsJson, row, col, endRow, endCol, fontName, fontSize, bold, color, fillColor, alignment, null);
    }

    @ToolMeta(displayName = "设置超链接", category = "document", fileEffect = "MODIFIED")
    @Tool("【幻灯片·写】在指定页查找文字并给它加超链接（跳转到网页，不支持表格单元格内文字）。" +
          "searchText 只在该页非表格形状的文字里查找，命中第一处即生效。url 仅支持 http/https。" +
          "优先只对命中的文字生效（精确到字符）；引擎不支持字符级超链接时会自动退化为整个形状可点" +
          "（点哪里都跳转），返回值 via 字段区分两种情形，退化时 note 字段会说明。" + NO_REVISION_NOTE)
    public String slide_set_hyperlink(
            @P("页码，1 开始") Integer slideNumber,
            @P("要加超链接的文字") String searchText,
            @P("链接地址，仅支持 http/https") String url
    ) {
        log.info("Tool: slide_set_hyperlink called slideNumber={}, searchText={}", slideNumber, searchText);
        if (slideNumber == null) {
            return "Error: 缺少 slideNumber 参数（1 开始）";
        }
        if (searchText == null || searchText.isEmpty()) {
            return "Error: 缺少 searchText 参数";
        }
        if (url == null || url.isBlank()) {
            return "Error: 缺少 url 参数";
        }
        try {
            Map<String, Object> params = new HashMap<>();
            params.put("slideNumber", slideNumber);
            params.put("searchText", searchText);
            params.put("url", url);
            return executeEditorCommand("slide_set_hyperlink", params);
        } catch (Exception e) {
            log.error("Failed to set slide hyperlink", e);
            return "Error: " + e.getMessage();
        }
    }
}
