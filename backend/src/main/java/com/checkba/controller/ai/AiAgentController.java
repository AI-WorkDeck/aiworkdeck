package com.checkba.controller.ai;

import com.checkba.controller.AuthController;
import com.checkba.service.ai.SseEmitterService;
import com.checkba.service.ai.AgentOrchestrator;
import lombok.Data;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

/**
 * 核心 Agent 控制器 (v2)。
 * 取代旧的 AiChatController，使用 SSE 进行全双工（逻辑上）通信。
 */
@RestController
@RequestMapping("/api/agent")
public class AiAgentController {

    private static final org.slf4j.Logger log = org.slf4j.LoggerFactory.getLogger(AiAgentController.class);

    private final SseEmitterService sseEmitterService;
    private final AgentOrchestrator agentOrchestrator;
    private final com.checkba.service.ProjectAiMessageService messageService;

    @org.springframework.beans.factory.annotation.Autowired
    public AiAgentController(SseEmitterService sseEmitterService, AgentOrchestrator agentOrchestrator, com.checkba.service.ProjectAiMessageService messageService) {
        this.sseEmitterService = sseEmitterService;
        this.agentOrchestrator = agentOrchestrator;
        this.messageService = messageService;
    } 

    /**
     * 建立 SSE 连接。
     * 前端应在进入聊天界面时调用此接口。
     */
    @GetMapping(value = "/connect/{conversationId}", produces = "text/event-stream")
    public SseEmitter connect(@PathVariable String conversationId, 
                              @RequestHeader(value = "X-Session-Id", required = false) String sessionId) {
        // Validate user if needed
        Long userId = AuthController.getUserIdFromSession(sessionId); // Optional validation
        
        log.info("Client connecting to SSE: conversationId={}, userId={}", conversationId, userId);
        return sseEmitterService.createConnection(conversationId);
    }

    /**
     * 发送用户消息 (触发 Agent 思考)。
     * 这是一个异步接口，立刻返回 200 OK，后续通过 SSE 推送结果。
     */
    @PostMapping("/chat")
    public ResponseEntity<?> startSession(@RequestBody AgentChatRequest request,
                                          @RequestHeader(value = "X-Session-Id", required = false) String sessionId) {
        Long userId = null;
        if (sessionId != null) {
            userId = AuthController.getUserIdFromSession(sessionId);
        }
        
        log.info("Received Agent Chat Request: project={}, conversation={}, msg={}", 
                request.getProjectId(), request.getConversationId(), request.getMessage());

        agentOrchestrator.handleUserMessage(request, userId);
        
        return ResponseEntity.ok().build();
    }

    /**
     * Rollback history to a specific message.
     * Everything after this message will be deleted.
     */
    @PostMapping("/history/rollback")
    public ResponseEntity<?> rollbackHistory(@RequestBody RollbackRequest request,
                                             @RequestHeader(value = "X-Session-Id", required = false) String sessionId) {
        Long userId = null;
        if (sessionId != null) {
            userId = AuthController.getUserIdFromSession(sessionId);
        }
        log.info("Rollback request: conv={}, msgId={}, user={}", request.getConversationId(), request.getMessageId(), userId);
        
        try {
            messageService.truncateHistory(request.getConversationId(), request.getMessageId());
            return ResponseEntity.ok().body("{\"status\":\"ok\", \"message\":\"History rolled back\"}");
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body("{\"status\":\"error\", \"message\":\"" + e.getMessage() + "\"}");
        } catch (Exception e) {
            log.error("Rollback failed", e);
            return ResponseEntity.status(500).body("{\"status\":\"error\", \"message\":\"Internal Error\"}");
        }
    }

    @Data
    public static class RollbackRequest {
        private String conversationId;
        private Long messageId; // The ID of the message to revert TO (keep this one, delete newer)

        public String getConversationId() { return conversationId; }
        public void setConversationId(String conversationId) { this.conversationId = conversationId; }
        public Long getMessageId() { return messageId; }
        public void setMessageId(Long messageId) { this.messageId = messageId; }
    }
    
    public static class AgentChatRequest {
        private Long projectId;
        private String conversationId;
        private String message;
        private String model; // e.g. "anthropic/claude-3.5-sonnet"
        private java.util.List<String> fileIds; // Legacy: Context files to inject 
        private java.util.List<ContextItem> contextItems; // New: Full context metadata

        public Long getProjectId() { return projectId; }
        public void setProjectId(Long projectId) { this.projectId = projectId; }
        public String getConversationId() { return conversationId; }
        public void setConversationId(String conversationId) { this.conversationId = conversationId; }
        public String getMessage() { return message; }
        public void setMessage(String message) { this.message = message; }
        public String getModel() { return model; }
        public void setModel(String model) { this.model = model; }
        public java.util.List<String> getFileIds() { return fileIds; }
        public void setFileIds(java.util.List<String> fileIds) { this.fileIds = fileIds; }
        public java.util.List<ContextItem> getContextItems() { return contextItems; }
        public void setContextItems(java.util.List<ContextItem> contextItems) { this.contextItems = contextItems; }
    }
    
    /**
     * Context item representing a file or folder provided by user.
     */
    public static class ContextItem {
        private String id;
        private String name;
        @com.fasterxml.jackson.annotation.JsonProperty("isDir")
        private boolean isDir;
        private String fileType;
        
        public String getId() { return id; }
        public void setId(String id) { this.id = id; }
        public String getName() { return name; }
        public void setName(String name) { this.name = name; }
        @com.fasterxml.jackson.annotation.JsonProperty("isDir")
        public boolean isDir() { return isDir; }
        public void setIsDir(boolean isDir) { this.isDir = isDir; }
        public String getFileType() { return fileType; }
        public void setFileType(String fileType) { this.fileType = fileType; }
    }
}
