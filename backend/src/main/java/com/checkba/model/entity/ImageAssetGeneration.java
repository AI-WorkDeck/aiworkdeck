// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.model.entity;

import jakarta.persistence.*;

import lombok.Getter;
import lombok.Setter;

@Entity
@Table(
        name = "image_asset_generation",
        uniqueConstraints =
                @UniqueConstraint(columnNames = {"user_id", "project_id", "request_key"}))
@Getter
@Setter
public class ImageAssetGeneration {
    @Id
    private String id;

    @Column(name = "user_id", nullable = false)
    private Long userId;

    @Column(name = "project_id", nullable = false)
    private Long projectId;

    @Column(name = "request_key", nullable = false, length = 100)
    private String requestKey;

    private Long parentFolderId;
    private String serviceProjectId;
    private String serviceTaskId;
    private Long outputFileId;
    private String state;
}
