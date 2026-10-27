// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.repository;

import com.checkba.model.entity.ChatSuggestion;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.transaction.annotation.Transactional;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

public interface ChatSuggestionRepository extends JpaRepository<ChatSuggestion, String> {
    Optional<ChatSuggestion> findFirstByUserIdAndConversationIdAndSourceMessageIdAndModelIdOrderByCreatedAtDesc(
            Long userId, String conversationId, Long sourceMessageId, String modelId);
    List<ChatSuggestion> findTop3ByUserIdAndConversationIdAndOutcomeInOrderByCreatedAtDesc(
            Long userId, String conversationId, List<String> outcomes);
    @Transactional void deleteByUserId(Long userId);
    @Transactional void deleteByConversationId(String conversationId);
    @Transactional void deleteByCreatedAtBefore(LocalDateTime cutoff);
}
