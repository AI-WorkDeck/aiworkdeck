// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.repository;

import com.checkba.model.entity.ProjectObjectPlan;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

public interface ProjectObjectPlanRepository extends JpaRepository<ProjectObjectPlan, Long> {
    Optional<ProjectObjectPlan> findByProjectIdAndObjectSha(Long projectId, String objectSha);

    @Query("select coalesce(sum(p.objectSize), 0) from ProjectObjectPlan p where p.projectId = :projectId and p.plan = 'FREE'")
    long freeBytes(Long projectId);

    @Query("select coalesce(sum(p.objectSize), 0) from ProjectObjectPlan p where p.projectId = :projectId and p.plan = 'FREE' and p.state = 'COMPLETE'")
    long completedFreeBytes(Long projectId);

    List<ProjectObjectPlan> findByProjectIdAndPlanAndState(Long projectId, String plan, String state);

    @Modifying
    @Query("delete from ProjectObjectPlan p where p.projectId = :projectId and p.state = 'RESERVED' and p.reservedAt < :before")
    int releaseExpired(Long projectId, LocalDateTime before);
}
