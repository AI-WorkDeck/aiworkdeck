// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.model.entity.lawfirm;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import java.time.Instant;
@Entity @Table(name="lawfirm_workflow_clearance",uniqueConstraints=@UniqueConstraint(columnNames={"workflow_id","target_id"}))
@Getter @Setter
public class LawFirmWorkflowClearance {
    @Id @Column(length=36) private String id;
    @Column(name="workflow_id",nullable=false,length=36) private String workflowId;
    @Column(name="target_id",nullable=false) private Long targetId;
    @Column(nullable=false,length=4000) private String summary;
    @Column(length=4000) private String privateSummary;
    @Column(nullable=false,length=24) private String decision;
    @Column(length=2000) private String comment;
    private Instant decidedAt;
}
