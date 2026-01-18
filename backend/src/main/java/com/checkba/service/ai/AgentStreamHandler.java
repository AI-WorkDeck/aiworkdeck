package com.checkba.service.ai;

import dev.langchain4j.model.output.Response;
import dev.langchain4j.model.StreamingResponseHandler;
import dev.langchain4j.data.message.AiMessage;

import java.util.UUID;

/**
 * 负责将 LLM 的流式回调转换为前端 SSE 协议事件。
 * 并收集最终完整的回复用于存储和计费。
 */
public class AgentStreamHandler implements StreamingResponseHandler<AiMessage> {

    private static final org.slf4j.Logger log = org.slf4j.LoggerFactory.getLogger(AgentStreamHandler.class);

    private final SseEmitterService sseEmitterService;
    private final String conversationId;
    private final TokenUsageService tokenUsageService;
    private final String projectId;
    private final Long userId;
    private final String modelId;

    private final StringBuilder fullContentBuilder = new StringBuilder();
    private boolean isBubbleStarted = false;
    private String currentBubbleId;

    private final StringBuilder buffer = new StringBuilder();

    private static final int MAX_BUFFER_SIZE = 50; // Buffer for XML tag detection

    public AgentStreamHandler(SseEmitterService sseEmitterService, String conversationId, TokenUsageService tokenUsageService, String projectId, Long userId, String modelId) {
        this.sseEmitterService = sseEmitterService;
        this.conversationId = conversationId;
        this.tokenUsageService = tokenUsageService;
        this.projectId = projectId;
        this.userId = userId;
        this.modelId = modelId;
    }

    // Callback for each token generated (for real-time tracking)
    private java.util.function.Consumer<String> onToken;

    public void setOnToken(java.util.function.Consumer<String> onToken) {
        this.onToken = onToken;
    }

    @Override
    public void onNext(String token) {
        log.trace("Token for {}: [{}]", conversationId, token);
        if (token != null) {
            // Notify token callback for real-time state tracking
            if (onToken != null) {
                onToken.accept(token);
            }
            
            processBuffer(token);
        }
    }
    
    private void processBuffer(String token) {
        // Accumulate full response for final saving
        fullContentBuilder.append(token);
        
        buffer.append(token);
        
        String content = buffer.toString();
        
        // 1. Check for complete <bubble_type ... /> tag
        if (content.contains("<bubble_type")) {
             int start = content.indexOf("<bubble_type");
             int end = content.indexOf("/>", start);
             
             if (end != -1) {
                  // Captured full tag
                  String tag = content.substring(start, end + 2);
                  
                  // Extract mode
                  String mode = "chat"; 
                  if (tag.contains("mode=\"execution\"")) mode = "execution";
                  else if (tag.contains("mode=\"plan\"")) mode = "plan";
                  else if (tag.contains("mode=\"chat\"")) mode = "chat";
                  
                  if (!isBubbleStarted) {
                      startBubble(mode);
                  }
                  
                  // Flush content BEFORE the tag if any
                  if (start > 0) {
                      emitText(content.substring(0, start));
                  }
                  
                  // Remove tag from buffer
                  buffer.delete(0, end + 2);
                  
                  // Flush remainder immediately
                  if (buffer.length() > 0) {
                      emitText(buffer.toString());
                      buffer.setLength(0);
                  }
                  return;
             }
        }
        
        // 2. Check for complete <artifact ...>...</artifact> tag
        // We need to support content inside artifact, so it has start and end tag
        if (content.contains("<artifact") && content.contains("</artifact>")) {
             int start = content.indexOf("<artifact");
             int end = content.indexOf("</artifact>", start);
             
             if (end != -1) {
                  // Captured full artifact block
                  int endTagLen = 11; // </artifact>
                  String rawArtifact = content.substring(start, end + endTagLen);
                  
                  // Parse type
                  // <artifact type="task_list">...</artifact>
                  String type = "task_list"; // default
                  int typeStart = rawArtifact.indexOf("type=\"");
                  if (typeStart != -1) {
                      int typeEnd = rawArtifact.indexOf("\"", typeStart + 6);
                      if (typeEnd != -1) {
                          type = rawArtifact.substring(typeStart + 6, typeEnd);
                      }
                  }
                  
                  // Extract content
                  // Find end of opening tag
                  int openTagEnd = rawArtifact.indexOf(">");
                  String innerContent = "";
                  if (openTagEnd != -1) {
                       innerContent = rawArtifact.substring(openTagEnd + 1, rawArtifact.length() - endTagLen);
                  }
                  
                  // Emit Artifact Event
                  // We treat this as a "create" operation
                  String artifactId = UUID.randomUUID().toString();
                  // Clean content a bit? keep newlines
                  String jsonContent = escapeJson(innerContent);
                  
                  // Spec v1.7 Artifact Event Structure
                  String artifactEvent = String.format(
                      "{\"operation\":\"create\", \"id\":\"%s\", \"type\":\"%s\", \"status\":\"draft\", \"data\":{\"content\":\"%s\"}}",
                      artifactId, type, jsonContent
                  );
                  sseEmitterService.send(conversationId, "artifact", artifactEvent);
                  
                  // Flush text before artifact
                  if (start > 0) emitText(content.substring(0, start));
                  
                  // Remove artifact from buffer
                  buffer.delete(0, end + endTagLen);
                  
                  // Flush remainder
                  if (buffer.length() > 0) {
                      emitText(buffer.toString());
                      buffer.setLength(0);
                  }
                  return;
             }
        }

        // 3. Check for potential start of ANY tag (<)
        int firstLT = buffer.indexOf("<");
        
        if (firstLT == -1) {
            // No tag start present. Safe to flush EVERYTHING.
            if (!isBubbleStarted) startBubble("chat");
            emitText(buffer.toString());
            buffer.setLength(0);
            return;
        }
        
        // 4. Flush text before tag
        if (firstLT > 0) {
            if (!isBubbleStarted) startBubble("chat");
            emitText(buffer.substring(0, firstLT));
            buffer.delete(0, firstLT);
            // Buffer now starts with '<'
        }
        
        // 5. Buffer starts with <. Check if it matches known prefixes.
        String currentBuffer = buffer.toString();
        boolean potentialMatch = false;
        
        // Check alignment with <bubble_type
        if (checkPrefix(currentBuffer, "<bubble_type")) potentialMatch = true;
        // Check alignment with <artifact
        else if (checkPrefix(currentBuffer, "<artifact")) potentialMatch = true;
        // Check alignment with </artifact (if split across chunks)
        else if (checkPrefix(currentBuffer, "</artifact")) potentialMatch = true;
        
        if (!potentialMatch) {
            // Not a control tag, just text (e.g. <div>)
            if (!isBubbleStarted) startBubble("chat");
            emitText(currentBuffer);
            buffer.setLength(0);
            return;
        }

        // 6. It matches a prefix. Wait for more data?
        // If buffer is too huge, we might have to flush even if incomplete to avoid OOM or hang
        // Artifacts can be large, so we might need a larger buffer OR a streaming state machine for artifacts.
        // For now, let's bump buffer size just for artifacts or assume they fit in memory? 
        // Actually, if artifact is huge, waiting for </artifact> in a single String buffer is risky.
        // But user asked for "show TDlist", usually small. 
        // Let's cap at larger limit (e.g. 2KB) or implement streaming artifact?
        // For MVP, lets just bump header buffer detection to 50, but we allow buffer to grow for artifact?
        // Risky. But let's keep it simple for now as requested.
        
        if (buffer.length() > 2000) {
             // Too large, probably not a control tag or we can't buffer it all. Flush.
             if (!isBubbleStarted) startBubble("chat");
             emitText(buffer.toString());
             // We lost the parsing capability for this large chunk, but avoided crash.
             buffer.setLength(0); 
        }
    }
    
