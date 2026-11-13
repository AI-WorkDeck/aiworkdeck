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

/** 计时人费率卡：律师级别与所内标准小时费率（分/小时，含税）。 */
@Entity
@Table(name = "lawfirm_timekeeper")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class LawFirmTimekeeper {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, unique = true)
    private Long userId;

    @Column(length = 128)
    private String displayName;

    /** PARTNER / COUNSEL / SENIOR_ASSOCIATE / ASSOCIATE / PARALEGAL */
    @Column(length = 32)
    private String level;

    private Long standardRateCents;

    private Instant updatedAt;
}
