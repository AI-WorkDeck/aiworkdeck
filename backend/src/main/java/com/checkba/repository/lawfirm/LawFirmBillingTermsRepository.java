// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.repository.lawfirm;

import com.checkba.model.entity.lawfirm.LawFirmBillingTerms;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface LawFirmBillingTermsRepository extends JpaRepository<LawFirmBillingTerms, Long> {

    Optional<LawFirmBillingTerms> findByIntakeId(Long intakeId);
}
