// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.repository.lawfirm;
import com.checkba.model.entity.lawfirm.LawFirmWorkflowClearance;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.*;
public interface LawFirmWorkflowClearanceRepository extends JpaRepository<LawFirmWorkflowClearance,String> {
    List<LawFirmWorkflowClearance> findByWorkflowId(String workflowId);
}
