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

/** 事项的计时收费约定：按级别约定的小时费率（覆盖所内标准费率）、折扣与封顶（事项累计）。 */
@Entity
@Table(name = "lawfirm_billing_terms")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class LawFirmBillingTerms {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, unique = true)
    private Long intakeId;

    /** JSON：{"PARTNER": 300000, ...}，分/小时。 */
    @Column(columnDefinition = "TEXT")
    private String levelRatesJson;

    /** 折扣，基点（1000 = 10%）。 */
    @Builder.Default
    private Integer discountBps = 0;

    /** 事项累计封顶金额（分）；为空表示不封顶。 */
    private Long capCents;

    /** 发布到律所云端后的云端事项编号；同事交的工时按它对应回本事项。 */
    @Column(length = 36)
    private String cloudMatterId;

    private Instant updatedAt;
}
