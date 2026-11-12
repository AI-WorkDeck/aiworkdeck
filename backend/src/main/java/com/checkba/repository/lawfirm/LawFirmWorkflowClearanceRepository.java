// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.repository.lawfirm;
import com.checkba.model.entity.lawfirm.LawFirmWorkflowClearance;
import org.springframework.data.jpa.repository.*;
import org.springframework.data.repository.query.Param;
import jakarta.persistence.LockModeType;
import java.util.*;
public interface LawFirmWorkflowClearanceRepository extends JpaRepository<LawFirmWorkflowClearance,String> {
    List<LawFirmWorkflowClearance> findByWorkflowId(String workflowId);
    /**
     * Locking read for the decision path. Besides locking the rows about to change, FOR UPDATE keeps H2 from
     * answering with the result it remembered for the same plain query before the caller waited for its locks
     * (H2 advances a table's modification id only after the committing transaction is already visible).
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE) @Query("select c from LawFirmWorkflowClearance c where c.workflowId=:workflowId")
    List<LawFirmWorkflowClearance> lockByWorkflowId(@Param("workflowId") String workflowId);
}
