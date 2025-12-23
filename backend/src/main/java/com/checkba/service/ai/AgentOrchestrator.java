package com.checkba.service.ai;

import com.checkba.controller.ai.AiAgentController;
import com.checkba.model.entity.ProjectAiMessage;
import com.checkba.service.ProjectAiMessageService;
import dev.langchain4j.model.chat.ChatLanguageModel;
import dev.langchain4j.model.chat.StreamingChatLanguageModel;
import dev.langchain4j.agent.tool.ToolSpecification;
import dev.langchain4j.agent.tool.ToolSpecifications;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.springframework.core.io.ClassPathResource;
import org.springframework.util.StreamUtils;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.lang.reflect.Method;
import java.util.concurrent.CompletableFuture;

/**
 * Agent 核心编排器 ("The Brain").
 * 负责：
 * 1. 组装上下文 (Context Assembly)
 * 2. 调用 LLM (Thinking)
 * 3. 处理流式响应 (Streaming)
 * 4. 执行工具 (Tool Execution)
 * 5. 维护循环 (Loop)
 */
@Service
@RequiredArgsConstructor
public class AgentOrchestrator {

    private static final org.slf4j.Logger log = org.slf4j.LoggerFactory.getLogger(AgentOrchestrator.class);

    private final ChatModelFactory chatModelFactory;
    private final ProjectAiMessageService messageService;
    private final SseEmitterService sseEmitterService;
    private final TokenUsageService tokenUsageService;
    private final ContextAssemblerService contextAssemblerService;
    private final com.checkba.service.ai.tools.LegalTools legalTools; 
    private final com.checkba.service.ai.tools.FileTools fileTools;
    private final com.checkba.service.ai.tools.WebTools webTools;
    private final com.checkba.service.ai.tools.PythonTools pythonTools;
    private final com.checkba.service.ai.tools.MemoryTools memoryTools;
    private final com.checkba.service.ProjectFileService projectFileService;
    private final PluginService pluginService;


    // Correct signature accepting projectId
    private String executeNativeTool(dev.langchain4j.agent.tool.ToolExecutionRequest req, Long projectId, String conversationId) {
        String toolName = req.name();
        String args = req.arguments();
        
        try {
            if ("read_document".equals(toolName)) {
                String fileId = extractArg(args, "fileId");
                return legalTools.read_document(fileId);
            } else if ("search_web".equals(toolName)) {
                 String query = extractArg(args, "query");
                 return webTools.search_web(query);
            } else if ("browse_url".equals(toolName)) {
                 String url = extractArg(args, "url");
                 return webTools.browse_url(url);
            } else if ("law_search".equals(toolName)) {
                 String query = extractArg(args, "query");
                 return legalTools.law_search(query);
            } else if ("law_search_keyword".equals(toolName)) {
                 String title = extractArg(args, "title");
                 String fulltext = extractArg(args, "fulltext");
                 return legalTools.law_search_keyword(title, fulltext);
            } else if ("law_recognition".equals(toolName)) {
                 String text = extractArg(args, "text");
                 return legalTools.law_recognition(text);
            } else if ("get_law_article".equals(toolName)) {
                 String title = extractArg(args, "title");
                 String number = extractArg(args, "number");
                 return legalTools.get_law_article(title, number);
            } else if ("write_docx".equals(toolName)) {
                 // write_docx logic - support both naming conventions
                 String fileName = extractArg(args, "name");
                 if (fileName == null || fileName.isEmpty()) fileName = extractArg(args, "fileName");
                 String markdown = extractArg(args, "markdown_content");
                 if (markdown == null || markdown.isEmpty()) markdown = extractArg(args, "markdownContent");
                 String result = fileTools.write_docx(fileName, markdown, projectId);
                 
                 // Trigger UI Refresh if success
                 if (result != null && !result.startsWith("Error")) {
                     sseEmitterService.send(conversationId, "client_action", "{\"action\":\"refresh_files\"}");
                 }
                 return result;
            } else if ("run_python".equals(toolName)) {
                 String code = extractArg(args, "code");
                 return pythonTools.run_python(code);
            } else if ("write_file".equals(toolName)) {
                 String filename = extractArg(args, "filename");
                 String content = extractArg(args, "content");
                 return fileTools.write_file(filename, content, projectId);
            } else if ("list_files".equals(toolName)) {
                 String dir = extractArg(args, "dirPath");
                 return fileTools.list_files(dir);
            } else if ("search_project_files".equals(toolName)) {
                 String pattern = extractArg(args, "fileNamePattern");
                 String dir = extractArg(args, "dirPath");
                 return fileTools.search_project_files(pattern, dir);
            } else if ("delete_file".equals(toolName)) {
                 String path = extractArg(args, "filePath");
                 return fileTools.delete_file(path);
            } else if ("move_file".equals(toolName)) {
                 String src = extractArg(args, "sourcePath");
                 String dst = extractArg(args, "destPath");
                 return fileTools.move_file(src, dst);
            } else if ("read_file".equals(toolName)) {
                 String path = extractArg(args, "filePath");
                 return fileTools.read_file(path);
            } else if ("add_memory".equals(toolName)) {
                 String key = extractArg(args, "key");
                 String value = extractArg(args, "value");
                 return memoryTools.add_memory(key, value);
            } else if ("query_knowledge_base".equals(toolName)) {
                 String query = extractArg(args, "query");
                 // Pass projectId if available in args or default? 
                 // The tool definition is single arg `query`.
                 // Overloaded version has generic query.
                 return memoryTools.query_knowledge_base(query);
            } else {
                // Check if it's a dynamic plugin tool
                Object toolObject = pluginService.getPluginTools().get(toolName);
                if (toolObject != null) {
                    log.info("Executing dynamic plugin tool: {}", toolName);
                    return executeDynamicTool(toolObject, req, projectId, conversationId);
                }
            }
        } catch (Exception e) {
            return "Error executing tool: " + e.getMessage();
        }
        return "Tool not found or arguments invalid.";
    }

