// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.model.entity;

import jakarta.persistence.*;
import lombok.Data;
import java.time.LocalDateTime;

/**
 * C12: how a version object of a shared case was stored on the case library. Only {@code FREE} rows count
 * towards the per-matter free allowance (lifetime: history keeps objects, so free bytes never come back).
 * {@code RESERVED} rows older than 24 h are released; {@code COMPLETE} rows are permanent.
 */
@Entity
@Table(name = "project_object_plan", uniqueConstraints = @UniqueConstraint(columnNames = {"project_id", "object_sha"}))
@Data
public class ProjectObjectPlan {
    public static final String FREE = "FREE";
    public static final String PAID = "PAID";
    public static final String RESERVED = "RESERVED";
    public static final String COMPLETE = "COMPLETE";

    @Id @GeneratedValue(strategy = GenerationType.IDENTITY) private Long id;
    @Column(name = "project_id", nullable = false) private Long projectId;
    @Column(name = "object_sha", nullable = false, length = 64) private String objectSha;
    @Column(nullable = false) private long objectSize;
    @Column(nullable = false, length = 8) private String plan;
    @Column(nullable = false, length = 12) private String state;
    @Column(nullable = false) private LocalDateTime reservedAt;
    private LocalDateTime completedAt;
}
