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
@Table(name = "lawfirm_invoice")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class LawFirmInvoice {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(length = 64, unique = true)
    private String invoiceAppNo;

    private Long intakeId;

    @Column(length = 64)
    private String intakeNo;

    @Column(length = 256)
    private String matterTitle;

    private Long projectId;

    private Long applicantUserId;

    @Column(length = 128)
    private String applicantName;

    private Long leadLawyerUserId;

    @Column(length = 128)
    private String leadLawyerName;

    @Column(length = 128)
    private String departmentName;

    @Column(length = 64)
    private String invoiceType;

    @Column(length = 128)
    private String taxItemName;

    @Builder.Default
    private Long amountCents = 0L;

    @Builder.Default
    private Integer taxRateBps = 600;

    @Builder.Default
    private Long taxAmountCents = 0L;

    @Builder.Default
    private Long netAmountCents = 0L;

    @Column(length = 256)
    private String buyerName;

    @Column(length = 128)
    private String buyerTaxId;

    @Column(length = 512)
    private String buyerAddressPhone;

    @Column(length = 512)
    private String buyerBankAccount;

    @Column(length = 256)
    private String recipientEmail;

    @Column(length = 64)
    private String status;

    @Column(length = 128)
    private String invoiceCode;

    @Column(length = 128)
    private String invoiceNumber;

    private Instant issuedAt;

    @Builder.Default
    private Long collectedAmountCents = 0L;

    @Column(length = 64)
    private String externalSyncStatus;

    @Column(length = 128)
    private String externalErpRef;

    @Column(length = 512)
    private String remark;

    private Instant createdAt;
    private Instant updatedAt;
}
