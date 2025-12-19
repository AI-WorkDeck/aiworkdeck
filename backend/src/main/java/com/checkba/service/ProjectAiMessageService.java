package com.checkba.service;

import com.checkba.model.entity.ProjectAiMessage;
import com.checkba.repository.ProjectAiMessageRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.List;

@Service
@RequiredArgsConstructor
public class ProjectAiMessageService {

    private final ProjectAiMessageRepository repository;

    public void saveUserAndAssistantMessage(String projectIdStr, Long userId, String conversationId, String userContent, String assistantContent) {
        if (projectIdStr == null) {
            return;
        }
        Long projectId;
        try {
            projectId = Long.parseLong(projectIdStr);
        } catch (NumberFormatException e) {
            return;
        }
        LocalDateTime now = LocalDateTime.now();

        ProjectAiMessage userMsg = new ProjectAiMessage();
        userMsg.setProjectId(projectId);
        userMsg.setUserId(userId);
        userMsg.setRole("USER");
        userMsg.setContent(userContent);
        userMsg.setConversationId(conversationId);
        userMsg.setCreatedAt(now);
        repository.save(userMsg);

        ProjectAiMessage aiMsg = new ProjectAiMessage();
        aiMsg.setProjectId(projectId);
        aiMsg.setUserId(userId);
        aiMsg.setRole("ASSISTANT");
        aiMsg.setContent(assistantContent);
        aiMsg.setConversationId(conversationId);
        aiMsg.setCreatedAt(LocalDateTime.now());
        repository.save(aiMsg);
    }

    // Deprecated or Legacy support
    public void saveUserAndAssistantMessage(String projectIdStr, Long userId, String userContent, String assistantContent) {
        saveUserAndAssistantMessage(projectIdStr, userId, null, userContent, assistantContent);
    }

    public List<ProjectAiMessage> listByProject(Long projectId) {
        return repository.findByProjectIdOrderByCreatedAtAsc(projectId);
    }

    public List<ProjectAiMessage> listByProjectAndUser(Long projectId, Long userId) {
        if (userId == null) {
            return listByProject(projectId);
        }
        return repository.findByProjectIdAndUserIdOrderByCreatedAtAsc(projectId, userId);
    }

    public List<ProjectAiMessage> listByConversationId(String conversationId) {
        return repository.findByConversationIdOrderByCreatedAtAsc(conversationId);
    }

    public List<java.util.Map<String, Object>> listConversations(Long projectId, Long userId) {
        List<Object[]> results = repository.findConversationSummaries(projectId, userId);
        return results.stream()
                .filter(row -> row[0] != null) // Filter out items with null conversationId
                .map(row -> {
                    java.util.Map<String, Object> map = new java.util.HashMap<>();
                    map.put("conversationId", row[0]);
                    map.put("updatedAt", row[1]);
                    map.put("lastMessage", row[2]);
                    return map;
                })
                .collect(java.util.stream.Collectors.toList());
    }
}


