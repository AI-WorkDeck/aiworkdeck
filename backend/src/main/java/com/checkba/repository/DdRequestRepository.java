// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.repository;

import com.checkba.model.entity.DdRequest;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface DdRequestRepository extends JpaRepository<DdRequest, Long> {
    List<DdRequest> findByProjectIdOrderByCreatedAtDesc(Long projectId);
    @org.springframework.data.jpa.repository.Lock(jakarta.persistence.LockModeType.PESSIMISTIC_WRITE)
    @org.springframework.data.jpa.repository.Query("select e from DdRequest e where e.id = :id")
    java.util.Optional<DdRequest> findByIdForUpdate(@org.springframework.data.repository.query.Param("id") Long id);
}
