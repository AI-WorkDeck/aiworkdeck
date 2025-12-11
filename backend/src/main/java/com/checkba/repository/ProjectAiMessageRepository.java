package com.checkba.repository;

import com.checkba.model.entity.ProjectAiMessage;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface ProjectAiMessageRepository extends JpaRepository<ProjectAiMessage, Long> {

    List<ProjectAiMessage> findByProjectIdOrderByCreatedAtAsc(Long projectId);
}


