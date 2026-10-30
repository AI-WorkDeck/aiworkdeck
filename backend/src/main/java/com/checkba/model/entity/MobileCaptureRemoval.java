// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.model.entity;
import jakarta.persistence.*;
import lombok.Data;

/** Local crash-recovery journal. DONE is a tombstone, never permission to delete a replacement. */
@Entity
@Table(name="mobile_capture_removal", uniqueConstraints=@UniqueConstraint(columnNames={"account_scope","request_id"}))
@Data
public class MobileCaptureRemoval {
    @Id @GeneratedValue(strategy=GenerationType.IDENTITY) private Long id;
    @Column(nullable=false,length=128) private String accountScope;
    @Column(nullable=false,length=36) private String requestId;
    @Column(nullable=false) private Long projectId;
    @Column(nullable=false) private Long fileId;
    @Column(nullable=false,length=36) private String fileUid;
    @Column(nullable=false,length=1024) private String sourcePath;
    @Column(nullable=false,length=1024) private String quarantinePath;
    @Column(nullable=false,length=64) private String sha256;
    @Column(nullable=false) private Long fileSize;
    @Column(nullable=false,length=16) private String state;
}
