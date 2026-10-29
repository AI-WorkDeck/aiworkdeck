// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.repository;
import com.checkba.model.entity.MobileMediaMove;
import org.springframework.data.jpa.repository.JpaRepository;
public interface MobileMediaMoveRepository extends JpaRepository<MobileMediaMove,Long> {
    java.util.Optional<MobileMediaMove> findByUserIdAndRequestId(Long userId,String requestId);
    java.util.Optional<MobileMediaMove> findByUserIdAndSourceClientMediaId(Long userId,String clientMediaId);
    java.util.Optional<MobileMediaMove> findByUserIdAndTargetClientMediaId(Long userId,String clientMediaId);
    java.util.List<MobileMediaMove> findByUserId(Long userId);
    java.util.List<MobileMediaMove> findByStatusIn(java.util.Collection<String> statuses);
    long deleteByUserId(Long userId);
}
