// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.repository;

import com.checkba.model.entity.ImConversation;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ImConversationRepository extends JpaRepository<ImConversation, String> {
 java.util.Optional<ImConversation> findByAgentBindingKey(String agentBindingKey);
 @org.springframework.data.jpa.repository.Lock(jakarta.persistence.LockModeType.PESSIMISTIC_WRITE)
 @org.springframework.data.jpa.repository.Query("select c from ImConversation c where c.id=:id")
 java.util.Optional<ImConversation> lockById(String id);
}
