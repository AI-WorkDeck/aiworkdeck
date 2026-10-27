// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.model.entity;
import jakarta.persistence.*;
import lombok.Data;

@Entity
@Table(name="mobile_project_summary", uniqueConstraints=@UniqueConstraint(columnNames={"user_id","device_id","project_key"}))
@Data
public class MobileProjectSummary {
    @Id @GeneratedValue(strategy=GenerationType.IDENTITY) private Long id;
    @Column(nullable=false) private Long userId;
    @Column(nullable=false,length=64) private String deviceId;
    @Column(nullable=false,length=64) private String projectKey;
    @Column(nullable=false,length=512) private String projectName;
    @Column(nullable=false,length=64) private String sourceUpdatedAt;
    @Column(nullable=false,length=64) private String sourceHash;
    @Column(nullable=false,length=64) private String backupHash;
    @Column(nullable=false,length=24000) private String context;
    @Column(nullable=false,length=16000) private String summary;
    @Column(nullable=false,length=24000) private String sourcesJson;
    @Column(nullable=false,length=24) private String status;
    @Column(nullable=false) private java.time.Instant updatedAt;
}
