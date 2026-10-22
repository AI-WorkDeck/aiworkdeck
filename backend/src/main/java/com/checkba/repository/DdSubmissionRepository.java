// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.repository;

import com.checkba.model.entity.DdSubmission;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.Optional;

public interface DdSubmissionRepository extends JpaRepository<DdSubmission, Long> {
    List<DdSubmission> findByItemIdOrderByVersionDesc(Long itemId);
    Optional<DdSubmission> findByItemIdAndSubmittedByAndIdempotencyKey(Long itemId, Long submittedBy, String idempotencyKey);
    List<DdSubmission> findByProjectId(Long projectId);
    boolean existsByRequestId(Long requestId);
    boolean existsByItemId(Long itemId);

    // A background model response must never merge a stale lawyer decision into this row.
    @org.springframework.data.jpa.repository.Modifying
    @org.springframework.transaction.annotation.Transactional
    @org.springframework.data.jpa.repository.Query("update DdSubmission s set s.aiStatus=:status, s.aiResultJson=:result where s.id=:id")
    int updateAssessment(@org.springframework.data.repository.query.Param("id") Long id,
                         @org.springframework.data.repository.query.Param("status") String status,
                         @org.springframework.data.repository.query.Param("result") String result);
}
