// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.repository;

import com.checkba.model.entity.ImConversation;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ImConversationRepository extends JpaRepository<ImConversation, String> {
 java.util.Optional<ImConversation> findByAgentBindingKey(String agentBindingKey);
 java.util.Optional<ImConversation> findByProjectId(Long projectId);
 /** 律所客户档案「最近往来」：客户名下项目的项目群最后消息时间。 */
 java.util.List<ImConversation> findByProjectIdIn(java.util.Collection<Long> projectIds);
 @org.springframework.data.jpa.repository.Lock(jakarta.persistence.LockModeType.PESSIMISTIC_WRITE)
 @org.springframework.data.jpa.repository.Query("select c from ImConversation c where c.id=:id")
 java.util.Optional<ImConversation> lockById(String id);
}
