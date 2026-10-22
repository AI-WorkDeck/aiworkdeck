// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.model.entity;

import com.fasterxml.jackson.annotation.JsonIgnore;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import java.time.LocalDateTime;

/** Durable work and receipts; provider credentials never enter this table. */
@Entity
@Table(name = "dd_ai_job", indexes = @Index(name = "idx_dd_job_queue", columnList = "status,created_at"),
       uniqueConstraints = @UniqueConstraint(name = "uk_dd_job_attempt", columnNames = {"project_id", "user_id", "kind", "idempotency_key"}))
@Getter @Setter
public class DdAiJob {
    @Id @Column(length = 36) private String id;
    @Column(name = "project_id", nullable = false) private Long projectId;
    @Column(name = "user_id", nullable = false) private Long userId;
    @JsonIgnore @Column(name = "idempotency_key", length = 100) private String idempotencyKey;
    @JsonIgnore @Column(length = 64) private String inputHash;
    private Long itemId;
    private Long submissionId;
    @Column(length = 24, nullable = false) private String kind;
    @Column(length = 24, nullable = false) private String status = "QUEUED";
    @Column(length = 256) private String stage = "等待处理";
    @JsonIgnore @Column(columnDefinition = "TEXT") private String inputJson;
    @Column(columnDefinition = "TEXT") private String resultJson;
    @Column(length = 1000) private String error;
    @Column(nullable = false) private LocalDateTime createdAt = LocalDateTime.now();
    private LocalDateTime startedAt;
    private LocalDateTime finishedAt;
}
