// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.model.entity.lawfirm;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.Instant;

/** 工时审核痕迹：谁、何时、做了什么（核减/改描述/不收费/通过/退回/出账单），改前改后值与理由。只追加，不修改。 */
@Entity
@Table(name = "lawfirm_time_entry_audit", indexes = {
        @Index(name = "idx_lf_time_audit_entry", columnList = "entry_id")
})
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class LawFirmTimeEntryAudit {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false)
    private Long entryId;

    private Long actorUserId;

    @Column(length = 128)
    private String actorName;

    @Column(length = 32, nullable = false)
    private String action;

    /** JSON：{"字段": {"from": 旧值, "to": 新值}}。 */
    @Column(columnDefinition = "TEXT")
    private String detail;

    @Column(length = 500)
    private String reason;

    private Instant createdAt;
}
