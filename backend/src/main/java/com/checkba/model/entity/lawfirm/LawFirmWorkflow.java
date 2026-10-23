// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.model.entity.lawfirm;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import java.time.Instant;
/** Only explicitly submitted cloud collaboration data. Legacy financial/intake tables are never imported. */
@Entity @Table(name="lawfirm_workflow") @Getter @Setter
public class LawFirmWorkflow {
    @Id @Column(length=36) private String id;
    @Column(nullable=false,length=128) private String firmId;
    @Column(nullable=false) private Long applicantId;
    @Column(nullable=false) private Long leadId;
    @Column(nullable=false) private Long committeeId;
    @Column(nullable=false,length=256) private String title;
    @Column(nullable=false,length=256) private String clientName;
    @Column(length=256) private String counterpartyName;
    @Column(length=64) private String practiceArea;
    @Column(nullable=false,length=64) private String requestHash;
    @Column(nullable=false,length=40) private String status;
    @Column(nullable=false,length=16) private String risk;
    @Column(length=2000) private String decisionComment;
    private Instant createdAt;
    private Instant updatedAt;
    @Version private long version;
}
