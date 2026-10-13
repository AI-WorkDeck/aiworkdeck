// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.repository;

import com.checkba.model.entity.ImMember;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ImMemberRepository extends JpaRepository<ImMember, Long> {
 java.util.Optional<ImMember> findByConversationIdAndUserId(String conversationId, Long userId);
 java.util.List<ImMember> findByUserId(Long userId);
 java.util.List<ImMember> findByConversationId(String conversationId);
 long countByConversationId(String conversationId);
}
