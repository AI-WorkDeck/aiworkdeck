// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.repository.lawfirm;
import com.checkba.model.entity.lawfirm.LawFirmCommitteeAppointment;
import org.springframework.data.jpa.repository.*;
import jakarta.persistence.LockModeType;
import java.util.*;
public interface LawFirmCommitteeAppointmentRepository extends JpaRepository<LawFirmCommitteeAppointment,String> {
    List<LawFirmCommitteeAppointment> findByFirmId(String firmId);
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    Optional<LawFirmCommitteeAppointment> findByFirmIdAndUserId(String firmId,Long userId);
}
