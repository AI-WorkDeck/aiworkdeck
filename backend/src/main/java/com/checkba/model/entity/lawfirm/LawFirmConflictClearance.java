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
@Table(name = "lawfirm_conflict_clearance")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class LawFirmConflictClearance {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    private Long intakeId;

    @Column(length = 64)
    private String intakeNo;

    private Long targetUserId;

    @Column(length = 128)
    private String targetUserName;

    @Column(length = 64)
    private String role;

    private Long matchedProjectId;

    @Column(length = 256)
    private String matchedMatterTitle;

    @Column(length = 256)
    private String matchedPartyName;

    @Column(length = 512)
    private String conflictRuleCitation;

    @Column(length = 64)
    private String decision;

    @Column(columnDefinition = "TEXT")
    private String comment;

    @Column(length = 64)
    private String imConversationId;

    private Instant notifiedAt;
    private Instant decidedAt;
}
