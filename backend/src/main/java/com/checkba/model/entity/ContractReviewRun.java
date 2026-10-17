// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.model.entity;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import java.time.LocalDateTime;

@Entity
@Table(name = "contract_review_run", indexes = @Index(name = "idx_crr_project_doc", columnList = "project_id,doc_file_id,id"))
@Getter
@Setter
public class ContractReviewRun {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY) private Long id;
    @Column(name = "project_id", nullable = false) private Long projectId;
    @Column(name = "doc_file_id", nullable = false) private Long docFileId;
    @Column(columnDefinition = "TEXT", nullable = false) private String standardJson;
    @Column(columnDefinition = "TEXT", nullable = false) private String resultsJson;
    @Column(nullable = false, length = 16) private String status;
    @Column(nullable = false, length = 64) private String documentHash;
    @Column(length = 300) private String error;
    private LocalDateTime startedAt;
    private LocalDateTime finishedAt;
}
