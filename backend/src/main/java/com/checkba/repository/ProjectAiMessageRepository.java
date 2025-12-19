package com.checkba.repository;

import com.checkba.model.entity.ProjectAiMessage;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface ProjectAiMessageRepository extends JpaRepository<ProjectAiMessage, Long> {

    List<ProjectAiMessage> findByProjectIdOrderByCreatedAtAsc(Long projectId);

    List<ProjectAiMessage> findByProjectIdAndUserIdOrderByCreatedAtAsc(Long projectId, Long userId);

    List<ProjectAiMessage> findByConversationIdOrderByCreatedAtAsc(String conversationId);

    @org.springframework.data.jpa.repository.Query("SELECT m.conversationId, MAX(m.createdAt), (SELECT m2.content FROM ProjectAiMessage m2 WHERE m2.conversationId = m.conversationId AND m2.createdAt = MAX(m.createdAt)) as lastContent FROM ProjectAiMessage m WHERE m.projectId = :projectId AND m.userId = :userId GROUP BY m.conversationId ORDER BY MAX(m.createdAt) DESC")
    List<Object[]> findConversationSummaries(@org.springframework.data.repository.query.Param("projectId") Long projectId, @org.springframework.data.repository.query.Param("userId") Long userId);
}


