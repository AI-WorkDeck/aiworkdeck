// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.repository;

import com.checkba.model.entity.ProjectObjectLocalOnly;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.Optional;

public interface ProjectObjectLocalOnlyRepository extends JpaRepository<ProjectObjectLocalOnly, Long> {
    Optional<ProjectObjectLocalOnly> findByProjectIdAndObjectSha(Long projectId, String objectSha);
    List<ProjectObjectLocalOnly> findByProjectId(Long projectId);
    long countByProjectId(Long projectId);
    void deleteByProjectIdAndObjectSha(Long projectId, String objectSha);
}
