package com.checkba.service.ai.tools;

import com.checkba.model.entity.ProjectFile;
import com.checkba.repository.ProjectFileRepository;
import com.checkba.service.ProjectFileService;
import com.checkba.service.ai.SseEmitterService;
import com.checkba.service.ai.WpsActionService;
import dev.langchain4j.agent.tool.P;
import dev.langchain4j.agent.tool.Tool;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.stream.Collectors;

/**
 * WPS 文档操作工具集
 * 
 * 提供 Agent 操作 WPS 文档的能力：
 * 1. 列出项目文档
 * 2. 打开文档进行编辑
 * 3. 获取选区、查找替换、段落操作等
 * 4. 搜索相关文档
 * 
 * 技术说明：
 * - wps_open_file 和 wps_list_project_files 可以直接在后端完成
 * - 其他操作需要通过 SSE client_action 发送到前端执行，然后等待结果返回
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class WpsTools {

    private final ProjectFileService projectFileService;
    private final ProjectFileRepository projectFileRepository;
    private final WpsActionService wpsActionService;

    // ==================== 文件管理工具 ====================

    @Tool("列出项目中的所有可编辑文档文件（docx, doc, xlsx, xls, pptx, ppt）。返回文件ID、名称和类型的列表。")
    public String wps_list_project_files(
            @P("项目ID") Long projectId
    ) {
        log.info("Tool: wps_list_project_files called for projectId={}", projectId);
        try {
            List<ProjectFile> files = projectFileRepository.findByProjectIdOrderBySortOrderAsc(projectId);
            
            // 过滤出可编辑的文档文件
            List<ProjectFile> editableFiles = files.stream()
                    .filter(f -> !Boolean.TRUE.equals(f.getIsFolder()))
                    .filter(f -> isEditableDocument(f.getName()))
                    .collect(Collectors.toList());
            
            if (editableFiles.isEmpty()) {
                return "项目中没有可编辑的文档文件。";
            }
            
            StringBuilder sb = new StringBuilder("项目文档列表 (共 " + editableFiles.size() + " 个):\n");
            for (ProjectFile f : editableFiles) {
                sb.append(String.format("- ID: %d, 名称: %s, 类型: %s\n", 
                        f.getId(), f.getName(), f.getFileType()));
            }
            return sb.toString();
            
        } catch (Exception e) {
            log.error("Failed to list project files", e);
            return "Error: " + e.getMessage();
        }
    }

    @Tool("打开指定文档进行编辑。文档会在用户的 WPS 编辑器中打开，之后可以使用其他 WPS 工具进行操作。")
    public String wps_open_file(
            @P("文件ID（从 wps_list_project_files 获取）") Long fileId
    ) {
        log.info("Tool: wps_open_file called for fileId={}", fileId);
        try {
            ProjectFile file = projectFileService.getFile(fileId);
            if (file == null) {
                return "Error: 文件不存在，ID=" + fileId;
            }
            
            if (!isEditableDocument(file.getName())) {
                return "Error: 该文件不是可编辑的文档格式: " + file.getName();
            }
            
            // 通过 SSE 发送打开文件指令到前端
            wpsActionService.sendOpenFileAction(file);
            
            return String.format("已发送打开文件指令。文件名: %s, 类型: %s。请等待文档加载完成后再进行后续操作。", 
                    file.getName(), file.getFileType());
            
        } catch (Exception e) {
            log.error("Failed to open file", e);
            return "Error: " + e.getMessage();
        }
    }

    // ==================== 选区和光标操作 ====================

    @Tool("获取 WPS 文档中当前选区的文本内容和位置信息。用于了解用户当前光标位置和选中的文本。")
    public String wps_get_selection() {
        log.info("Tool: wps_get_selection called");
        try {
            return wpsActionService.executeWpsCommand("get_selection", null);
        } catch (Exception e) {
            log.error("Failed to get selection", e);
            return "Error: " + e.getMessage();
        }
    }

    @Tool("移动 WPS 文档的光标到指定位置。")
    public String wps_goto(
            @P("定位类型: paragraph(段落)/bookmark(书签)/start(文档开头)/end(文档结尾)/line(行号)") String type,
            @P("目标值: 段落号、书签名、行号等。对于 start/end 类型可以为空。") String target
    ) {
        log.info("Tool: wps_goto called type={}, target={}", type, target);
        try {
            return wpsActionService.executeWpsCommand("goto", 
                    java.util.Map.of("type", type, "target", target != null ? target : ""));
        } catch (Exception e) {
            log.error("Failed to goto position", e);
            return "Error: " + e.getMessage();
        }
    }

    @Tool("设置 WPS 文档的选区范围（精确控制光标/选区）。Start 和 End 是字符索引位置。")
    public String wps_set_selection(
            @P("选区开始位置 (0-based 字符索引)") Integer start,
            @P("选区结束位置 (0-based 字符索引)") Integer end
    ) {
        log.info("Tool: wps_set_selection called start={}, end={}", start, end);
        try {
            return wpsActionService.executeWpsCommand("set_selection", 
                    java.util.Map.of("start", start, "end", end));
        } catch (Exception e) {
            log.error("Failed to set selection", e);
            return "Error: " + e.getMessage();
        }
    }

    // ==================== 查找和替换 ====================

    @Tool("在 WPS 文档中查找指定文本，返回所有匹配位置的列表（start, end）。建议配合 wps_set_selection 使用。")
    public String wps_find_text(
            @P("要查找的文本") String keyword,
            @P("是否区分大小写，默认 false") Boolean matchCase
    ) {
        log.info("Tool: wps_find_text called keyword={}", keyword);
        try {
            // Updated to call 'find_text_locations' which returns detailed positions
            return wpsActionService.executeWpsCommand("find_text_locations", 
                    java.util.Map.of("keyword", keyword, "matchCase", matchCase != null ? matchCase : false));
        } catch (Exception e) {
            log.error("Failed to find text", e);
            return "Error: " + e.getMessage();
        }
    }

    @Tool("在 WPS 文档中查找并替换文本。所有修改将以修订模式进行，用户可以审阅后接受或拒绝。")
    public String wps_find_replace(
            @P("要查找的文本") String findText,
            @P("替换为的文本") String replaceText,
            @P("是否替换全部匹配项，默认 true") Boolean replaceAll
    ) {
        log.info("Tool: wps_find_replace called find={}, replace={}", findText, replaceText);
        try {
            return wpsActionService.executeWpsCommand("find_replace", 
                    java.util.Map.of(
                            "findText", findText, 
                            "replaceText", replaceText, 
                            "replaceAll", replaceAll != null ? replaceAll : true
                    ));
        } catch (Exception e) {
            log.error("Failed to find and replace", e);
            return "Error: " + e.getMessage();
        }
    }

    @Tool("将文档中第 N 个可见匹配项替换为新文本。" +
          "索引从 1 开始，只计算用户可见的匹配（排除修订模式下被删除的内容）。" +
          "如果要删除文本，将 replaceText 设置为空字符串即可。")
    public String wps_replace_nth_match(
            @P("要查找的文本") String findText,
            @P("替换为的文本") String replaceText,
            @P("第几个可见匹配（从 1 开始）") Integer matchIndex
    ) {
        log.info("Tool: wps_replace_nth_match called find={}, replace={}, index={}", findText, replaceText, matchIndex);
        try {
            if (matchIndex == null || matchIndex < 1) {
                return "Error: matchIndex 必须是从 1 开始的正整数";
            }
            return wpsActionService.executeWpsCommand("replace_nth_match", 
                    java.util.Map.of(
                            "findText", findText, 
                            "replaceText", replaceText, 
                            "matchIndex", matchIndex
                    ));
        } catch (Exception e) {
            log.error("Failed to replace nth match", e);
            return "Error: " + e.getMessage();
        }
    }

    @Tool("删除 WPS 文档中第 N 个可见的匹配文本。专门用于删除操作，通过查找文本并执行删除。")
    public String wps_delete_match(
            @P("要删除的文本内容") String findText,
            @P("第几个可见匹配（从 1 开始）") Integer matchIndex
    ) {
        log.info("Tool: wps_delete_match called find={}, index={}", findText, matchIndex);
        try {
            if (matchIndex == null || matchIndex < 1) {
                return "Error: matchIndex 必须是从 1 开始的正整数";
            }
            return wpsActionService.executeWpsCommand("delete_match", 
                    java.util.Map.of(
                            "findText", findText, 
                            "matchIndex", matchIndex
                    ));
        } catch (Exception e) {
            log.error("Failed to delete match", e);
            return "Error: " + e.getMessage();
        }
    }

    @Tool("删除 WPS 文档中的文本内容。可以删除所有匹配项，或只删除第一个匹配项。")
    public String wps_delete_text(
            @P("要删除的文本内容") String text,
            @P("是否删除所有匹配项，默认 true") Boolean deleteAll
    ) {
        log.info("Tool: wps_delete_text called text={}, all={}", text, deleteAll);
        try {
            return wpsActionService.executeWpsCommand("delete_text", 
                    java.util.Map.of(
                            "text", text, 
                            "deleteAll", deleteAll != null ? deleteAll : true
                    ));
        } catch (Exception e) {
            log.error("Failed to delete text", e);
            return "Error: " + e.getMessage();
        }
    }

    @Tool("替换当前选区（或光标位置）的文本内容。如果选区非空，则替换选区；如果只是光标，则插入文本。")
    public String wps_replace_selection(
            @P("用于替换的文本内容") String text
    ) {
        log.info("Tool: wps_replace_selection called text length={}", text.length());
        try {
            return wpsActionService.executeWpsCommand("replace_selection", 
                    java.util.Map.of("text", text));
        } catch (Exception e) {
            log.error("Failed to replace selection", e);
            return "Error: " + e.getMessage();
        }
    }

    // ==================== 插入和修改 ====================

    @Tool("在 WPS 文档的当前光标位置插入文本内容。修改将以修订模式进行。")
    public String wps_insert_at_cursor(
            @P("要插入的文本内容") String text
    ) {
        log.info("Tool: wps_insert_at_cursor called, text length={}", text.length());
        try {
            return wpsActionService.executeWpsCommand("insert_at_cursor", 
                    java.util.Map.of("text", text));
        } catch (Exception e) {
            log.error("Failed to insert at cursor", e);
            return "Error: " + e.getMessage();
        }
    }

    @Tool("获取 WPS 文档中指定段落的文本内容。")
    public String wps_get_paragraph(
            @P("段落索引，从 1 开始") Integer paragraphIndex
    ) {
        log.info("Tool: wps_get_paragraph called index={}", paragraphIndex);
        try {
            return wpsActionService.executeWpsCommand("get_paragraph", 
                    java.util.Map.of("index", paragraphIndex));
        } catch (Exception e) {
            log.error("Failed to get paragraph", e);
            return "Error: " + e.getMessage();
        }
    }

    @Tool("修改 WPS 文档中指定段落的文本内容。修改将以修订模式进行，用户可以审阅后接受或拒绝。")
    public String wps_modify_paragraph(
            @P("段落索引，从 1 开始") Integer paragraphIndex,
            @P("新的段落文本") String newText
    ) {
        log.info("Tool: wps_modify_paragraph called index={}, new text length={}", paragraphIndex, newText.length());
        try {
            return wpsActionService.executeWpsCommand("modify_paragraph", 
                    java.util.Map.of("index", paragraphIndex, "newText", newText));
        } catch (Exception e) {
            log.error("Failed to modify paragraph", e);
            return "Error: " + e.getMessage();
        }
    }

    // ==================== 文档结构 ====================

    @Tool("获取 WPS 文档的大纲结构，包括各级标题及其位置。")
    public String wps_get_outline() {
        log.info("Tool: wps_get_outline called");
        try {
            return wpsActionService.executeWpsCommand("get_outline", null);
        } catch (Exception e) {
            log.error("Failed to get outline", e);
            return "Error: " + e.getMessage();
        }
    }

    @Tool("在 WPS 文档的指定标题下方插入新内容。修改将以修订模式进行。")
    public String wps_insert_under_heading(
            @P("标题文本，用于定位插入位置") String headingText,
            @P("要插入的内容") String content
    ) {
        log.info("Tool: wps_insert_under_heading called heading={}", headingText);
        try {
            return wpsActionService.executeWpsCommand("insert_under_heading", 
                    java.util.Map.of("headingText", headingText, "content", content));
        } catch (Exception e) {
            log.error("Failed to insert under heading", e);
            return "Error: " + e.getMessage();
        }
    }

    // ==================== 智能搜索 ====================

    @Tool("搜索项目中可能需要修改的相关文档。根据关键词在文件名和文档内容中搜索。")
    public String wps_search_related_docs(
            @P("搜索关键词，如'交易方案'、'股东决议'等") String keyword,
            @P("项目ID") Long projectId
    ) {
        log.info("Tool: wps_search_related_docs called keyword={}, projectId={}", keyword, projectId);
        try {
            List<ProjectFile> allFiles = projectFileRepository.findByProjectIdOrderBySortOrderAsc(projectId);
            
            // 1. 首先按文件名匹配
            List<ProjectFile> matchedByName = allFiles.stream()
                    .filter(f -> !Boolean.TRUE.equals(f.getIsFolder()))
                    .filter(f -> isEditableDocument(f.getName()))
                    .filter(f -> f.getName().contains(keyword))
                    .collect(Collectors.toList());
            
            // 2. 如果文件名匹配不够，可以考虑内容搜索（使用 RAG 服务）
            // TODO: 集成 ProjectRagService 进行内容搜索
            
            if (matchedByName.isEmpty()) {
                // 返回所有可编辑文档供参考
                List<ProjectFile> editableFiles = allFiles.stream()
                        .filter(f -> !Boolean.TRUE.equals(f.getIsFolder()))
                        .filter(f -> isEditableDocument(f.getName()))
                        .limit(10)
                        .collect(Collectors.toList());
                
                if (editableFiles.isEmpty()) {
                    return "未找到包含关键词'" + keyword + "'的文档，项目中也没有其他可编辑文档。";
                }
                
                StringBuilder sb = new StringBuilder("未找到包含关键词'" + keyword + "'的文档。以下是项目中的可编辑文档供参考:\n");
                for (ProjectFile f : editableFiles) {
                    sb.append(String.format("- ID: %d, 名称: %s\n", f.getId(), f.getName()));
                }
                return sb.toString();
            }
            
            StringBuilder sb = new StringBuilder("找到 " + matchedByName.size() + " 个可能相关的文档:\n");
            for (ProjectFile f : matchedByName) {
                sb.append(String.format("- ID: %d, 名称: %s, 类型: %s\n", 
                        f.getId(), f.getName(), f.getFileType()));
            }
            sb.append("\n建议：使用 wps_open_file 打开需要修改的文档，然后使用其他 WPS 工具进行编辑。");
            return sb.toString();
            
        } catch (Exception e) {
            log.error("Failed to search related docs", e);
            return "Error: " + e.getMessage();
        }
    }

    // ==================== 辅助方法 ====================

    /**
     * 判断文件是否是可编辑的文档格式
     */
    private boolean isEditableDocument(String fileName) {
        if (fileName == null) return false;
        String lower = fileName.toLowerCase();
        return lower.endsWith(".docx") || lower.endsWith(".doc") 
                || lower.endsWith(".xlsx") || lower.endsWith(".xls")
                || lower.endsWith(".pptx") || lower.endsWith(".ppt");
    }
}

