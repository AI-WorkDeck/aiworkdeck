// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.repository;

import com.checkba.model.entity.ImAttachment;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ImAttachmentRepository extends JpaRepository<ImAttachment, String> {
 @org.springframework.data.jpa.repository.Query("select a.id,a.name,a.size,a.sha256,a.uploadedBy,a.clientVisible,a.sourceProjectUid,a.sourceFileUid from ImAttachment a where a.id=:id and a.conversationId=:conversationId")
 java.util.List<Object[]> metadata(String id, String conversationId);
 java.util.Optional<ImAttachment> findByConversationIdAndUploadedByAndClientMessageId(
         String conversationId, Long uploadedBy, String clientMessageId);
 @org.springframework.data.jpa.repository.Query("select coalesce(sum(a.size),0) from ImAttachment a where a.conversationId=:conversationId")
 long totalSize(String conversationId);
}
