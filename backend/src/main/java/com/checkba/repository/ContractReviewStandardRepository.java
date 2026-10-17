// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.repository;

import com.checkba.model.entity.ContractReviewStandard;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import jakarta.persistence.LockModeType;
import java.util.List;
import java.util.Optional;

public interface ContractReviewStandardRepository extends JpaRepository<ContractReviewStandard, Long> {
    List<ContractReviewStandard> findByProjectIdOrderByUpdatedAtDesc(Long projectId);
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT s FROM ContractReviewStandard s WHERE s.id = :id AND s.projectId = :projectId")
    Optional<ContractReviewStandard> lockInProject(Long id, Long projectId);
}
