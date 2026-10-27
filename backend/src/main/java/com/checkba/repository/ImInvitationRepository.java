// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.repository;

import com.checkba.model.entity.ImInvitation;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ImInvitationRepository extends JpaRepository<ImInvitation, String> {
 @org.springframework.data.jpa.repository.Query("select i.conversationId from ImInvitation i where i.tokenHash=:hash")
 java.util.Optional<String> conversationIdForHash(String hash);
 void deleteByConversationIdAndIssuedBy(String conversationId, Long issuedBy);
}
