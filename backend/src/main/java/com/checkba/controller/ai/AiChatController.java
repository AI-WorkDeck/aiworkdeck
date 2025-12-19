package com.checkba.controller.ai;

import com.checkba.config.AiModelProperties;
import com.checkba.controller.AuthController;
import com.checkba.service.ProjectAiMessageService;
import com.checkba.service.SystemSettingService;
import com.checkba.service.UserService;
import com.checkba.service.ai.AiDocxExportService;
import com.checkba.service.ai.DynamicContentRetriever;
import com.checkba.service.ai.GeminiChatLanguageModel;
import com.checkba.service.ai.ProjectAssistant;
import com.checkba.service.ai.context.ProjectContextHolder;
import com.checkba.service.ai.tools.FileTools;
import dev.langchain4j.model.chat.ChatLanguageModel;
import dev.langchain4j.service.AiServices;
import lombok.Data;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.util.StringUtils;

import java.util.Map;
import java.util.List;
import java.util.concurrent.ConcurrentHashMap;
import cn.hutool.json.JSONObject;
import cn.hutool.json.JSONArray;

@Slf4j
@RestController
@RequestMapping("/api/ai")

public class AiChatController {

    private final ProjectAssistant defaultProjectAssistant;
    private final ProjectAiMessageService projectAiMessageService;
    private final AiDocxExportService aiDocxExportService;
    private final UserService userService;
    private final AiModelProperties aiModelProperties;
    private final DynamicContentRetriever dynamicContentRetriever;
    private final FileTools fileTools;
    private final SystemSettingService systemSettingService;
    private final com.checkba.service.ai.MediaProcessingService mediaProcessingService;
    private final com.checkba.service.ProjectFileService projectFileService;

    private final com.fasterxml.jackson.databind.ObjectMapper objectMapper;
    private static final String KEY_AI_ASSISTANTS = "ai.assistants";
    
    // Cache for Gemini Cache IDs: Map<ContentHash, CacheName>
    // Simple in-memory cache to avoid re-uploading same content in short term. Ttl is handled by Gemini.
    private final Map<String, String> activeGeminiCaches = new ConcurrentHashMap<>();

    private final Map<String, ProjectAssistant> assistantCache = new ConcurrentHashMap<>();
    


    public AiChatController(
            ProjectAssistant defaultProjectAssistant,
            ProjectAiMessageService projectAiMessageService,
            AiDocxExportService aiDocxExportService,
            UserService userService,
            AiModelProperties aiModelProperties,
            DynamicContentRetriever dynamicContentRetriever,
            FileTools fileTools,
            SystemSettingService systemSettingService,
            com.checkba.service.ai.MediaProcessingService mediaProcessingService,
            com.checkba.service.ProjectFileService projectFileService,
            com.fasterxml.jackson.databind.ObjectMapper objectMapper) {
        this.defaultProjectAssistant = defaultProjectAssistant;
        this.projectAiMessageService = projectAiMessageService;
        this.aiDocxExportService = aiDocxExportService;
        this.userService = userService;
        this.aiModelProperties = aiModelProperties;
        this.dynamicContentRetriever = dynamicContentRetriever;
        this.fileTools = fileTools;
        this.systemSettingService = systemSettingService;
        this.mediaProcessingService = mediaProcessingService;
        this.projectFileService = projectFileService;
        this.objectMapper = objectMapper;
    }

