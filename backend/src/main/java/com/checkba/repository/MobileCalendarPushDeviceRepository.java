// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.repository;
import com.checkba.model.entity.MobileCalendarPushDevice;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.*;
public interface MobileCalendarPushDeviceRepository extends JpaRepository<MobileCalendarPushDevice,String> {
    @org.springframework.data.jpa.repository.Lock(jakarta.persistence.LockModeType.PESSIMISTIC_WRITE)
    List<MobileCalendarPushDevice> findByUserId(Long userId);
    @org.springframework.data.jpa.repository.Lock(jakarta.persistence.LockModeType.PESSIMISTIC_WRITE)
    Optional<MobileCalendarPushDevice> findByToken(String token);
    @Override
    @org.springframework.data.jpa.repository.Lock(jakarta.persistence.LockModeType.PESSIMISTIC_WRITE)
    Optional<MobileCalendarPushDevice> findById(String installationId);
    void deleteByUserId(Long userId);
}