    private String executeDynamicTool(Object toolObject, dev.langchain4j.agent.tool.ToolExecutionRequest req, Long projectId, String conversationId) {
        try {
            // Use reflection or a more sophisticated dispatcher.
            // For now, let's find the method with @Tool that matches name.
            for (Method method : toolObject.getClass().getDeclaredMethods()) {
                if (method.isAnnotationPresent(dev.langchain4j.agent.tool.Tool.class)) {
                    String name = method.getName(); 
                    // Actually LangChain4j uses method name as tool name if @Tool value is a description.
                    
                    if (method.getName().equals(req.name())) {
                        // Very naive arg mapping (only supports Map/String/JSONObject)
                        // In reality, we should use ToolSpecifications to map args.
                        // Simple version: if it takes Map or String
                        Class<?>[] params = method.getParameterTypes();
                        if (params.length == 0) return (String) method.invoke(toolObject);
                        
                        // Extract args as Map
                        cn.hutool.json.JSONObject obj = cn.hutool.json.JSONUtil.parseObj(req.arguments());
                        Object[] args = new Object[params.length];
                        
                        // Just a prototype mapping - assuming first param might be Map or String
                        if (params[0].equals(Map.class)) args[0] = obj.toBean(Map.class);
                        else if (params[0].equals(String.class)) args[0] = obj.getStr(method.getParameters()[0].getName());
                        
                        return (String) method.invoke(toolObject, args);
                    }
                }
            }
        } catch (Exception e) {
            log.error("Dynamic tool execution failed", e);
            return "Error: " + e.getMessage();
        }
        return "Error: Tool method not found in plugin.";
    }


    /**
     * 处理用户消息 (入口)
     */
    @Async("taskExecutor") // Run in separate thread
    public void handleUserMessage(AiAgentController.AgentChatRequest request, Long userId) {
        String conversationId = request.getConversationId();
        String projectId = String.valueOf(request.getProjectId());
        
        try {
            log.info("Agent Loop Started: conv={}, model={}, msg={}", conversationId, request.getModel(), request.getMessage());
            
            // 1. 保存用户消息 (Save only user message first; assistant saved after stream completes)
            messageService.saveMessage(
                projectId, userId, conversationId, "USER", request.getMessage()
            );
            
            // 1.1 首次对话时异步生成对话标题
            List<com.checkba.model.entity.ProjectAiMessage> existingMsgs = messageService.listByConversationId(conversationId);
            if (existingMsgs.size() <= 1) { // Only the user message we just saved
                final String convId = conversationId;
                final String userMsg = request.getMessage();
                CompletableFuture.runAsync(() -> {
                    try {
                        log.info("Generating conversation title for: {}", convId);
                        // Use a lightweight model for title generation
                        dev.langchain4j.model.chat.ChatLanguageModel titleModel = chatModelFactory.getChatModel("google/gemini-2.0-flash-exp:free");
                        String title = messageService.generateConversationTitle(userMsg, titleModel);
                        messageService.updateConversationTitle(convId, title);
                        log.info("Conversation title generated: {} -> {}", convId, title);
                        // Notify frontend of title update
                        sseEmitterService.send(convId, "title_update", "{\"title\":\"" + title.replace("\"", "\\\"").replace("\n", " ") + "\"}");
                    } catch (Exception e) {
                        log.warn("Failed to generate conversation title for {}", convId, e);
                    }
                });
            }
            
            // 2. Build Context & History Message Stack (Spec v1.8)
            log.info("Assembling full message context for conversation: {}", conversationId);
            // TODO: Get taskListId/planId from session if available
            String taskListId = null; 
            String planId = null;
            
            java.util.List<dev.langchain4j.data.message.ChatMessage> messages = contextAssemblerService.assemble(
                conversationId, 
                request.getMessage(), 
                request.getContextItems() != null ? request.getContextItems() : 
                    convertFileIdsToContextItems(request.getFileIds()),
                taskListId,
                planId,
                projectId
            );
            
            log.info("Message assembly complete. Total messages: {}", messages.size());
            log.debug("Detailed Message Stack:");
            for (dev.langchain4j.data.message.ChatMessage m : messages) {
                log.debug("  - Role: {}, Content length: {}", m.type(), m.text().length());
            }

            // 3. 获取流式模型
            log.info("Getting streaming model: {}", request.getModel());
            StreamingChatLanguageModel model = chatModelFactory.getStreamingChatModel(request.getModel());
            
            if (model == null) {
                throw new RuntimeException("Could not create streaming model for ID: " + request.getModel());
            }

            // 4. Start Loop
            log.info("Starting runLoop for conversation: {}", conversationId);
            // Track tool executions for history persistence
            StringBuilder executionLog = new StringBuilder();
            runLoop(model, messages, conversationId, projectId, userId, request.getModel(), 0, executionLog);
            
        } catch (Exception e) {
            log.error("Agent Loop Error for conversation: " + conversationId, e);
            sseEmitterService.send(conversationId, "error", "Internal Error: " + e.getMessage());
            sseEmitterService.close(conversationId);
        }
    }