    @PostMapping("/chat")
    public AiChatResponse chat(@RequestBody AiChatRequest request, @RequestHeader(value = "X-Session-Id", required = false) String sessionId) {
        log.info("Received AI chat request for project {}: {} (model={})", request.getProjectId(), request.getMessage(), request.getModel());
        try {
            ProjectContextHolder.setProjectId(request.getProjectId());

            // Get User ID
            Long userId = null;
            if (sessionId != null) {
                userId = AuthController.getUserIdFromSession(sessionId);
            }
            
            // 0. Handle Conversation ID
            String conversationId = request.getConversationId();
            if (!StringUtils.hasText(conversationId)) {
                conversationId = java.util.UUID.randomUUID().toString();
            }

            // 1. Get Assistant Config
            // 1. Get Assistant Config
            String assistantId = StringUtils.hasText(request.getAssistantId()) ? request.getAssistantId() : "default";
            
            // Dynamic Load
            Map<String, com.checkba.model.ai.AiAssistantConfig> currentAssistants = loadAssistants();
            com.checkba.model.ai.AiAssistantConfig assistantConfig = currentAssistants.get(assistantId);
            
            if (assistantConfig == null && "default".equals(assistantId)) {
                // Should not happen if DB is empty? Wait, user said "don't fallback".
                // So if DB is empty, currentAssistants is empty, default is null.
                // We must handle null config gracefully or throw error?
                // "don't fallback or I won't know" -> throw error or handle as specific "System Default"? 
                // Using a hardcoded fall-through minimal default just to prevent NPE if user hasn't config'd yet?
                // The prompt logic handles null assistantConfig, so let's allow it to be null if not found.
            }
            
            
            // 2. Define Model Key and Initial Final Prompt
            String modelKey = (request.getModel() != null ? request.getModel() : "default").toLowerCase();
            String finalPrompt;
            
            // Logic: Skip context validation for Gemini as requested by user ("Gemini doesnt support context")
            // Only Ollama/Local models get the full context injection.
            if (modelKey.contains("gemini") || modelKey.contains("google")) {
                 // Gemini: Just use the message (plus system prompt from assistant config if needed, but buildPromptWithContext adds system prompt too)
                 // We should probably still use buildPromptWithContext but mocked context or null context?
                 // Or just modify buildPromptWithContext to respect flag?
                 // Let's manually construct prompt without context for Gemini.
                 
                 // However, we still might want System Prompt (role). 
                 // The buildPromptWithContext does: System Prompt + Context + User Message.
                 // We want: System Prompt + User Message.
                 AiChatContext emptyContext = null;
                 finalPrompt = buildPromptWithContext(request, assistantConfig, true); // Enabled context for Gemini standard files
            } else {
                 finalPrompt = buildPromptWithContext(request, assistantConfig, true);
            }

            // 3. Get LLM Service
            ProjectAssistant assistant = getAssistant(request.getModel(), assistantConfig);
            String response = "";

            // Handle Multi-Modal Context (Image/Video) or Native PDF for Gemini
            // For now, only handle FIRST valid multi-modal context if multiple are present? 
            // Or iterate. Let's simplify: if any context is image/video/pdf(gemini), we use the FIRST one found for multi-modal chat.
            // Supporting multiple images is possible if we iterate.
            
            java.util.List<AiChatContext> contexts = request.getContexts();
            if (contexts == null) {
                contexts = new java.util.ArrayList<>();
                if (request.getContext() != null) contexts.add(request.getContext());
            }

            boolean handledAsMultiModal = false;
            boolean isGemini = modelKey.contains("gemini") || modelKey.contains("google");
            
            // Check for Native PDF (Gemini) or Images
            // Basic strategy: Collect all images/pdfs and send in one message if supported.
            // langchain4j UserMessage supports multiple Content items.
            
            java.util.List<dev.langchain4j.data.message.Content> multiModalContents = new java.util.ArrayList<>();
            // Always add text prompt first
            multiModalContents.add(dev.langchain4j.data.message.TextContent.from(finalPrompt));
            
            boolean hasMedia = false;
            
            for (AiChatContext ctx : contexts) {
                if (ctx == null) continue;
                String fType = ctx.getFileType() != null ? ctx.getFileType().toLowerCase() : "";
                
                // 1. Native PDF (Gemini)
                if (isGemini && (fType.equals("pdf") || fType.endsWith("pdf"))) {
                     try {
                          Long fId = Long.parseLong(ctx.getFileId());
                          byte[] fileBytes = projectFileService.getFileBytes(fId);
                          if (fileBytes != null && fileBytes.length > 0) {
                               String base64 = java.util.Base64.getEncoder().encodeToString(fileBytes);
                               multiModalContents.add(dev.langchain4j.data.message.ImageContent.from(base64, "application/pdf"));
                               hasMedia = true;
                          }
                     } catch (Exception e) {
                          log.warn("Failed to attach PDF for Gemini", e);
                     }
                }
                
                // 2. Images / Video
                boolean isImage = fType.matches("jpg|jpeg|png|gif|bmp|webp") || (fType.equals("image"));
                boolean isVideo = fType.matches("mp4|mov|avi|mkv") || (fType.equals("video"));
                
                if (isImage || isVideo) {
                    try {
                        Long fileId = Long.parseLong(ctx.getFileId());
                        com.checkba.model.entity.ProjectFile fileEntity = projectFileService.getFile(fileId);
                        if (fileEntity != null && StringUtils.hasText(fileEntity.getFilePath())) {
                            java.io.File physicalFile = new java.io.File(fileEntity.getFilePath());
                            java.util.List<String> images = new java.util.ArrayList<>();
                            
                            if (isImage) {
                                byte[] bytes = java.nio.file.Files.readAllBytes(physicalFile.toPath());
                                images.add(java.util.Base64.getEncoder().encodeToString(bytes));
                            } else if (isVideo) {
                                images = mediaProcessingService.extractKeyframes(physicalFile, 5); 
                            }

                            for (String base64 : images) {
                                String mimeType = isImage ? "image/" + fType.replace("jpg", "jpeg") : "image/jpeg";
                                if (mimeType.equals("image/image")) mimeType = "image/jpeg";
                                multiModalContents.add(dev.langchain4j.data.message.ImageContent.from(base64, mimeType));
                                hasMedia = true;
                            }
                        }
                    } catch (Exception e) {
                        log.warn("Failed to process media content", e);
                    }
                }
            }
            
            if (hasMedia) {
                 dev.langchain4j.data.message.UserMessage userMessage = dev.langchain4j.data.message.UserMessage.from(multiModalContents);
                 response = assistant.chat(userMessage);
                 handledAsMultiModal = true;
            } else {
                 // Text Only
                 response = assistant.chat(finalPrompt);
            }
             
            // Skip the old logic blocks below since we handled it above
            boolean legacySkip = true; 
            if (!legacySkip) {

            }
            
            // 4. Record History
            try {
                projectAiMessageService.saveUserAndAssistantMessage(
                        request.getProjectId(),
                        userId,
                        conversationId, // Pass conversationId
                        request.getMessage(), 
                        response
                );
            } catch (Exception logEx) {
                log.warn("Failed to save AI chat history for project {}", request.getProjectId(), logEx);
            }
            // 6. Response
            return new AiChatResponse(response, conversationId);
            
        } catch (Exception e) {
            log.error("Error during AI chat", e);
            return new AiChatResponse("Sorry, I encountered an error: " + e.getMessage(), request.getConversationId());
        } finally {
            ProjectContextHolder.clear();
        }
    }

