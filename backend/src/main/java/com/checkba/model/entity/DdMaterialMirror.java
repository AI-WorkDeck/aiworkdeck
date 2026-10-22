// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.model.entity;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

/** Cloud submission identities are never used as local ProjectFile ids. */
@Entity @Table(name = "dd_material_mirror", uniqueConstraints = @UniqueConstraint(columnNames = {"project_id", "source_key"}))
@Getter @Setter
public class DdMaterialMirror {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY) private Long id;
    @Column(name = "project_id", nullable = false) private Long projectId;
    @Column(name = "source_key", nullable = false, length = 180) private String sourceKey;
    @Column(nullable = false) private Long localFileId;
    @Column(nullable = false, length = 64) private String sha256;
}
