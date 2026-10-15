// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.repository.lawfirm;

import com.checkba.model.entity.lawfirm.LawFirmMatterIntake;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface LawFirmMatterIntakeRepository extends JpaRepository<LawFirmMatterIntake, Long> {

    List<LawFirmMatterIntake> findAllByOrderByCreatedAtDescIdDesc();

    Optional<LawFirmMatterIntake> findByIntakeNo(String intakeNo);

    List<LawFirmMatterIntake> findByApplicantUserIdOrLeadLawyerUserIdOrderByCreatedAtDescIdDesc(
            Long applicantUserId, Long leadLawyerUserId);

    List<LawFirmMatterIntake> findByProjectIdOrderByCreatedAtDescIdDesc(Long projectId);
}
