// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.repository;
import com.checkba.model.entity.DesktopAssistantCopyReceipt;
import org.springframework.data.jpa.repository.JpaRepository;
public interface DesktopAssistantCopyReceiptRepository extends JpaRepository<DesktopAssistantCopyReceipt, String> {
    java.util.List<DesktopAssistantCopyReceipt> findByAccountScopeAndTargetDeviceIdAndAcknowledgedAtIsNullOrderByImportedAtAsc(String accountScope, String targetDeviceId);

    @org.springframework.transaction.annotation.Transactional
    @org.springframework.data.jpa.repository.Modifying
    @org.springframework.data.jpa.repository.Query("update DesktopAssistantCopyReceipt r set r.acknowledgedAt = :at where r.id = :id and r.acknowledgedAt is null")
    int markAcknowledged(@org.springframework.data.repository.query.Param("id") String id,
            @org.springframework.data.repository.query.Param("at") java.time.LocalDateTime at);
}
