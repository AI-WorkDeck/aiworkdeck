// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.model.entity.lawfirm;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.Instant;

@Entity
@Table(name = "lawfirm_matter_intake")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class LawFirmMatterIntake {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(length = 64, unique = true, nullable = false)
    private String intakeNo;

    private Long projectId;

    @Column(length = 64)
    private String projectUid;

    @Column(length = 256, nullable = false)
    private String title;

    @Column(length = 64)
    private String practiceArea;

    private Long applicantUserId;

    @Column(length = 128)
    private String applicantName;

    private Long leadLawyerUserId;

    @Column(length = 128)
    private String leadLawyerName;

    @Column(length = 128)
    private String departmentName;

    @Column(length = 512)
    private String teamMemberNames;

    @Column(length = 256)
    private String clientName;

    @Column(length = 128)
    private String clientCreditCode;

    @Column(length = 64)
    private String clientRole;

    @Column(length = 256)
    private String counterpartyName;

    @Column(length = 128)
    private String counterpartyCreditCode;

    @Column(columnDefinition = "TEXT")
    private String relatedPartiesJson;

    @Column(length = 64)
    private String feeMode;

    @Builder.Default
    private Long contractAmountCents = 0L;

    @Builder.Default
    private Long disputeTargetCents = 0L;

    @Builder.Default
    private Integer contingencyRateBps = 0;

    @Column(columnDefinition = "TEXT")
    private String feeComplianceWarning;

    @Column(length = 32)
    private String conflictRiskLevel;

    @Column(columnDefinition = "TEXT")
    private String conflictSummary;

    @Column(columnDefinition = "TEXT")
    private String conflictHitsJson;

    @Column(length = 64)
    private String status;

    private Long committeeReviewerId;

    @Column(length = 128)
    private String committeeReviewerName;

    @Column(columnDefinition = "TEXT")
    private String committeeComment;

    @Builder.Default
    private Boolean ethicalWallApplied = false;

    @Builder.Default
    private Boolean clientWaiverUploaded = false;

    @Column(length = 64)
    private String imConversationId;

    private Instant submittedAt;
    private Instant clearedAt;
    private Instant filedAt;
    private Instant createdAt;
    private Instant updatedAt;
}
