// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.model.entity;

import jakarta.persistence.*;
import lombok.Data;
import java.time.LocalDateTime;

/**
 * C12: a version object that stays on the sharer's computer ("仅在本机（未共享）"). History may reference it;
 * pre-receive accepts it; colleagues get a placeholder instead of the bytes. Holds no content. Cleared when the
 * object arrives on the library later.
 */
@Entity
@Table(name = "project_object_local_only", uniqueConstraints = @UniqueConstraint(columnNames = {"project_id", "object_sha"}))
@Data
public class ProjectObjectLocalOnly {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY) private Long id;
    @Column(name = "project_id", nullable = false) private Long projectId;
    @Column(name = "object_sha", nullable = false, length = 64) private String objectSha;
    @Column(nullable = false) private long objectSize;
    @Column(nullable = false) private Long declaredBy;
    @Column(nullable = false) private LocalDateTime declaredAt;
    /** Basename only, at most 200 chars, for colleagues' placeholder text. */
    @Column(length = 200) private String nameHint;
    /** Desktop copy: who keeps the file (for 「仅在 X 的电脑上」). */
    @Column(length = 128) private String declaredByName;
    /** Desktop copy: this computer is the one keeping it (「仅在本机（未共享）」). */
    private Boolean mine;
}
