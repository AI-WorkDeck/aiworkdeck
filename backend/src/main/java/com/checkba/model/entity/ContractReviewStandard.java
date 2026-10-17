// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.model.entity;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import java.time.LocalDateTime;

@Entity
@Table(name = "contract_review_standard", indexes = @Index(name = "idx_crs_project", columnList = "project_id"))
@Getter
@Setter
public class ContractReviewStandard {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    @Column(name = "project_id", nullable = false) private Long projectId;
    @Column(nullable = false, length = 120) private String name;
    @Column(length = 300) private String position;
    @Column(length = 300) private String jurisdiction;
    @Column(columnDefinition = "TEXT", nullable = false) private String rulesJson;
    @Column(nullable = false) private long version = 1;
    private Long confirmedVersion;
    private LocalDateTime confirmedAt;
    private LocalDateTime updatedAt;
    @Version private long lockVersion;
}
