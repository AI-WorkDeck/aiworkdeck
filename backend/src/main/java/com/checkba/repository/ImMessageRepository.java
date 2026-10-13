// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.repository;

import com.checkba.model.entity.ImMessage;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ImMessageRepository extends JpaRepository<ImMessage, Long> {
 java.util.Optional<ImMessage> findByConversationIdAndSenderIdAndClientMessageId(String conversationId,Long senderId,String clientMessageId);
 org.springframework.data.domain.Page<ImMessage> findByConversationIdAndIdGreaterThanOrderByIdAsc(String conversationId,long id,org.springframework.data.domain.Pageable pageable);
 org.springframework.data.domain.Page<ImMessage> findByConversationIdAndIdLessThanOrderByIdDesc(String conversationId,long id,org.springframework.data.domain.Pageable pageable);
 long countByConversationIdAndIdGreaterThanAndSenderIdNot(String conversationId,long id,Long senderId);
}