    private void runLoop(StreamingChatLanguageModel model, 
                         java.util.List<dev.langchain4j.data.message.ChatMessage> messages, 
                         String conversationId, String projectId, Long userId, String modelId, int depth,
                         StringBuilder executionLog) {
        
        if (depth > 10) {
            sseEmitterService.send(conversationId, "error", "Max recursion depth reached");
            sseEmitterService.close(conversationId);
            return;
        }

        AgentStreamHandler handler = new AgentStreamHandler(
            sseEmitterService, 
            conversationId, 
            tokenUsageService, 
            projectId, 
            userId, 
            modelId
        );
        
        // Callback for Loop
        handler.setOnComplete(response -> {
            dev.langchain4j.data.message.AiMessage aiMessage = response.content();
            messages.add(aiMessage);
            
            // 1. Check for Native Tool Requests (Priority 1)
            if (aiMessage.hasToolExecutionRequests()) {
                log.info("Detected Native Tool Requests: {}", aiMessage.toolExecutionRequests());
                sseEmitterService.send(conversationId, "step_update", "{\"status\":\"loading\", \"message\":\"Executing tools...\"}");

                // Execute Native Tools
                for (dev.langchain4j.agent.tool.ToolExecutionRequest req : aiMessage.toolExecutionRequests()) {
                    String result = executeNativeTool(req, Long.parseLong(projectId), conversationId);
                    messages.add(dev.langchain4j.data.message.ToolExecutionResultMessage.from(req, result));
                    
                    // Determine status for history and display
                    String nativeToolStatus = (result != null && !result.startsWith("Error")) ? "SUCCESS" : "FAILURE";
                    
                    // Log for history persistence (include status attribute)
                    executionLog.append(String.format("<process name=\"%s\"><tool_code>%s(%s)</tool_code><tool_output status=\"%s\">%s</tool_output></process>\n",
                        req.name(), req.name(), req.arguments(), nativeToolStatus, result));
                }
                
                sseEmitterService.send(conversationId, "step_update", "{\"status\":\"done\", \"message\":\"Tools executed.\"}");
                runLoop(model, messages, conversationId, projectId, userId, modelId, depth + 1, executionLog);
                return;
            } 
            
            String content = aiMessage.text();
            if (content == null) content = "";

            // 2. Check for XML Tool Requests (Fallback for Root Bubble Protocol)
            // Pattern: <tool_code>legal_tools.method(args)</tool_code> OR <code>...</code>
            // We need to parse this manually because we forced XML output in System Prompt.
            if (content.contains("<tool_code>") || content.contains("<code>")) {
                log.info("Detected XML Tool Code in content. Parsing...");
                
                // 提取LLM选择的process name，用于历史记录保存时保持一致性
                String llmProcessName = null;
                java.util.regex.Pattern processNamePattern = java.util.regex.Pattern.compile("<process[^>]*name=\"([^\"]*)\"[^>]*>");
                java.util.regex.Matcher processNameMatcher = processNamePattern.matcher(content);
                if (processNameMatcher.find()) {
                    llmProcessName = processNameMatcher.group(1);
                    log.info("Extracted LLM process name: {}", llmProcessName);
                }
                
                // Regex to match either <tool_code>...</tool_code> or <code>...</code>
                // Uses backreference \1 to match the opening tag name, and (?s) for DOTALL mode to match newlines
                java.util.regex.Pattern toolPattern = java.util.regex.Pattern.compile("(?s)<(tool_code|code)>(.*?)</\\1>");
                java.util.regex.Matcher matcher = toolPattern.matcher(content);
                
                boolean toolExecuted = false;
                
                while (matcher.find()) {
                    String code = matcher.group(2).trim(); // e.g., legal_tools.search_web(query="...") or print(legal_tools...)
                    log.info("Parsed Tool Code: {}", code);
                    
                    // Notify Frontend
                    // String escapedCode = "Executing: " + code.replace("\"", "\\\"");
                    // sseEmitterService.send(conversationId, "step_update", "{\"status\":\"loading\", \"message\":\"" + escapedCode + "\"}");
                    
                    String result = "Error executing tool code: " + code;
                    try {
                        // VERY Basic Parsing for specific known tools
                        // Expecting: legal_tools.search_web(query="...")
                        // Or: default_api.search_web(...)
                        
                        // PRIORITY 1: run_python - Check first to avoid false matches on tools inside Python code
                        if (code.startsWith("run_python(") || code.contains("run_python(code=")) {
                             // Extract Python code from run_python(code='...' or code="...")
                             String pythonCode = extractPythonCodeArg(code);
                             if (pythonCode != null && !pythonCode.isEmpty()) {
                                 log.info("Executing Python code via PythonTools, code length: {}", pythonCode.length());
                                 result = pythonTools.run_python(pythonCode);
                             } else {
                                 result = "Error: Could not extract Python code from run_python call.";
                             }
                        } else if (code.contains("search_web") || code.contains("search_laws")) {
                             String query = extractStringArg(code, "query");
                             // Fallback: search_laws -> search_web
                             result = webTools.search_web(query);
                        } else if (code.contains("law_search_keyword")) {
                             String title = extractStringArg(code, "title");
                             String fulltext = extractStringArg(code, "fulltext");
                             result = legalTools.law_search_keyword(title, fulltext);
                        } else if (code.contains("law_recognition")) {
                             String text = extractStringArg(code, "text");
                             result = legalTools.law_recognition(text);
                        } else if (code.contains("law_search")) {
                             String query = extractStringArg(code, "query");
                             result = legalTools.law_search(query);
                        } else if (code.contains("get_law_article")) {
                             String title = extractStringArg(code, "title");
                             String number = extractStringArg(code, "number");
                             result = legalTools.get_law_article(title, number);
                        } else if (code.contains("browse_url")) {
                             String url = extractStringArg(code, "url");
                             result = webTools.browse_url(url);
                        } else if (code.contains("read_document")) {
                             String fileId = extractStringArg(code, "fileId");
                             // fallback if fileId arg name differs
                             if (fileId.isEmpty()) fileId = extractStringArg(code, "id"); 
                             result = legalTools.read_document(fileId);
                        } else if (code.contains("write_docx")) {
                             // Extract "name" first (as per system_prompt.md), fallback to "fileName"
                             String fileName = extractStringArg(code, "name");
                             if (fileName.isEmpty()) fileName = extractStringArg(code, "fileName");
                             // Try to extract markdown content with various parameter names
                             String fileContent = extractStringArg(code, "markdown_content");
                             if (fileContent.isEmpty()) fileContent = extractStringArg(code, "markdownContent");
                             if (fileContent.isEmpty()) fileContent = extractStringArg(code, "content");
                             
                             result = fileTools.write_docx(fileName, fileContent, Long.parseLong(projectId));
                             
                             // Trigger UI Refresh if success
                             if (result != null && !result.startsWith("Error")) {
                                 sseEmitterService.send(conversationId, "client_action", "{\"action\":\"refresh_files\"}");
                             }
                        } else if (code.contains("write_file")) {
                             String fileName = extractStringArg(code, "fileName");
                             if (fileName.isEmpty()) fileName = extractStringArg(code, "filename");
                             String fileContent = extractStringArg(code, "content");
                             result = fileTools.write_file(fileName, fileContent, Long.parseLong(projectId));
                        } else if (code.contains("list_files")) {
                             String dir = extractStringArg(code, "dirPath");
                             if (dir.isEmpty()) dir = "."; 
                             result = fileTools.list_files(dir);
                        } else if (code.contains("search_project_files")) {
                             String pattern = extractStringArg(code, "fileNamePattern");
                             String dir = extractStringArg(code, "dirPath");
                             result = fileTools.search_project_files(pattern, dir);
                        } else if (code.contains("read_file")) {
                             String path = extractStringArg(code, "filePath");
                             // fallback
                             if (path.isEmpty()) path = extractStringArg(code, "path");
                             result = fileTools.read_file(path);
                        } else if (code.contains("delete_file")) {
                             String path = extractStringArg(code, "filePath");
                             result = fileTools.delete_file(path);
                        } else if (code.contains("move_file")) {
                             String src = extractStringArg(code, "sourcePath");
                             String dst = extractStringArg(code, "destPath");
                             result = fileTools.move_file(src, dst);
                        } else if (code.contains("add_memory")) {
                             String key = extractStringArg(code, "key");
                             String value = extractStringArg(code, "value");
                             result = memoryTools.add_memory(key, value);
                        } else if (code.contains("query_knowledge_base")) {
                             String query = extractStringArg(code, "query");
                             result = memoryTools.query_knowledge_base(query);
                         } else {
                            // Try to check if it's a dynamic plugin tool (e.g., plugin_name.method_name or just method_name)
                            String dynamicToolName = parseToolName(code);
                            Object toolObject = pluginService.getPluginTools().get(dynamicToolName);
                            if (toolObject != null) {
                                log.info("Executing dynamic plugin tool via XML: {}", dynamicToolName);
                                // For simplicity, we create a ToolExecutionRequest for the executeDynamicTool method
                                dev.langchain4j.agent.tool.ToolExecutionRequest req = dev.langchain4j.agent.tool.ToolExecutionRequest.builder()
                                        .name(dynamicToolName)
                                        .arguments(extractArgsAsJson(code))
                                        .build();
                                result = executeDynamicTool(toolObject, req, Long.parseLong(projectId), conversationId);
                            } else {
                                // Try to evaluate generalized python-like string?
                                // For safety, only allow listed tools.
                                result = "Unknown tool in custom parser: " + code;
                            }
                         }
                        
                    } catch (Exception e) {
                        result = "Tool Execution Failed: " + e.getMessage();
                    }
                    
                    // Add Result to History
                    // Since this isn't a native tool role, we append a SYSTEM/USER message with the result
                    // formatted as <tool_output> so the model recognizes it.
                    String statusPrefix = result.startsWith("Error") ? "FAILURE" : "SUCCESS";
                    
                    // Enhancement for Write Tools: Append explicit success for file creation/modification
                    // The model often sees JSON IDs (wps_file_id) and thinks it failed or needs to do more.
                    if ("SUCCESS".equals(statusPrefix) && (code.contains("write_docx") || code.contains("write_file") || code.contains("write_"))) {
                         result += "\n\n(System Note: File operation completed successfully.)";
                    }
                    
                    String toolOutputMsg = String.format("<process><tool_output>%s</tool_output></process>", result);
                    
                    // Explicitly tell the model to EVALUATE
                    String feedbackMsg = String.format("[System Tool Execution Log]\nTool: %s\nStatus: %s\nOutput: %s\n\n(INSTRUCTION: Evaluate the results above. If the user request is fulfilled, provide a final response to the user via `<final>` tag. If you need more information or further actions, continue.)", 
                        code, statusPrefix, result);
                        
                    messages.add(dev.langchain4j.data.message.UserMessage.from(feedbackMsg));
                    
                    // Log for history persistence (include status attribute)
                    // 优先使用LLM选择的process name，保持与实时流式一致
                    String processNameForLog = (llmProcessName != null && !llmProcessName.isEmpty()) 
                        ? llmProcessName 
                        : getToolDisplayName(code);
                    executionLog.append(String.format("<process name=\"%s\"><tool_code>%s</tool_code><tool_output status=\"%s\">%s</tool_output></process>\n",
                        processNameForLog, code, statusPrefix, result));
                    
                    // Emit explicit tool_output for frontend parser with status attribute
                    // NOTE: Do NOT wrap in <process> - the tool_output belongs to the existing process
                    // that contained the tool_code. Wrapping in <process> would create a NEW process
                    // and the frontend wouldn't find the tool item to update.
                    String toolOutputXml = String.format("<tool_output status=\"%s\">%s</tool_output>", 
                        statusPrefix, result);
                    sseEmitterService.send(conversationId, "text_delta", "{\"content\":\"" + toolOutputXml.replace("\"", "\\\"").replace("\n", "\\n") + "\"}");

                    toolExecuted = true;
                }
                
                if (toolExecuted) {
                     // Recurse with executionLog
                     runLoop(model, messages, conversationId, projectId, userId, modelId, depth + 1, executionLog);
                     return;
                }
            }

            // 3. Check for Artifacts
            // - Task List: Do NOT stop loop anymore (User Requirement). Backend maintains it or just logs it.
            // - Implementation Plan: STOP LOOP for approval.
            
            // FIRST: Strip any markdown code block wrappers that LLM may have added
            String cleanedContent = content;
            cleanedContent = cleanedContent.replaceAll("^```(?:xml|html|markdown)?\\s*\\n?", "");
            cleanedContent = cleanedContent.replaceAll("\\n?```\\s*$", "");
            cleanedContent = cleanedContent.replaceAll("```(?:xml|html|markdown)?\\s*\\n", "");
            cleanedContent = cleanedContent.replaceAll("\\n```", "");
            
            if (cleanedContent.contains("<artifact") && (cleanedContent.contains("type=\"implementation_plan\"") || cleanedContent.contains("type=\"task_list\""))) {
                // Parse full artifact
                String type = "unknown";
                if (cleanedContent.contains("type=\"implementation_plan\"")) type = "implementation_plan";
                else if (cleanedContent.contains("type=\"task_list\"")) type = "task_list";
                
                // Extract name attribute if present
                String artifactName = null;
                java.util.regex.Pattern namePattern = java.util.regex.Pattern.compile("<artifact[^>]*name=\"([^\"]+)\"[^>]*>");
                java.util.regex.Matcher nameMatcher = namePattern.matcher(cleanedContent);
                if (nameMatcher.find()) {
                    artifactName = nameMatcher.group(1).trim();
                    // Sanitize for filename (max 30 chars, remove special chars)
                    artifactName = artifactName.replaceAll("[/\\\\:*?\"<>|]", "_");
                    if (artifactName.length() > 30) artifactName = artifactName.substring(0, 30);
                }
                
                // Extract Content inside tags
                String artifactContent = "";
                java.util.regex.Pattern p = java.util.regex.Pattern.compile("<artifact[^>]*>([\\s\\S]*?)</artifact>");
                java.util.regex.Matcher m = p.matcher(cleanedContent);
                if (m.find()) {
                    artifactContent = m.group(1).trim();
                } else {
                     // Fallback: Try to extract everything after the opening artifact tag
                     int start = cleanedContent.indexOf(">" , cleanedContent.indexOf("<artifact"));
                     int end = cleanedContent.indexOf("</artifact>");
                     if (start > 0 && end > start) {
                         artifactContent = cleanedContent.substring(start + 1, end).trim();
                     } else {
                         artifactContent = cleanedContent; // Last resort fallback
                     }
                }
                
                // Determine filename: prefer extracted name, fallback to default
                String filename;
                if (artifactName != null && !artifactName.isEmpty()) {
                    filename = artifactName + ".md";
                } else {
                    filename = (type.equals("task_list") ? "Task List" : "Plan") + ".md";
                }
                
                log.info("Artifact detected: type={}, name={}, contentLength={}", type, filename, artifactContent.length());
                
                try {
                     projectFileService.saveArtifactFile(Long.valueOf(projectId), conversationId, filename, artifactContent, userId);
                     log.info("Artifact Saved: path=AI Assistant Files/{}/{}", conversationId, filename);
                } catch (Exception e) {
                     log.error("Failed to save artifact file", e);
                }

                if (type.equals("implementation_plan")) {
                    log.info("Detected Implementation Plan. STOPPING LOOP for user approval.");
                    // Save assistant message with execution log prepended
                    String fullContent = executionLog.length() > 0 ? executionLog.toString() + content : content;
                    messageService.saveMessage(projectId, userId, conversationId, "ASSISTANT", fullContent);
                    return; // Stop and wait for user action
                }
            }
            
            // 3.1 Check for Title (Update Conversation Title)
            // Pattern: <title>Title Content</title>
            if (content.contains("<title>")) {
                java.util.regex.Pattern pTitle = java.util.regex.Pattern.compile("<title>([\\s\\S]*?)</title>");
                java.util.regex.Matcher mTitle = pTitle.matcher(content);
                if (mTitle.find()) {
                    String newTitle = mTitle.group(1).trim();
                    if (!newTitle.isEmpty()) {
                        // Truncate to 30 chars for folder safety
                        if (newTitle.length() > 30) newTitle = newTitle.substring(0, 30);
                        
                        log.info("Updating Conversation Title to: {}", newTitle);
                        try {
                            // Update Folder Name in "AI Assistant Files"
                            projectFileService.renameConversationFolder(conversationId, newTitle, userId);
                        } catch (Exception e) {
                             log.warn("Failed to update conversation folder title", e);
                        }
                    }
                }
            }

            // 4. Default: Loop Finished
            log.info("Agent Loop Finished for {}", conversationId);
            if (!content.isEmpty()) {
                // Prepend execution log for history persistence
                String fullContent = executionLog.length() > 0 ? executionLog.toString() + content : content;
                messageService.saveMessage(projectId, userId, conversationId, "ASSISTANT", fullContent);
            }
        });
        
        // Execute Generation with Tools
        // Combine all tool specifications
        List<ToolSpecification> allTools = new ArrayList<>();
        allTools.addAll(ToolSpecifications.toolSpecificationsFrom(legalTools));
        allTools.addAll(ToolSpecifications.toolSpecificationsFrom(webTools));
        allTools.addAll(ToolSpecifications.toolSpecificationsFrom(pythonTools));
        allTools.addAll(ToolSpecifications.toolSpecificationsFrom(memoryTools));
        allTools.addAll(ToolSpecifications.toolSpecificationsFrom(fileTools));
        
        // Add Dynamic Plugin Tools
        allTools.addAll(pluginService.getToolSpecifications());
        
        model.generate(messages, allTools, handler);
    }
    
