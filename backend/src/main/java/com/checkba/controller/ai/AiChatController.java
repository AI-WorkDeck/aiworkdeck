package com.checkba.controller.ai;

import com.checkba.controller.AuthController;
import com.checkba.service.ProjectAiMessageService;
import com.checkba.service.UserService;
import com.checkba.service.ai.AiDocxExportService;
import com.checkba.service.ai.ProjectAssistant;
import com.checkba.service.ai.context.ProjectContextHolder;
import lombok.Data;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.util.StringUtils;

@Slf4j
@RestController
@RequestMapping("/api/ai")
@RequiredArgsConstructor
public class AiChatController {

    private final ProjectAssistant projectAssistant;
    private final ProjectAiMessageService projectAiMessageService;
    private final AiDocxExportService aiDocxExportService;
    private final UserService userService;

    @PostMapping("/chat")
    public AiChatResponse chat(@RequestBody AiChatRequest request) {
        log.info("Received AI chat request for project {}: {}", request.getProjectId(), request.getMessage());
        try {
            ProjectContextHolder.setProjectId(request.getProjectId());
            String payload = buildPromptWithContext(request);
            String response = projectAssistant.chat(payload);
            // 记录对话历史（预留会话管理能力）
            try {
                projectAiMessageService.saveUserAndAssistantMessage(
                        request.getProjectId(),
                        request.getMessage(),
                        response
                );
            } catch (Exception logEx) {
                log.warn("Failed to save AI chat history for project {}", request.getProjectId(), logEx);
            }
            return new AiChatResponse(response);
        } catch (Exception e) {
            log.error("Error during AI chat", e);
            return new AiChatResponse("Sorry, I encountered an error: " + e.getMessage());
        } finally {
            ProjectContextHolder.clear();
        }
    }
    private static final int MAX_CONTEXT_CHARS = 6000;

    private String buildPromptWithContext(AiChatRequest request) {
        AiChatContext ctx = request.getContext();
        if (ctx == null) {
            return request.getMessage();
        }
        StringBuilder builder = new StringBuilder();
        builder.append("当前激活文件：")
                .append(StringUtils.hasText(ctx.getFileName()) ? ctx.getFileName() : "未命名文件");
        if (StringUtils.hasText(ctx.getFileType())) {
            builder.append(" (").append(ctx.getFileType()).append(")");
        }
        builder.append("。\n");

        String selection = safeContextBlock(ctx.getSelectionText(), 1500);
        if (StringUtils.hasText(selection)) {
            builder.append("选区内容:\n```\n")
                    .append(selection)
                    .append("\n```\n");
        }
        String document = safeContextBlock(ctx.getDocumentText(), MAX_CONTEXT_CHARS);
        if (StringUtils.hasText(document)) {
            builder.append("正文摘要:\n```\n")
                    .append(document)
                    .append("\n```\n");
        }
        builder.append("请基于以上内容回答或修改，并保持原项目语气。")
                .append("\n用户请求:\n")
                .append(request.getMessage());
        return builder.toString();
    }

    private String safeContextBlock(String raw, int maxLen) {
        if (!StringUtils.hasText(raw)) {
            return "";
        }
        String cleaned = raw.trim();
        if (cleaned.length() <= maxLen) {
            return cleaned;
        }
        return cleaned.substring(0, maxLen) + "\n...[上下文截断 " + (cleaned.length() - maxLen) + " 字]";
    }

    /**
     * AI 导出 Word：后端根据 markdown 文本生成 docx 并注册为项目文件。
     */
    @PostMapping("/export-docx")
    public ResponseEntity<?> exportDocx(@RequestBody AiExportDocxRequest request,
                                        @RequestHeader(value = "X-Session-Id", required = false) String sessionId) {
        try {
            Long userId = AuthController.getUserIdFromSession(sessionId);
            if (userId == null) {
                return ResponseEntity.status(401).body("请先登录");
            }
            Long projectId = request.getProjectId();
            if (projectId == null) {
                return ResponseEntity.badRequest().body("项目 ID 不能为空");
            }
            String fileName = request.getFileName();
            if (fileName == null || fileName.trim().isEmpty()) {
                return ResponseEntity.badRequest().body("文件名不能为空");
            }

            // 如果没有 .docx 后缀，自动补上
            if (!fileName.toLowerCase().endsWith(".docx")) {
                fileName = fileName + ".docx";
            }

            String markdown = request.getMarkdown() != null ? request.getMarkdown() : request.getContent();

            var file = aiDocxExportService.exportMarkdownToDocx(
                    projectId,
                    request.getParentId(),
                    userId,
                    fileName,
                    markdown
            );

            return ResponseEntity.ok(file);
        } catch (Exception e) {
            log.error("AI 导出 Word 失败", e);
            return ResponseEntity.status(500).body("导出 Word 失败: " + e.getMessage());
        }
    }
    
    @Data
    public static class AiChatRequest {
        private String projectId;
        private String message;
        private AiChatContext context;
    }
    
    @Data
    public static class AiChatResponse {
        private String response;
        public AiChatResponse(String response) { this.response = response; }
    }

    @Data
    public static class AiChatContext {
        private String fileId;
        private String fileName;
        private String fileType;
        private String wpsFileId;
        private String selectionText;
        private String documentText;
    }

    @Data
    public static class AiExportDocxRequest {
        private Long projectId;
        private Long parentId;
        private String fileName;
        /**
         * 文本内容（优先 markdown）
         */
        private String markdown;
        /**
         * 兼容字段：如果前端还没改成 markdown，可以传 content
         */
        private String content;
    }
}
