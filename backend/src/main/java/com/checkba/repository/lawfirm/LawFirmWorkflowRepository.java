// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.repository.lawfirm;
import com.checkba.model.entity.lawfirm.LawFirmWorkflow;
import org.springframework.data.jpa.repository.*;
import jakarta.persistence.LockModeType;
import org.springframework.data.repository.query.Param;
import java.util.*;
public interface LawFirmWorkflowRepository extends JpaRepository<LawFirmWorkflow,String> {
    List<LawFirmWorkflow> findByFirmIdOrderByCreatedAtDesc(String firmId);
    @Lock(LockModeType.PESSIMISTIC_WRITE) @Query("select w from LawFirmWorkflow w where w.id=:id")
    Optional<LawFirmWorkflow> lockById(@Param("id") String id);
}