    @GetMapping("/history")
    public java.util.List<com.checkba.model.entity.ProjectAiMessage> getChatHistory(
            @RequestParam(required = false) Long projectId, 
            @RequestParam(required = false) String conversationId,
            @RequestHeader(value = "X-Session-Id", required = false) String sessionId) {
        
        // If conversationId is provided, return specific messages
        if (StringUtils.hasText(conversationId)) {
             return projectAiMessageService.listByConversationId(conversationId);
        }
        
        // Fallback (or deprecated): List all messages for project/user if conversationId is missing
        // This keeps backward compatibility for now, or returns empty list if we want to enforce sessions.
        Long userId = null;
        if (sessionId != null) {
            userId = AuthController.getUserIdFromSession(sessionId);
        }
        if (projectId != null) {
             return projectAiMessageService.listByProjectAndUser(projectId, userId);
        }
        return java.util.Collections.emptyList();
    }
    
    // --- Helper Methods for Folder Context & Caching ---
    
    private String collectFolderContent(Long projectId, Long folderId) {
        StringBuilder sb = new StringBuilder();
        // Uses ProjectFileService to recursion.
        // Since ProjectFileService.getFilesByParent only returns direct children, we need recursion helper here.
        collectFilesRecursive(projectId, folderId, sb, 0);
        return sb.toString();
    }
    
    private void collectFilesRecursive(Long projectId, Long parentId, StringBuilder sb, int depth) {
        if (depth > 20) return; // safety
        List<com.checkba.model.entity.ProjectFile> children = projectFileService.getFilesByParent(projectId, parentId);
        for (com.checkba.model.entity.ProjectFile file : children) {
            if (Boolean.TRUE.equals(file.getIsFolder())) {
                collectFilesRecursive(projectId, file.getId(), sb, depth + 1);
            } else {
                // Filter text files
                if (isTextFile(file.getName())) {
                     // Read content. Assuming local file system for now as per `ProjectFileService` impl.
                     // Warning: Performance hit for many files.
                     try {
                         if (StringUtils.hasText(file.getFilePath())) {
                             java.io.File physical = new java.io.File(file.getFilePath());
                             if (physical.exists() && physical.length() < 1024 * 1024) { // Skip > 1MB files individually
                                 String content = java.nio.file.Files.readString(physical.toPath());
                                 sb.append("\n--- File: ").append(file.getName()).append(" ---\n");
                                 sb.append(content).append("\n");
                             }
                         }
                     } catch (Exception e) {
                         // ignore
                     }
                }
            }
        }
    }
    
