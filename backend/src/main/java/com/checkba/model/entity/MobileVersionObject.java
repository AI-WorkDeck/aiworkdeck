// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.model.entity;

import jakarta.persistence.*;
import lombok.Data;
import java.time.LocalDateTime;

/** Immutable part, or index -1 completion receipt, scoped to one account/device/project. */
@Entity
@Table(name="mobile_version_object", uniqueConstraints=@UniqueConstraint(
        columnNames={"user_id","device_id","project_key","object_sha","part_index"}))
@Data
public class MobileVersionObject {
    @Id @GeneratedValue(strategy=GenerationType.IDENTITY) private Long id;
    @Column(nullable=false) private Long userId;
    @Column(nullable=false,length=64) private String deviceId;
    @Column(nullable=false,length=64) private String projectKey;
    @Column(nullable=false,length=64) private String objectSha;
    @Column(nullable=false) private long objectSize;
    @Column(nullable=false) private int partIndex;
    @Column(length=64) private String partSha;
    @Column(nullable=false) private long size;
    @Column(length=1024) private String storagePath;
    @Column(nullable=false) private boolean pendingDeletion;
    @Column(nullable=false) private LocalDateTime updatedAt;
}
