// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.repository;
import com.checkba.model.entity.MobileAssistantTurn;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.*;

public interface MobileAssistantTurnRepository extends JpaRepository<MobileAssistantTurn,Long> {
    Optional<MobileAssistantTurn> findByUserIdAndRequestId(Long userId,String requestId);
    List<MobileAssistantTurn> findTop20ByUserIdAndConversationIdOrderByCreatedAtDesc(Long userId,String conversationId);
    List<MobileAssistantTurn> findByUserIdAndStatus(Long userId,String status);
    long countByUserIdAndCreatedAtAfter(Long userId,java.time.Instant since);
    void deleteByUserId(Long userId);
    interface AttemptState { String getStatus(); long getAttemptRevision(); }
    @org.springframework.data.jpa.repository.Query("select t.status as status,t.attemptRevision as attemptRevision from MobileAssistantTurn t where t.id=:id")
    Optional<AttemptState> attemptState(@org.springframework.data.repository.query.Param("id") Long id);
}
