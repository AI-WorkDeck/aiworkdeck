// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.repository;
import com.checkba.model.entity.MobileAssistantDesktopCopy;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.Optional;
public interface MobileAssistantDesktopCopyRepository extends JpaRepository<MobileAssistantDesktopCopy,Long> {
    @org.springframework.data.jpa.repository.Modifying
    @org.springframework.data.jpa.repository.Query("update MobileAssistantDesktopCopy c set c.status='FAILED', c.error='SOURCE_UNAVAILABLE', c.snapshotJson=null where c.userId=:user and c.status='QUEUED'")
    int revokePending(@org.springframework.data.repository.query.Param("user") Long user);
    List<MobileAssistantDesktopCopy> findTop100ByStatusAndExpiresAtBeforeOrderByIdAsc(String status,java.time.Instant now);
    Optional<MobileAssistantDesktopCopy> findByUserIdAndRequestId(Long userId,String requestId);
    List<MobileAssistantDesktopCopy> findTop20ByUserIdAndSourceConversationIdOrderByIdDesc(Long userId,String sourceConversationId);
    List<MobileAssistantDesktopCopy> findTop10ByUserIdAndTargetDeviceIdAndStatusOrderByIdAsc(Long userId,String deviceId,String status);
}