    private boolean isTextFile(String name) {
        if (name == null) return false;
        String lower = name.toLowerCase();
        return lower.endsWith(".java") || lower.endsWith(".js") || lower.endsWith(".vue") || lower.endsWith(".ts") 
            || lower.endsWith(".html") || lower.endsWith(".css") || lower.endsWith(".xml") || lower.endsWith(".yml") 
            || lower.endsWith(".json") || lower.endsWith(".md") || lower.endsWith(".txt") || lower.endsWith(".sql");
    }

    private String getOrCreateGeminiCache(String content) {
        // Simple hash content to key
        String hash = cn.hutool.crypto.digest.DigestUtil.md5Hex(content);
        if (activeGeminiCaches.containsKey(hash)) {
            // Validate validity? For now assume valid until TTL (default 1h). We can store timestamp.
            return activeGeminiCaches.get(hash);
        }
        
        // Create Cache via REST
        AiModelProperties.Gemini geminiCfg = aiModelProperties.getGemini();
        if (geminiCfg.getApiKey() == null) throw new RuntimeException("No API Key");
        
        String url = geminiCfg.getApiBaseUrl() + "/cachedContents?key=" + geminiCfg.getApiKey();
        
        JSONObject payload = new JSONObject();
        payload.set("model", "models/" + geminiCfg.getModelName());
        
        JSONObject contentObj = new JSONObject();
        contentObj.set("role", "user");
        JSONArray parts = new JSONArray();
        JSONObject part = new JSONObject();
        part.set("text", content);
        parts.add(part);
        contentObj.set("parts", parts);
        
        payload.set("contents", java.util.Collections.singletonList(contentObj));
        // payload.set("ttl", "600s"); // default 1h is fine
        
        String resp = cn.hutool.http.HttpRequest.post(url)
                .body(payload.toString())
                .execute()
                .body();
        
        JSONObject json = cn.hutool.json.JSONUtil.parseObj(resp);
        if (json.containsKey("name")) {
            String cacheName = json.getStr("name");
            activeGeminiCaches.put(hash, cacheName);
            return cacheName;
        } else {
            throw new RuntimeException("Failed to create cache: " + resp);
        }
    }

    @GetMapping("/conversations")
    public java.util.List<Map<String, Object>> getConversations(@RequestParam Long projectId, @RequestHeader(value = "X-Session-Id", required = false) String sessionId) {
        Long userId = null;
        if (sessionId != null) {
            userId = AuthController.getUserIdFromSession(sessionId);
        }
        return projectAiMessageService.listConversations(projectId, userId);
    }

    @GetMapping("/assistants")
    public java.util.Collection<com.checkba.model.ai.AiAssistantConfig> getAssistants() {
        return loadAssistants().values();
    }
    
    // Helper to load assistants
    private Map<String, com.checkba.model.ai.AiAssistantConfig> loadAssistants() {
        Map<String, com.checkba.model.ai.AiAssistantConfig> map = new java.util.LinkedHashMap<>(); // Preserve order
        String json = systemSettingService.get(KEY_AI_ASSISTANTS, null);
        if (json != null && !json.isBlank()) {
            try {
                java.util.List<com.checkba.model.ai.AiAssistantConfig> list = objectMapper.readValue(json, new com.fasterxml.jackson.core.type.TypeReference<java.util.List<com.checkba.model.ai.AiAssistantConfig>>() {});
                for (com.checkba.model.ai.AiAssistantConfig cfg : list) {
                    map.put(cfg.getId(), cfg);
                }
            } catch (Exception e) {
                log.error("Failed to parse assistants config", e);
            }
        }
        return map;
    }

