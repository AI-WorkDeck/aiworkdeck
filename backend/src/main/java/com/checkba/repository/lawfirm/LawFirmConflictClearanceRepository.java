// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.repository.lawfirm;

import com.checkba.model.entity.lawfirm.LawFirmConflictClearance;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface LawFirmConflictClearanceRepository extends JpaRepository<LawFirmConflictClearance, Long> {

    List<LawFirmConflictClearance> findByIntakeIdOrderByIdAsc(Long intakeId);

    List<LawFirmConflictClearance> findByTargetUserIdOrderByIdDesc(Long targetUserId);

    List<LawFirmConflictClearance> findAllByOrderByIdDesc();
}
