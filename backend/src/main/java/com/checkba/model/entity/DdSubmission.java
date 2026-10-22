// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.model.entity;

import com.fasterxml.jackson.annotation.JsonIgnore;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import java.time.LocalDateTime;
import java.util.List;

/** A preserved submission version. AI findings never replace the lawyer's decision. */
@Entity
@org.hibernate.annotations.DynamicUpdate
@Table(name = "dd_submission", uniqueConstraints = {
    @UniqueConstraint(name = "uk_dd_submission_version", columnNames = {"item_id", "submission_version"}),
    @UniqueConstraint(name = "uk_dd_submission_retry", columnNames = {"item_id", "submitted_by", "idempotency_key"})
})
@Getter
@Setter
public class DdSubmission {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    @Column(name = "project_id", nullable = false) private Long projectId;
    @Column(name = "request_id", nullable = false) private Long requestId;
    @Column(name = "item_id", nullable = false) private Long itemId;
    @Column(name = "submission_version", nullable = false) private Integer version;
    @Column(name = "submitted_by", nullable = false) private Long submittedBy;
    @Column(nullable = false) private LocalDateTime submittedAt;
    @Column(name = "idempotency_key", length = 100, nullable = false) private String idempotencyKey;
    @JsonIgnore @Column(length = 64) private String requestFingerprint;
    @Column(length = 24, nullable = false) private String type = "FILES";
    @Column(length = 24) private String explanationType;
    @JsonIgnore @Column(columnDefinition = "TEXT") private String fileIdsJson = "[]";
    @Column(length = 2000) private String reason;
    @Column(length = 24, nullable = false) private String reviewStatus = "UPLOADED";
    @Column(length = 2000) private String reviewReason;
    private Long reviewedBy;
    private LocalDateTime reviewedAt;
    @Column(length = 2000) private String appealReason;
    private LocalDateTime appealedAt;
    private Long appealedBy;
    @Column(length = 32, nullable = false) private String aiStatus = "QUEUED";
    @Column(columnDefinition = "TEXT") private String aiResultJson;
    @Column(nullable = false) private boolean aiConsent;

    @Transient
    public List<Long> getFileIds() {
        return cn.hutool.json.JSONUtil.toList(fileIdsJson == null ? "[]" : fileIdsJson, Long.class);
    }
    public void setFileIds(List<Long> ids) { fileIdsJson = cn.hutool.json.JSONUtil.toJsonStr(ids); }
}
