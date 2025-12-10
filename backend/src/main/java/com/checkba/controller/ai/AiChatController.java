package com.checkba.controller.ai;

import com.checkba.service.ai.ProjectAssistant;
import com.checkba.service.ai.context.ProjectContextHolder;
import lombok.Data;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.web.bind.annotation.*;

@Slf4j
@RestController
@RequestMapping("/api/ai")
@RequiredArgsConstructor
public class AiChatController {

    private final ProjectAssistant projectAssistant;

    @PostMapping("/chat")
    public AiChatResponse chat(@RequestBody AiChatRequest request) {
        log.info("Received AI chat request for project {}: {}", request.getProjectId(), request.getMessage());
        try {
            ProjectContextHolder.setProjectId(request.getProjectId());
            String response = projectAssistant.chat(request.getMessage());
            return new AiChatResponse(response);
        } catch (Exception e) {
            log.error("Error during AI chat", e);
            return new AiChatResponse("Sorry, I encountered an error: " + e.getMessage());
        } finally {
            ProjectContextHolder.clear();
        }
    }
    
    @Data
    public static class AiChatRequest {
        private String projectId;
        private String message;
    }
    
    @Data
    public static class AiChatResponse {
        private String response;
        public AiChatResponse(String response) { this.response = response; }
    }
}

