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
@Table(name = "lawfirm_collection")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class LawFirmCollection {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(length = 64, unique = true)
    private String collectionNo;

    private Long intakeId;

    @Column(length = 64)
    private String intakeNo;

    @Column(length = 256)
    private String matterTitle;

    private Long invoiceId;

    @Column(length = 64)
    private String invoiceAppNo;

    private Long recordedByUserId;

    @Column(length = 128)
    private String recordedByName;

    private Long leadLawyerUserId;

    @Column(length = 128)
    private String departmentName;

    @Column(length = 256)
    private String payerName;

    @Builder.Default
    private Long amountCents = 0L;

    @Column(length = 64)
    private String paymentMethod;

    @Column(length = 128)
    private String bankVoucherNo;

    @Column(length = 32)
    private String receivedDate;

    @Column(length = 64)
    private String reconciliationStatus;

    @Column(length = 128)
    private String externalErpId;

    @Column(length = 512)
    private String note;

    private Instant createdAt;
}
