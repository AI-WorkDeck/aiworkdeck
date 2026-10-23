// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.repository;

import com.checkba.model.entity.MessageCenterNotice;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.Optional;

public interface MessageCenterNoticeRepository extends JpaRepository<MessageCenterNotice,String> {
    List<MessageCenterNotice> findByRecipientIdOrderByCreatedAtDesc(Long userId, Pageable page);
    Optional<MessageCenterNotice> findByRecipientIdAndSourceIdAndEventKey(Long userId,String sourceId,String eventKey);
    long countByRecipientIdAndSourceIdAndCreatedAtAfter(Long userId,String sourceId,java.time.Instant after);
}
