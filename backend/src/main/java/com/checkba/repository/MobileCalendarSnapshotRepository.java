// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.repository;
import com.checkba.model.entity.MobileCalendarSnapshot;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.*;
public interface MobileCalendarSnapshotRepository extends JpaRepository<MobileCalendarSnapshot,Long> {
    List<MobileCalendarSnapshot> findByUserId(Long userId);
    Optional<MobileCalendarSnapshot> findByUserIdAndDeviceId(Long userId,String deviceId);
    void deleteByUserId(Long userId);
}
