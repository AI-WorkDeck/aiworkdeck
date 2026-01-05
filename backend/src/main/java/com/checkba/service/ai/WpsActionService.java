package com.checkba.service.ai;

import com.checkba.model.entity.ProjectFile;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

/**
 * WPS 操作服务
 * 
 * 负责：
 * 1. 发送 WPS 操作指令到前端（通过 SSE client_action）
 * 2. 管理请求 ID 与 CompletableFuture 的映射
 * 3. 接收前端执行结果并解锁等待的工具调用
 * 
 * 工作流程：
 * 1. Agent 调用 WPS 工具 -> WpsTools 调用 executeWpsCommand
 * 2. WpsActionService 生成 requestId，发送 SSE 事件，创建 CompletableFuture
 * 3. 前端执行操作后调用 /api/ai/agent/wps-result 返回结果
 * 4. WpsResultController 调用 completeWpsAction 解锁 CompletableFuture
 * 5. executeWpsCommand 获取结果并返回给 WpsTools
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class WpsActionService {

    private final SseEmitterService sseEmitterService;
    private final ObjectMapper objectMapper;

    // 请求 ID -> CompletableFuture 的映射
    private final ConcurrentHashMap<String, CompletableFuture<WpsActionResult>> pendingRequests = new ConcurrentHashMap<>();
    
    // 当前活跃的 conversationId（由 AgentOrchestrator 设置）
    private final ThreadLocal<String> currentConversationId = new ThreadLocal<>();
    
    // WPS 操作超时时间（秒）
    private static final int WPS_ACTION_TIMEOUT = 30;

    /**
     * 设置当前会话 ID（由 AgentOrchestrator 在执行工具前调用）
     */
    public void setCurrentConversationId(String conversationId) {
        currentConversationId.set(conversationId);
    }

    /**
     * 获取当前会话 ID
     */
    public String getCurrentConversationId() {
        return currentConversationId.get();
    }

    /**
     * 发送打开文件的 SSE 事件到前端
     * 这是一个单向操作，不需要等待结果
     */
    public void sendOpenFileAction(ProjectFile file) {
        String conversationId = currentConversationId.get();
        if (conversationId == null) {
            log.warn("No conversation ID set, cannot send open file action");
            return;
        }

        try {
            String payload = objectMapper.writeValueAsString(Map.of(
                    "action", "wps_open_file",
                    "fileId", file.getId(),
                    "fileName", file.getName(),
                    "fileType", file.getFileType(),
                    "wpsFileId", file.getWpsFileId() != null ? file.getWpsFileId() : "",
                    "trackRevisions", true,
                    "userName", "King IDE"
            ));
            
            sseEmitterService.send(conversationId, "client_action", payload);
            log.info("Sent wps_open_file action for file: {} (id={})", file.getName(), file.getId());
            
        } catch (Exception e) {
            log.error("Failed to send open file action", e);
        }
    }

    /**
     * 发送重新加载文件的 SSE 事件到前端
     * 用于在后端修改文件后通知前端 WPS 刷新
     */
    public void sendReloadFileAction(ProjectFile file) {
        String conversationId = currentConversationId.get();
        if (conversationId == null) {
            log.warn("No conversation ID set, cannot send reload file action");
            return;
        }

        try {
            String payload = objectMapper.writeValueAsString(Map.of(
                    "action", "wps_reload_file",
                    "fileId", file.getId(),
                    "fileName", file.getName(),
                    "fileType", file.getFileType(),
                    "wpsFileId", file.getWpsFileId() != null ? file.getWpsFileId() : ""
            ));
            
            sseEmitterService.send(conversationId, "client_action", payload);
            log.info("Sent wps_reload_file action for file: {} (id={})", file.getName(), file.getId());
            
        } catch (Exception e) {
            log.error("Failed to send reload file action", e);
        }
    }

    /**
     * 发送刷新文件树的 SSE 事件到前端
     */
    public void sendRefreshFilesAction() {
        String conversationId = currentConversationId.get();
        if (conversationId == null) {
            log.warn("No conversation ID set, cannot send refresh files action");
            return;
        }

        try {
            String payload = objectMapper.writeValueAsString(Map.of(
                    "action", "refresh_files"
            ));
            
            sseEmitterService.send(conversationId, "client_action", payload);
            log.info("Sent refresh_files action");
            
        } catch (Exception e) {
            log.error("Failed to send refresh files action", e);
        }
    }

    /**
     * 发送 PPT 生成配置请求到前端 (UI Interceptor)
     */
    public void sendPptConfigAction(Map<String, Object> configParams) {
        String conversationId = currentConversationId.get();
        if (conversationId == null) {
            log.warn("No conversation ID set, cannot send ppt config action");
            return;
        }

        try {
            // Append action type
            java.util.Map<String, Object> payloadMap = new java.util.HashMap<>(configParams);
            payloadMap.put("action", "ppt_config_required");
            
            String payload = objectMapper.writeValueAsString(payloadMap);
            
            sseEmitterService.send(conversationId, "client_action", payload);
            log.info("Sent ppt_config_required action");
            
        } catch (Exception e) {
            log.error("Failed to send ppt config action", e);
        }
    }

    /**
     * 执行 WPS 命令并等待结果
     * 
     * @param action 操作类型（如 get_selection, find_replace 等）
     * @param params 操作参数
     * @return 执行结果的 JSON 字符串
     */
    public String executeWpsCommand(String action, Map<String, Object> params) {
        String conversationId = currentConversationId.get();
        if (conversationId == null) {
            return "{\"error\": \"No active conversation. Please ensure a document is open.\"}";
        }

        String requestId = UUID.randomUUID().toString();
        CompletableFuture<WpsActionResult> future = new CompletableFuture<>();
        pendingRequests.put(requestId, future);

        try {
            // 构建并发送 SSE 事件
            String payload = objectMapper.writeValueAsString(Map.of(
                    "tool", "wps_command",
                    "action", action,
                    "params", params != null ? params : Map.of(),
                    "requestId", requestId,
                    "conversationId", conversationId
            ));
            
            sseEmitterService.send(conversationId, "client_action", payload);
            log.info("Sent WPS command: action={}, requestId={}", action, requestId);

            // 等待前端执行结果
            WpsActionResult result = future.get(WPS_ACTION_TIMEOUT, TimeUnit.SECONDS);
            
            if (result.isSuccess()) {
                return objectMapper.writeValueAsString(result.getData());
            } else {
                return "{\"error\": \"" + result.getError() + "\"}";
            }

        } catch (TimeoutException e) {
            log.warn("WPS command timed out: action={}, requestId={}", action, requestId);
            return "{\"error\": \"操作超时。请确保 WPS 编辑器已打开并可用。\"}";
            
        } catch (Exception e) {
            log.error("Failed to execute WPS command: action={}", action, e);
            return "{\"error\": \"" + e.getMessage() + "\"}";
            
        } finally {
            pendingRequests.remove(requestId);
        }
    }

    /**
     * 完成 WPS 操作（由 WpsResultController 调用）
     * 
     * @param requestId 请求 ID
     * @param success 是否成功
     * @param data 结果数据
     * @param error 错误信息
     */
    public void completeWpsAction(String requestId, boolean success, Object data, String error) {
        CompletableFuture<WpsActionResult> future = pendingRequests.get(requestId);
        if (future != null) {
            future.complete(new WpsActionResult(success, data, error));
            log.info("Completed WPS action: requestId={}, success={}", requestId, success);
        } else {
            log.warn("No pending request found for requestId={}", requestId);
        }
    }

    /**
     * WPS 操作结果
     */
    public static class WpsActionResult {
        private final boolean success;
        private final Object data;
        private final String error;

        public WpsActionResult(boolean success, Object data, String error) {
            this.success = success;
            this.data = data;
            this.error = error;
        }

        public boolean isSuccess() {
            return success;
        }

        public Object getData() {
            return data;
        }

        public String getError() {
            return error;
        }
    }
}

