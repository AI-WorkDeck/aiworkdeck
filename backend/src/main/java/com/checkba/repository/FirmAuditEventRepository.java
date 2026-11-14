// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.repository;

import com.checkba.model.entity.FirmAuditEvent;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

/**
 * 审计日志只增不改：刻意继承最小的 {@link Repository}，不继承 JpaRepository——没有 update、没有按行删除。
 * 唯一的删除是 {@link #deleteOlderThan}（保留期清理）。
 *
 * <p>筛选条件用哨兵值而不是 null（空串 / -1 / 极值时间），避开 PostgreSQL 推断不出 null 参数类型的问题。
 */
public interface FirmAuditEventRepository extends Repository<FirmAuditEvent, Long> {

    FirmAuditEvent save(FirmAuditEvent event);

    Optional<FirmAuditEvent> findTopByFirmIdOrderByIdDesc(String firmId);

    boolean existsByEventId(String eventId);

    @Query("select e from FirmAuditEvent e where e.firmId = :firm and e.id < :beforeId"
            + " and e.occurredAt >= :from and e.occurredAt < :to"
            + " and (:category = '' or e.category = :category)"
            + " and (:action = '' or e.action = :action)"
            + " and (:projectId < 0 or e.projectId = :projectId)"
            + " and (:actor = '' or lower(e.actorName) like :actor)"
            + " order by e.id desc")
    List<FirmAuditEvent> search(@Param("firm") String firmId, @Param("beforeId") long beforeId,
                                @Param("from") Instant from, @Param("to") Instant to,
                                @Param("category") String category, @Param("action") String action,
                                @Param("projectId") long projectId, @Param("actor") String actorLikeLower,
                                Pageable page);

    /** 校验哈希链用：按 id 升序分批走。 */
    List<FirmAuditEvent> findByFirmIdAndIdGreaterThanOrderByIdAsc(String firmId, long afterId, Pageable page);

    @Modifying
    @Query("delete from FirmAuditEvent e where e.occurredAt < :cutoff")
    int deleteOlderThan(@Param("cutoff") Instant cutoff);
}