    /**
     * Get public AI configuration (e.g. active provider) for all users
     */
    @GetMapping("/config")
    public ResponseEntity<?> getAiConfig() {
        String activeProvider = systemSettingService.get("ai.activeProvider", 
                aiModelProperties.getProvider() != null ? aiModelProperties.getProvider().name() : "OLLAMA");
        
        // Return a simple map or DTO
        Map<String, String> config = new java.util.HashMap<>();
        config.put("activeProvider", activeProvider);
        return ResponseEntity.ok(config);
    }

    private ProjectAssistant getAssistant(String modelId, com.checkba.model.ai.AiAssistantConfig assistantConfig) {
        String key = (StringUtils.hasText(modelId) ? modelId : "default").toLowerCase();
        boolean needsTools = assistantConfig.getTools() != null && !assistantConfig.getTools().isEmpty();
        
        // Use a composite key for cache: model + assistantId (because different assistants might need different tool bindings)
        String cacheKey = key + "_" + assistantConfig.getId();

        return assistantCache.computeIfAbsent(cacheKey, k -> {
            if (key.contains("local") || key.contains("ollama")) {
                return createOllamaAssistant(needsTools);
            } else if (key.contains("gemini") || key.contains("google")) {
                return createGeminiAssistant(needsTools); // Try to enable tools for Gemini too
            }
            return defaultProjectAssistant;
        });
    }

    private ProjectAssistant createOllamaAssistant(boolean withTools) {
        AiModelProperties.Ollama cfg = aiModelProperties.getOllama();
        ChatLanguageModel model = dev.langchain4j.model.ollama.OllamaChatModel.builder()
                .baseUrl(cfg.getBaseUrl())
                .modelName(cfg.getModelName())
                .temperature(cfg.getTemperature())
                .timeout(cfg.getTimeout())
                .build();
        
        var builder = AiServices.builder(ProjectAssistant.class)
                .chatLanguageModel(model)
                .contentRetriever(dynamicContentRetriever);
                
        if (withTools) {
            builder.tools(fileTools);
        }
        
        return builder.build();
    }

    private ProjectAssistant createGeminiAssistant(boolean withTools) {
        AiModelProperties.Gemini cfg = aiModelProperties.getGemini();
        ChatLanguageModel model = new GeminiChatLanguageModel(
                cfg.getApiBaseUrl(),
                cfg.getModelName(),
                cfg.getApiKey(),
                cfg.getTimeout()
        );
        
        var builder = AiServices.builder(ProjectAssistant.class)
                .chatLanguageModel(model);
                // .contentRetriever(dynamicContentRetriever); // Disable RAG for Gemini as per requirement and to avoid timeout
        
        // Try enabling tools for Gemini if supported by custom impl or future SDK
        // For now, if withTools is true, we might just inject tools and see if GeminiChatLanguageModel handles it
        // Or we rely on user manually using Ollama as per instruction "ask the user use local ollama"
        if (withTools) {
             // builder.tools(fileTools); // Uncomment if GeminiChatLanguageModel supports function calling
        }
        
        return builder.build();
    }

    private static final int MAX_CONTEXT_CHARS = 6000;

