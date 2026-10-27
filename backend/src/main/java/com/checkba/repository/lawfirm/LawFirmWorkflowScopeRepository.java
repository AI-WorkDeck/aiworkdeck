// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.repository.lawfirm;
import com.checkba.model.entity.lawfirm.LawFirmWorkflowScope;
import org.springframework.data.jpa.repository.*;
import jakarta.persistence.LockModeType;
import org.springframework.data.repository.query.Param;
import java.util.Optional;
public interface LawFirmWorkflowScopeRepository extends JpaRepository<LawFirmWorkflowScope,String> {
    @Lock(LockModeType.PESSIMISTIC_WRITE) @Query("select s from LawFirmWorkflowScope s where s.firmId=:firmId")
    Optional<LawFirmWorkflowScope> lockByFirmId(@Param("firmId") String firmId);
}
