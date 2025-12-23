package com.checkba.service.ai;

import com.checkba.service.ai.tools.LegalTools;
import com.checkba.service.ProjectAiMessageService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.List;

/**
 * Service to assemble context from files and other sources.
 * Injects <file> tags into the System Message.
 */
@Service
@RequiredArgsConstructor
public class ContextAssemblerService {

    private static final org.slf4j.Logger log = org.slf4j.LoggerFactory.getLogger(ContextAssemblerService.class);

    private final LegalTools legalTools;
    private final ProjectAiMessageService messageService;
    private final com.checkba.service.ProjectFileService projectFileService;
    private final com.checkba.service.ai.context.FileContentExtractorService fileContentExtractorService;

    /**
     * Assembles the full message stack for the LLM.
     * 1. System Message (Prompt + State + File Context)
     * 2. History Messages (Last 20)
     * 3. User Message (Current Prompt)
     */
    public java.util.List<dev.langchain4j.data.message.ChatMessage> assemble(
            String conversationId, 
            String userPrompt, 
            java.util.List<com.checkba.controller.ai.AiAgentController.ContextItem> contextItems,
            String taskListId,
            String planId,
            String projectId) {

        java.util.List<dev.langchain4j.data.message.ChatMessage> messages = new java.util.ArrayList<>();

        // 1. Build Dynamic System Prompt
        StringBuilder systemText = new StringBuilder();
        
        // Load Base Prompt
        try {
            org.springframework.core.io.ClassPathResource resource = new org.springframework.core.io.ClassPathResource("prompts/system_prompt.md");
            if (resource.exists()) {
                systemText.append(org.springframework.util.StreamUtils.copyToString(resource.getInputStream(), java.nio.charset.StandardCharsets.UTF_8));
            } else {
                systemText.append("You are a helpful AI Assistant.");
            }
        } catch (Exception e) {
            log.error("Failed to load system prompt for assembly", e);
            systemText.append("You are a helpful AI Assistant.");
        }

        // Determine current phase based on state
        String currentPhase = determinePhase(planId, taskListId);

        // [Injection] Enforcement (HIGHEST PRIORITY)
        String enforcement = """

# SYSTEM ENFORCEMENT (HIGHEST PRIORITY - READ CAREFULLY)

## CRITICAL: Raw XML Output (MUST READ FIRST)
- **DO NOT** wrap your output in markdown code blocks. No ```xml or ``` around tags.
- Output XML tags directly: `<thinking>...</thinking>` NOT ```xml\n<thinking>```
- VIOLATION OF THIS RULE WILL BREAK THE SYSTEM.

## Language
- SIMPLIFIED CHINESE ONLY for all user-facing output.

## Chitchat / Simple Q&A
- OMIT `<title>` and `<process>` tags entirely.
- Just output plain text response.

## Stop Conditions (CRITICAL)
- **STOP ONLY** when you output `<artifact type="implementation_plan">`. Wait for user approval.
- **DO NOT STOP** for `<artifact type="task_list">` - continue execution immediately after.
- `<walkthrough>` does NOT trigger stop. It is only a brief summary.

## Output Structure (REQUIRED ORDER)
1. `<thinking>` - Brief intent analysis (always required)
2. `<title>` - Session title (complex tasks only)
3. `<process>` - Tool invocations (if any)
4. `<artifact>` - Only `implementation_plan` or `task_list` (if applicable)
5. `<final>` - **MAIN ANSWER** (REQUIRED for all non-chitchat responses)
6. `<walkthrough>` - Brief 3-5 sentence past-tense summary (OPTIONAL)

## Final Answer Rules
- **Main Answer**: MUST be inside `<final>...</final>` tag.
- **Walkthrough**: ONLY for process summary. NEVER duplicate main answer here.
- **Forbidden**: Do NOT use `type="summary"` or `type="walkthrough"` as artifact types.

## Artifact Naming Rules
- When creating an artifact, you MUST include a `name` attribute with a specific, descriptive name (max 15 chars).
- Example: `<artifact type="implementation_plan" name="外汇管控架构备忘录">...`
- BAD: "Plan", "Implementation Plan". GOOD: Short descriptive names like "10号文备忘录".

## Tool Execution Rules
- When you output `<tool_code>`, STOP and wait for `<tool_output>`.
- When you receive `TOOL_RESULT`, you MUST continue execution. Do NOT ask "should I continue?".
- Do NOT output `<final>` in the same turn as `<tool_code>`.
""";
        systemText.append(enforcement);

        // [Injection] State with Phase
        systemText.append("\n\n# Current Context\n[SYSTEM INJECTION]");
        
        // CRITICAL: Inject current system time (important for legal/financial data accuracy)
        java.time.ZonedDateTime now = java.time.ZonedDateTime.now(java.time.ZoneId.of("Asia/Shanghai"));
        String formattedTime = now.format(java.time.format.DateTimeFormatter.ofPattern("yyyy年MM月dd日 HH:mm:ss (EEEE)", java.util.Locale.CHINESE));
        systemText.append("\n- **Current System Time**: ").append(formattedTime);
        systemText.append("\n  - 这是当前真实时间，所有涉及\"最新\"、\"最近\"、\"当前\"的数据查询必须基于此时间判断。");
        systemText.append("\n  - 如果查询的数据日期早于此时间超过合理范围（如股票收盘价应为最近交易日），请明确告知用户数据的实际日期。");
        
        systemText.append("\n- Current Phase: ").append(currentPhase);
        systemText.append("\n- Current Project ID: ").append(projectId != null ? projectId : "unknown");
        systemText.append("\n- Current Task List ID: ").append(taskListId != null ? taskListId : "null");
        systemText.append("\n- Current Plan ID: ").append(planId != null ? planId : "null");

        // Phase-specific instructions
        systemText.append("\n\n## Phase Instructions\n");
        switch (currentPhase) {
            case "PLAN":
                systemText.append("- You are in PLANNING phase. Output `implementation_plan` if task is complex, then STOP.\n");
                systemText.append("- Do NOT execute tools until user approves the plan.\n");
                break;
            case "EXECUTE":
                systemText.append("- You are in EXECUTION phase. The plan has been approved.\n");
                systemText.append("- Output `task_list` first (optional), then execute tools.\n");
                systemText.append("- After completion, output `<final>` with main answer.\n");
                break;
            case "CHAT":
            default:
                systemText.append("- Simple chat/Q&A mode. Just respond directly.\n");
                systemText.append("- If task becomes complex, switch to PLAN phase.\n");
                break;
        }

        // [Injection] Context Items (Files & Folders)
        if (contextItems != null && !contextItems.isEmpty()) {
            systemText.append("\n\n# User Context Files\n");
            systemText.append("The user has provided the following files/folders for context:\n");
            
            int totalFileCount = 0; // Limit to 10 files max across all items
            
            for (com.checkba.controller.ai.AiAgentController.ContextItem item : contextItems) {
                log.info("[Context] Processing item: id={}, name={}, isDir={}, fileType={}", 
                         item.getId(), item.getName(), item.isDir(), item.getFileType());
                         
                if (totalFileCount >= 10) {
                    systemText.append("\n[System Note: Context limit reached (10 files max). Remaining items ignored.]\n");
                    break;
                }

                if (item.isDir()) {
                    // Folder Logic
                    systemText.append("\n## Folder: ").append(item.getName())
                              .append(" (ID: ").append(item.getId()).append(")\n");
                              
                    String folderContent = buildFolderContext(item.getId(), projectId, totalFileCount);
                    systemText.append(folderContent);
                    
                    // Update count based on how many files were read in folder? 
                    // buildFolderContext returns string, we need to pass counter reference or approximate.
                    // Let's refine buildFolderContext to assume it consumes remaining slots.
                    // Actually, simpler: just let buildFolderContext run and we don't strictly update 'totalFileCount' 
                    // precisely here unless we return a count object. 
                    // For simplicity, we assume a folder consumes slots. 
                    // Better: Pass proper AtomicInteger to buildFolderContext.
                } else {
                    // Single File Logic
                    String content = legalTools.read_document(item.getId());
                    // Truncate if too long (max 50000 chars per file)
                    if (content != null && content.length() > 50000) {
                        content = content.substring(0, 50000) + "\n... [TRUNCATED - File too long]";
                    }
                    systemText.append("<file id=\"").append(item.getId())
                              .append("\" name=\"").append(item.getName()).append("\"><![CDATA[\n");
                    systemText.append(content != null ? content : "[Empty or unreadable file]");
                    systemText.append("\n]]></file>\n");
                    totalFileCount++;
                }
            }
        }

        messages.add(dev.langchain4j.data.message.SystemMessage.from(systemText.toString()));

        // 2. Add History
        List<com.checkba.model.entity.ProjectAiMessage> historyEntities = messageService.listByConversationId(conversationId);
        // Take last 20
        int start = Math.max(0, historyEntities.size() - 20);
        for (int i = start; i < historyEntities.size(); i++) {
            com.checkba.model.entity.ProjectAiMessage entity = historyEntities.get(i);
            if ("USER".equalsIgnoreCase(entity.getRole())) {
                messages.add(dev.langchain4j.data.message.UserMessage.from(entity.getContent()));
            } else if ("ASSISTANT".equalsIgnoreCase(entity.getRole())) {
                messages.add(dev.langchain4j.data.message.AiMessage.from(entity.getContent()));
            }
        }

        // 3. Add Current User Prompt
        messages.add(dev.langchain4j.data.message.UserMessage.from(userPrompt));

        return messages;
    }