    private String buildPromptWithContext(AiChatRequest request, com.checkba.model.ai.AiAssistantConfig assistantConfig, boolean includeContext) {
        // Consolidate contexts: list > single. If list is present, use it. If not, check single.
        java.util.List<AiChatContext> contexts = request.getContexts();
        if (contexts == null) {
            contexts = new java.util.ArrayList<>();
            if (request.getContext() != null) {
                contexts.add(request.getContext());
            }
        }
        
        StringBuilder builder = new StringBuilder();

        // 1. Inject Prompt (User Override or System)
        // 1.1 Dynamic System Prompt from Admin (Model Specific)
        String modelKey = (request.getModel() != null ? request.getModel() : "default").toLowerCase();
        String dynamicSystemKey = null;
        if (modelKey.contains("gemini") || modelKey.contains("google")) {
            dynamicSystemKey = "ai.systemPrompt.GEMINI";
        } else if (modelKey.contains("local") || modelKey.contains("ollama")) {
            dynamicSystemKey = "ai.systemPrompt.OLLAMA";
        }
        
        String dynamicSystemPrompt = dynamicSystemKey != null ? systemSettingService.get(dynamicSystemKey, "") : "";
        if (StringUtils.hasText(dynamicSystemPrompt)) {
             builder.append("【系统设定】\n").append(dynamicSystemPrompt).append("\n\n");
        }

        if (assistantConfig != null) {
            String promptToUse = assistantConfig.getSystemPrompt();
            String label = "【系统指令】";

            // "User Prompt Prevails" Logic
            if (StringUtils.hasText(assistantConfig.getUserPrompt())) {
                promptToUse = assistantConfig.getUserPrompt();
                label = "【用户自定义指令】(已覆盖系统默认)";
            }

            if (StringUtils.hasText(promptToUse)) {
                builder.append(label).append("\n").append(promptToUse).append("\n\n");
            }
        }

        if (!includeContext || contexts.isEmpty()) {
            builder.append(request.getMessage());
            return builder.toString();
        }

        builder.append("【当前上下文】\n");
        
        for (AiChatContext ctx : contexts) {
            if (ctx == null) continue;
            
            builder.append("--- 文件: ")
                    .append(StringUtils.hasText(ctx.getFileName()) ? ctx.getFileName() : "未命名文件");
            if (StringUtils.hasText(ctx.getFileType())) {
                builder.append(" (").append(ctx.getFileType()).append(")");
            }
            builder.append(" ---\n");
            
            // Fallback: If documentText is empty but fileId is present, try to read file content via backend
            String documentText = ctx.getDocumentText();
            if (!StringUtils.hasText(documentText) && StringUtils.hasText(ctx.getFileId()) && !"folder".equals(ctx.getFileType())) {
                try {
                    Long fileId = Long.parseLong(ctx.getFileId());
                    com.checkba.model.entity.ProjectFile fileEntity = projectFileService.getFile(fileId);
                    if (fileEntity != null && StringUtils.hasText(fileEntity.getFilePath())) {
                        java.io.File file = new java.io.File(fileEntity.getFilePath());
                        if (file.exists()) {
                            String lowerName = file.getName().toLowerCase();
                            if (isTextFile(lowerName)) {
                                 // Plain Text Read
                                 documentText = java.nio.file.Files.readString(file.toPath());
                            } else if (lowerName.endsWith(".pdf") || lowerName.endsWith(".doc") || lowerName.endsWith(".docx") || lowerName.endsWith(".ppt") || lowerName.endsWith(".pptx")) {
                                 // Tika Parse
                                 dev.langchain4j.data.document.parser.apache.tika.ApacheTikaDocumentParser parser = new dev.langchain4j.data.document.parser.apache.tika.ApacheTikaDocumentParser();
                                 dev.langchain4j.data.document.Document doc = parser.parse(java.nio.file.Files.newInputStream(file.toPath()));
                                 documentText = doc.text();
                            }
                        }
                    }
                } catch (Exception e) {
                     log.warn("Failed to read context file content in backend", e);
                     documentText = "[System: Error reading file content: " + e.getMessage() + "]";
                }
            } else if ("folder".equals(ctx.getFileType()) && StringUtils.hasText(ctx.getFileId())) {
                // Inline Folder Content Logic (moved from main chat method to allow multi-folder)
                try {
                     Long folderId = Long.parseLong(ctx.getFileId());
                     documentText = collectFolderContent(Long.parseLong(request.getProjectId()), folderId);
                } catch (Exception e) {
                     documentText = "[System: Failed to load folder content: " + e.getMessage() + "]";
                }
            }
            
            String selection = safeContextBlock(ctx.getSelectionText(), 1500);
            if (StringUtils.hasText(selection)) {
                builder.append("选区内容:\n```\n")
                        .append(selection)
                        .append("\n```\n");
            }
            // For folders, we allow larger context
            int maxChars = "folder".equals(ctx.getFileType()) ? 50000 : MAX_CONTEXT_CHARS; 
            String document = safeContextBlock(documentText, maxChars);
            if (StringUtils.hasText(document)) {
                builder.append("正文内容:\n```\n")
                        .append(document)
                        .append("\n```\n");
            }
            builder.append("\n");
        }
        
        builder.append("\n【用户请求】\n")
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
        private AiChatContext context; // Deprecated, use contexts
        private java.util.List<AiChatContext> contexts; // New
        private String model;
        private String assistantId;
        private String conversationId;
    }
    
    @Data
    public static class AiChatResponse {
        private String response;
        private String conversationId;
        public AiChatResponse(String response) { this.response = response; }
        public AiChatResponse(String response, String conversationId) { 
            this.response = response; 
            this.conversationId = conversationId;
        }
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
