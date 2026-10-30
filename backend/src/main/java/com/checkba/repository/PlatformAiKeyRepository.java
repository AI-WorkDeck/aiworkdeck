// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.repository;

import com.checkba.model.entity.PlatformAiKey;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface PlatformAiKeyRepository extends JpaRepository<PlatformAiKey, Long> {

    Optional<PlatformAiKey> findByUserId(Long userId);

    @org.springframework.transaction.annotation.Transactional
    @org.springframework.data.jpa.repository.Modifying(clearAutomatically = true, flushAutomatically = true)
    @org.springframework.data.jpa.repository.Query("delete from PlatformAiKey k where k.userId = :userId and k.keyFingerprint = :fingerprint")
    int deleteMatchingKey(@org.springframework.data.repository.query.Param("userId") Long userId,
                          @org.springframework.data.repository.query.Param("fingerprint") String fingerprint);

    @org.springframework.transaction.annotation.Transactional
    @org.springframework.data.jpa.repository.Modifying(clearAutomatically = true, flushAutomatically = true)
    @org.springframework.data.jpa.repository.Query("update PlatformAiKey k set k.lastVerifiedAt = :verifiedAt where k.userId = :userId and k.keyFingerprint = :fingerprint")
    int verifyMatchingKey(@org.springframework.data.repository.query.Param("userId") Long userId,
                          @org.springframework.data.repository.query.Param("fingerprint") String fingerprint,
                          @org.springframework.data.repository.query.Param("verifiedAt") java.time.LocalDateTime verifiedAt);
}