    // Simple naive JSON extractor for single String arg tools
    private String extractArg(String jsonArgs, String key) {
        if (jsonArgs == null) return "";
        // using hutool or jackson is better. 
        // e.g. {"fileId": "123"}
        try {
            cn.hutool.json.JSONObject obj = cn.hutool.json.JSONUtil.parseObj(jsonArgs);
            return obj.getStr(key);
        } catch (Exception e) {
            return jsonArgs; // fallback
        }
    }
    
    // Naive extraction from code string like: function(key="value")

    private String extractStringArg(String code, String key) {
        // Extract string argument from code like: function(key="value") or function(key="multi\nline\nvalue")
        // Must handle multi-line content (e.g., markdown_content for write_docx)
        try {
            // Find the start of key="
            int keyStart = code.indexOf(key + "=\"");
            char quoteChar = '"';
            if (keyStart == -1) {
                // Try single quotes
                keyStart = code.indexOf(key + "='");
                quoteChar = '\'';
            }
            if (keyStart == -1) return "";
            
            // Move to the opening quote
            int valueStart = keyStart + key.length() + 2; // skip key="
            if (valueStart >= code.length()) return "";
            
            // Find the closing quote by scanning character by character
            // Handle escaped quotes
            StringBuilder value = new StringBuilder();
            boolean escaped = false;
            for (int i = valueStart; i < code.length(); i++) {
                char c = code.charAt(i);
                if (escaped) {
                    // Handle common escape sequences
                    if (c == 'n') value.append('\n');
                    else if (c == 't') value.append('\t');
                    else if (c == 'r') value.append('\r');
                    else value.append(c); // handles \\, \", \'
                    escaped = false;
                } else if (c == '\\') {
                    escaped = true;
                } else if (c == quoteChar) {
                    // Found the closing quote
                    return value.toString();
                } else {
                    value.append(c);
                }
            }
            // If we reach here, no closing quote was found - return what we have
            return value.toString();
        } catch (Exception e) {
            log.warn("Failed to extract arg {} from code {}", key, code.length() > 200 ? code.substring(0, 200) + "..." : code);
        }
        return "";
    }
    
