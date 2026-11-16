// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.repository.lawfirm;

import com.checkba.model.entity.lawfirm.LawFirmBillingTerms;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface LawFirmBillingTermsRepository extends JpaRepository<LawFirmBillingTerms, Long> {

    Optional<LawFirmBillingTerms> findByIntakeId(Long intakeId);

    Optional<LawFirmBillingTerms> findByCloudMatterId(String cloudMatterId);

    /** 同一事项出账单串行化（封顶额度按事项累计，两张并发生成的账单不能共用同一份剩余额度）。 */
    @org.springframework.data.jpa.repository.Lock(jakarta.persistence.LockModeType.PESSIMISTIC_WRITE)
    @org.springframework.data.jpa.repository.Query("select t from LawFirmBillingTerms t where t.intakeId = :intakeId")
    Optional<LawFirmBillingTerms> lockByIntakeId(@org.springframework.data.repository.query.Param("intakeId") Long intakeId);
}
