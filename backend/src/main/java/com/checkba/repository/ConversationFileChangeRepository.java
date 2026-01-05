package com.checkba.repository;

import com.checkba.model.entity.ConversationFileChange;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface ConversationFileChangeRepository extends JpaRepository<ConversationFileChange, Long> {
    List<ConversationFileChange> findByConversationId(String conversationId);
}