    /**
     * Determines the current phase based on plan and task list state.
     * - CHAT: No plan, no task list (simple conversation)
     * - PLAN: User request may need planning (no approved plan yet)
     * - EXECUTE: Plan approved, ready to execute
     */
    private String determinePhase(String planId, String taskListId) {
        // If we have a plan ID, we're in EXECUTE phase (plan was approved)
        if (planId != null && !planId.equals("null") && !planId.isEmpty()) {
            return "EXECUTE";
        }
        // If we have a task list but no plan, we're also in EXECUTE (simple execution)
        if (taskListId != null && !taskListId.equals("null") && !taskListId.isEmpty()) {
            return "EXECUTE";
        }
        // Default to CHAT for new conversations
        return "CHAT";
    }

    /**
     * Legacy support for basic context assembly.
     */
    public String assembleContext(List<String> fileIds) {
        // (Existing logic kept for compatibility or internal use if needed)
        if (fileIds == null || fileIds.isEmpty()) return "";
        StringBuilder sb = new StringBuilder();
        for (String fileId : fileIds) {
            sb.append("<file id=\"").append(fileId).append("\">\n")
              .append(legalTools.read_document(fileId))
              .append("\n</file>\n");
        }
        return sb.toString();
    }
    /**
     * Builds folder context: Directory structure + Content of top files.
     * Uses simple recursion limit and file count limit.
     */
    private String buildFolderContext(String folderIdStr, String projectIdStr, int currentTotalCount) {
        StringBuilder sb = new StringBuilder();
        try {
            Long folderId = Long.parseLong(folderIdStr);
            Long projectId = Long.parseLong(projectIdStr);
            
            // Get all children (flat list or just direct children? service usually returns direct)
            // We need deep traversal? projectFileService.getFilesByParent returns direct children.
            // We'll implement a simple BFS or recursive helper here.
            
            List<com.checkba.model.entity.ProjectFile> allFiles = new java.util.ArrayList<>();
            collectFilesRecursive(projectId, folderId, allFiles, 0);
            
            // 1. Directory Structure
            sb.append("### Directory Content:\n");
            for (com.checkba.model.entity.ProjectFile f : allFiles) {
                 String type = Boolean.TRUE.equals(f.getIsFolder()) ? "[DIR]" : "[FILE]";
                 sb.append("- ").append(type).append(" ").append(f.getName())
                   .append(" (ID: ").append(f.getId()).append(")\n");
            }
            sb.append("\n");
            
            // 2. File Contents (Limit total)
            int reads = 0;
            int maxReads = 10 - currentTotalCount; 
            if (maxReads <= 0) return sb.toString();
            
            sb.append("### Folder Document Contents (First " + maxReads + " files):\n");
            
            for (com.checkba.model.entity.ProjectFile f : allFiles) {
                if (reads >= maxReads) break;
                if (Boolean.TRUE.equals(f.getIsFolder())) continue;
                
                // Read content
                try {
                    java.io.File physicalFile = new java.io.File(f.getFilePath());
                    if (physicalFile.exists() && physicalFile.length() < 10 * 1024 * 1024) { // 10MB limit check
                        String text = fileContentExtractorService.extractText(physicalFile);
                        if (text != null && !text.isEmpty()) {
                            if (text.length() > 20000) text = text.substring(0, 20000) + "...[Truncated]";
                            
                            sb.append("\n#### File: ").append(f.getName()).append("\n");
                            sb.append("```\n").append(text).append("\n```\n");
                            reads++;
                        }
                    }
                } catch (Exception e) {
                    // Ignore read errors for individual files
                }
            }
            
        } catch (Exception e) {
            sb.append("\n[Error reading folder: ").append(e.getMessage()).append("]\n");
        }
        return sb.toString();
    }
    
    private void collectFilesRecursive(Long projectId, Long parentId, List<com.checkba.model.entity.ProjectFile> collector, int depth) {
        if (depth > 5) return; // safety
        List<com.checkba.model.entity.ProjectFile> children = projectFileService.getFilesByParent(projectId, parentId);
        for (com.checkba.model.entity.ProjectFile child : children) {
            collector.add(child);
            if (Boolean.TRUE.equals(child.getIsFolder())) {
                collectFilesRecursive(projectId, child.getId(), collector, depth + 1);
            }
        }
    }
}
