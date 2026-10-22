// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.repository;

import com.checkba.model.entity.DdAiJob;
import org.springframework.data.jpa.repository.*;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;
import java.util.List;
import java.util.Optional;

public interface DdAiJobRepository extends JpaRepository<DdAiJob, String> {
    List<DdAiJob> findTop8ByStatusOrderByCreatedAtAsc(String status);
    long countByStatusIn(List<String> statuses);
    long countByKindAndSubmissionId(String kind, Long submissionId);
    Optional<DdAiJob> findByProjectIdAndUserIdAndKindAndIdempotencyKey(Long projectId, Long userId, String kind, String idempotencyKey);
    Optional<DdAiJob> findFirstByKindAndSubmissionIdAndStatusInOrderByCreatedAtDesc(String kind, Long submissionId, List<String> statuses);
    Optional<DdAiJob> findFirstByKindAndItemIdAndStatusInOrderByCreatedAtDesc(String kind, Long itemId, List<String> statuses);
    @Modifying @Transactional
    @Query("update DdAiJob j set j.status='RUNNING', j.startedAt=CURRENT_TIMESTAMP where j.id=:id and j.status='QUEUED'")
    int claim(@Param("id") String id);

    @Modifying @Transactional
    @Query("update DdAiJob j set j.stage=:stage where j.id=:id and j.status='RUNNING'")
    int progress(@Param("id") String id, @Param("stage") String stage);

    @Modifying @Transactional
    @Query("update DdAiJob j set j.status=:status, j.stage=:stage, j.resultJson=:result, j.error=:error, j.inputJson=null, j.finishedAt=CURRENT_TIMESTAMP where j.id=:id and j.status='RUNNING'")
    int finish(@Param("id") String id, @Param("status") String status, @Param("stage") String stage,
               @Param("result") String result, @Param("error") String error);
}
