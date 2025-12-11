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

    public void saveUserAndAssistantMessage(String projectIdStr, String userContent, String assistantContent) {
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
        userMsg.setRole("USER");
        userMsg.setContent(userContent);
        userMsg.setCreatedAt(now);
        repository.save(userMsg);

        ProjectAiMessage aiMsg = new ProjectAiMessage();
        aiMsg.setProjectId(projectId);
        aiMsg.setRole("ASSISTANT");
        aiMsg.setContent(assistantContent);
        aiMsg.setCreatedAt(LocalDateTime.now());
        repository.save(aiMsg);
    }

    public List<ProjectAiMessage> listByProject(Long projectId) {
        return repository.findByProjectIdOrderByCreatedAtAsc(projectId);
    }
}


