// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.repository;
import com.checkba.model.entity.MobileCalendarDelivery;
import org.springframework.data.jpa.repository.JpaRepository;
import java.time.Instant;
public interface MobileCalendarDeliveryRepository extends JpaRepository<MobileCalendarDelivery,String> {
    void deleteByInstallationId(String installationId);
    void deleteByUserId(Long userId);
    void deleteBySentAtBefore(Instant cutoff);
}