    /**
     * Extract Python code from run_python(code='...') or run_python(code="...")
     * Handles multi-line code and escaped quotes.
     */
    private String extractPythonCodeArg(String input) {
        if (input == null) return "";
        
        try {
            // Find the start of run_python(code=
            int codeStart = input.indexOf("run_python(code=");
            if (codeStart == -1) {
                // Try alternative format: run_python(code =
                codeStart = input.indexOf("run_python(code =");
            }
            if (codeStart == -1) return "";
            
            // Move to after "code="
            int quoteStart = input.indexOf('=', codeStart) + 1;
            
            // Skip whitespace
            while (quoteStart < input.length() && Character.isWhitespace(input.charAt(quoteStart))) {
                quoteStart++;
            }
            
            if (quoteStart >= input.length()) return "";
            
            char quoteChar = input.charAt(quoteStart);
            if (quoteChar != '\'' && quoteChar != '"') return "";
            
            // Find the matching closing quote, accounting for escaped quotes
            int quoteEnd = quoteStart + 1;
            boolean escaped = false;
            while (quoteEnd < input.length()) {
                char c = input.charAt(quoteEnd);
                if (escaped) {
                    escaped = false;
                } else if (c == '\\') {
                    escaped = true;
                } else if (c == quoteChar) {
                    // Check if we're at the end: should be followed by ) or whitespace then )
                    int afterQuote = quoteEnd + 1;
                    while (afterQuote < input.length() && Character.isWhitespace(input.charAt(afterQuote))) {
                        afterQuote++;
                    }
                    if (afterQuote >= input.length() || input.charAt(afterQuote) == ')') {
                        break;
                    }
                }
                quoteEnd++;
            }
            
            if (quoteEnd >= input.length()) return "";
            
            String extracted = input.substring(quoteStart + 1, quoteEnd);
            
            // Unescape common escape sequences
            extracted = extracted.replace("\\n", "\n");
            extracted = extracted.replace("\\t", "\t");
            extracted = extracted.replace("\\'", "'");
            extracted = extracted.replace("\\\"", "\"");
            extracted = extracted.replace("\\\\", "\\");
            
            return extracted;
            
        } catch (Exception e) {
            log.warn("Failed to extract Python code from: {}", input, e);
            return "";
        }
    }

