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
import jakarta.persistence.Version;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.Instant;
import java.time.LocalDate;

/**
 * 计时账单。状态：DRAFT（已生成）→ SENT（已发客户待确认）→ CONFIRMED（客户已确认，已生成发票申请 invoiceId）；
 * DRAFT/SENT 可 CANCELLED（工时退回「已通过」）。明细在 linesJson 里快照，生成后不随费率变化。
 */
@Entity
@Table(name = "lawfirm_bill", indexes = {
        @Index(name = "idx_lf_bill_intake", columnList = "intake_id")
})
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class LawFirmBill {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Version
    private Long version;

    @Column(length = 64, unique = true, nullable = false)
    private String billNo;

    @Column(nullable = false)
    private Long intakeId;

    @Column(length = 64)
    private String intakeNo;

    @Column(length = 256)
    private String matterTitle;

    @Column(length = 256)
    private String clientName;

    private Long projectId;

    private LocalDate periodFrom;
    private LocalDate periodTo;

    @Column(length = 32, nullable = false)
    private String status;

    @Column(columnDefinition = "TEXT")
    private String linesJson;

    private Integer entryCount;
    private Integer billedMinutes;

    /** 按标准费率、律师申报时长计算的价值（实现率分母）。 */
    private Long standardAmountCents;
    /** 按适用费率、核减后时长计算的小计。 */
    private Long subtotalCents;
    private Integer discountBps;
    private Long discountCents;
    /** 生成时的事项封顶金额与本单因封顶减少的金额。 */
    private Long capCents;
    private Long capReductionCents;
    private Long totalCents;

    private Long invoiceId;

    @Column(length = 64)
    private String invoiceAppNo;

    private Long createdByUserId;

    @Column(length = 128)
    private String createdByName;

    @Column(length = 128)
    private String confirmedBy;

    @Column(length = 500)
    private String confirmNote;

    private Instant sentAt;
    private Instant confirmedAt;
    private Instant cancelledAt;
    private Instant createdAt;
    private Instant updatedAt;
}
