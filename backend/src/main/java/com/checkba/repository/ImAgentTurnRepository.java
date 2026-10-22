// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.repository;

import com.checkba.model.entity.ImAgentTurn;
import org.springframework.data.jpa.repository.JpaRepository;
import java.time.Instant;
import java.util.*;

public interface ImAgentTurnRepository extends JpaRepository<ImAgentTurn,Long> {
 Optional<ImAgentTurn> findFirstByConversationIdOrderByUpdatedAtDesc(String conversationId);
 boolean existsByConversationIdAndStatusIn(String conversationId, Collection<String> statuses);
 boolean existsByRequestedByAndStatusIn(Long requestedBy, Collection<String> statuses);
 long countByRequestedByAndUpdatedAtAfter(Long requestedBy, Instant after);
 List<ImAgentTurn> findByStatusIn(Collection<String> statuses);
}