    /**
     * Clean XML control tags from LLM output before saving to DB.
     * These tags are for streaming display only and should not be persisted.
     */
    private String cleanXmlTags(String content) {
        if (content == null) return "";
        
        // Remove markdown code block wrappers that LLM sometimes outputs
        // ```xml, ```html, ``` etc.
        String cleaned = content.replaceAll("^```(?:xml|html|markdown)?\\s*\\n?", "");
        cleaned = cleaned.replaceAll("\\n?```\\s*$", "");
        cleaned = cleaned.replaceAll("```(?:xml|html|markdown)?\\s*\\n", "");
        cleaned = cleaned.replaceAll("\\n```", "");
        
        // Remove bubble_type tags: <bubble_type mode="..." />
        cleaned = cleaned.replaceAll("<bubble_type[^>]*/?>", "");
        
        // Remove artifact tags but KEEP the content inside
        // <artifact type="...">content</artifact> -> content
        cleaned = cleaned.replaceAll("<artifact[^>]*>", "");
        cleaned = cleaned.replaceAll("</artifact>", "");
        
        // Remove task_update tags: <task_update id="..." status="..." />
        cleaned = cleaned.replaceAll("<task_update[^>]*/?>", "");
        
        // Remove tool_code, tool_use tags
        cleaned = cleaned.replaceAll("<tool_code[^>]*>[\\s\\S]*?</tool_code>", "");
        cleaned = cleaned.replaceAll("<tool_use[^>]*>[\\s\\S]*?</tool_use>", "");
        cleaned = cleaned.replaceAll("<tool_code[^>]*/?>", "");
        cleaned = cleaned.replaceAll("<tool_use[^>]*/?>", "");
        
        // Keep <final> tag content but remove the tags themselves
        // <final>content</final> -> content
        cleaned = cleaned.replaceAll("<final>", "");
        cleaned = cleaned.replaceAll("</final>", "");
        
        // Clean up multiple consecutive newlines
        cleaned = cleaned.replaceAll("\\n{3,}", "\n\n");
        
        return cleaned.trim();
    }

