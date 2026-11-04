// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.model.entity;
import jakarta.persistence.*;
import lombok.Data;
@Entity @Data
@Table(name="cloud_cleanup_job",uniqueConstraints=@UniqueConstraint(columnNames={"userId","caseId"}))
public class CloudCleanupJob {
 @Id @Column(length=64) private String id;
 @Column(nullable=false) private Long userId;
 @Column(nullable=false,length=128) private String caseId;
 @Column(nullable=false,length=64) private String manifestHash;
 @Column(nullable=false) private long epoch;
 @Column(nullable=false,length=32) private String state;
 @Column(length=256) private String reviewReason;
 @Lob @Column(nullable=false) private String itemsJson;
 @Lob private String completedItemsJson;
}
