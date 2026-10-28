// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.repository;

import com.checkba.model.entity.ImageAssetGeneration;

import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Optional;

public interface ImageAssetGenerationRepository
        extends JpaRepository<ImageAssetGeneration, String> {
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query(
            "select t from ImageAssetGeneration t where t.id = :id")
    Optional<ImageAssetGeneration> findLockedById(
            @Param("id") String id);

    Optional<ImageAssetGeneration> findByUserIdAndProjectIdAndRequestKey(
            Long userId, Long projectId, String requestKey);
}