    private java.util.List<com.checkba.controller.ai.AiAgentController.ContextItem> convertFileIdsToContextItems(java.util.List<String> fileIds) {
        if (fileIds == null) return null;
        return fileIds.stream().map(id -> {
            com.checkba.controller.ai.AiAgentController.ContextItem item = new com.checkba.controller.ai.AiAgentController.ContextItem();
            item.setId(id);
            item.setIsDir(false);
            return item;
        }).collect(java.util.stream.Collectors.toList());
    }

    /**
     * 将工具代码转换为用户友好的中文显示名称。
     * 这确保历史对话加载时显示的工具名称与实时流式时一致。
     */
    private String getToolDisplayName(String code) {
        if (code == null || code.isEmpty()) return "工具执行";
        
        // PKULaw 法律工具
        if (code.contains("get_law_article")) return "查询法条";
        if (code.contains("law_search_keyword")) return "关键词搜索法规";
        if (code.contains("law_recognition")) return "法条识别与溯源";
        if (code.contains("law_search")) return "语义搜索法规";
        
        // 网络搜索工具
        if (code.contains("search_web")) return "网络搜索";
        if (code.contains("browse_url")) return "浏览网页";
        
        // 文档工具
        if (code.contains("read_document")) return "读取文档";
        if (code.contains("write_docx")) return "生成Word文档";
        if (code.contains("write_file")) return "写入文件";
        if (code.contains("read_file")) return "读取文件";
        if (code.contains("list_files")) return "列出文件";
        if (code.contains("search_project_files")) return "搜索项目文件";
        if (code.contains("delete_file")) return "删除文件";
        if (code.contains("move_file")) return "移动文件";
        
        // Python 工具
        if (code.contains("run_python")) return "执行Python代码";
        
        // 知识库工具
        if (code.contains("add_memory")) return "添加记忆";
        if (code.contains("query_knowledge_base")) return "查询知识库";
        
        return "工具执行";
    }
    private String parseToolName(String code) {
        if (code == null) return "";
        // e.g., my_plugin.my_tool(arg=...) -> my_tool
        // or my_tool(arg=...) -> my_tool
        int dot = code.indexOf('.');
        int paren = code.indexOf('(');
        if (paren == -1) return code.trim();
        
        if (dot != -1 && dot < paren) {
            return code.substring(dot + 1, paren).trim();
        }
        return code.substring(0, paren).trim();
    }

    private String extractArgsAsJson(String code) {
        // Very basic: convert method(k1="v1", k2="v2") to {"k1":"v1", "k2":"v2"}
        // This is a naive implementation for the prototype.
        try {
            int start = code.indexOf('(');
            int end = code.lastIndexOf(')');
            if (start == -1 || end == -1 || end <= start) return "{}";
            
            String argsStr = code.substring(start + 1, end).trim();
            if (argsStr.isEmpty()) return "{}";
            
            cn.hutool.json.JSONObject json = new cn.hutool.json.JSONObject();
            // Splitting by comma is tricky with values containing commas. 
            // For now, assume simple args or use regex.
            java.util.regex.Pattern p = java.util.regex.Pattern.compile("(\\w+)\\s*=\\s*\"([^\"]*)\"");
            java.util.regex.Matcher m = p.matcher(argsStr);
            while (m.find()) {
                json.set(m.group(1), m.group(2));
            }
            return json.toString();
        } catch (Exception e) {
            return "{}";
        }
    }
}
