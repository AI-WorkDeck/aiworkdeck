// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.model.entity;

import jakarta.persistence.*;
import lombok.Data;
import java.time.LocalDateTime;

/** A durable decision: retrying a capture must not buy another model request or change its name. */
@Entity
@Table(name="mobile_capture_organization", uniqueConstraints=@UniqueConstraint(columnNames={"user_id","client_media_id"}))
@Data
public class MobileCaptureOrganization {
    @Id @GeneratedValue(strategy=GenerationType.IDENTITY) private Long id;
    @Column(nullable=false) private Long userId;
    @Column(nullable=false,length=64) private String clientMediaId;
    @Column(nullable=false,length=64) private String deviceId;
    @Column(nullable=false,length=64) private String projectKey;
    @Column(nullable=false,length=512) private String originalName;
    @Column(nullable=false,length=512) private String fileName;
    @Column(nullable=false,length=16) private String mediaType;
    @Column(nullable=false) private long fileSize;
    @Column(length=64) private String sha256;
    @Column(nullable=false,length=24) private String state;
    @Column(nullable=false,length=16) private String ruleVersion;
    @Column(nullable=false,columnDefinition="TEXT") private String tagsJson="[]";
    @Column(nullable=false,columnDefinition="TEXT") private String fieldsJson="{}";
    @Column(nullable=false) private LocalDateTime startedAt;
}