    private boolean checkPrefix(String buffer, String prefix) {
        int len = Math.min(buffer.length(), prefix.length());
        return buffer.substring(0, len).equals(prefix.substring(0, len));
    }

    private void emitText(String text) {
        if (text == null || text.isEmpty()) return;
        sseEmitterService.send(conversationId, "text_delta", "{\"content\":\"" + escapeJson(text) + "\"}");
    }

    @Override
    public void onComplete(Response<AiMessage> response) {
        // Flush remaining buffer
        if (buffer.length() > 0) {
            emitText(buffer.toString());
        }
        
        // Emit Token Usage to Frontend
        if (response.tokenUsage() != null) {
            dev.langchain4j.model.output.TokenUsage usage = response.tokenUsage();
            int promptTokens = usage.inputTokenCount() != null ? usage.inputTokenCount() : 0;
            int completionTokens = usage.outputTokenCount() != null ? usage.outputTokenCount() : 0;
            int totalTokens = usage.totalTokenCount() != null ? usage.totalTokenCount() : (promptTokens + completionTokens);
            
            String usageJson = String.format(
                "{\"promptTokens\":%d,\"completionTokens\":%d,\"totalTokens\":%d}",
                promptTokens, completionTokens, totalTokens
            );
            sseEmitterService.send(conversationId, "token_usage", usageJson);
        }
        
        // Record Usage
        if (response.tokenUsage() != null) {
            tokenUsageService.recordUsage(
                Long.parseLong(projectId), userId, modelId, response.tokenUsage(), conversationId
            );
        }
        
        // Callback if supplied (for Loop)
        // 注意：如果有回调，说明可能还有后续循环（工具调用），不要在这里发送 bubble_end
        // bubble_end 应该在整个循环真正结束时由 AgentOrchestrator 发送
        if (onCompleteCallback != null) {
            log.info("Response completed for {}. Full content:\n{}", conversationId, fullContentBuilder.toString());
            onCompleteCallback.accept(response);
        } else {
            // 没有回调，说明是简单的单次响应，发送 bubble_end
            sseEmitterService.send(conversationId, "bubble_end", "{\"status\":\"finished\"}");
        }
    }
    
    // Callback Interface
    private java.util.function.Consumer<Response<AiMessage>> onCompleteCallback;
    public void setOnComplete(java.util.function.Consumer<Response<AiMessage>> callback) {
        this.onCompleteCallback = callback;
    }

    @Override
    public void onError(Throwable error) {
        log.error("Stream error for {}", conversationId, error);
        sseEmitterService.send(conversationId, "error", "Stream Error: " + error.getMessage());
    }
    
    private void startBubble(String type) {
        this.isBubbleStarted = true;
        this.currentBubbleId = UUID.randomUUID().toString();
        // Send bubble_start
        sseEmitterService.send(conversationId, "bubble_start", "{\"bubbleId\":\"" + currentBubbleId + "\", \"type\":\"" + type + "\"}");
    }
    
    private String escapeJson(String raw) {
        if (raw == null) return "";
        return raw.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n").replace("\r", "\\r");
    }
}
