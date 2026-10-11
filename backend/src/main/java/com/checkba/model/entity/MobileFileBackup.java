// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.model.entity;
import jakarta.persistence.*;
import lombok.Data;
import java.time.LocalDateTime;

@Entity
@Table(name="mobile_file_backup", uniqueConstraints=@UniqueConstraint(columnNames={"user_id","device_id","project_key","file_id"}))
@Data
public class MobileFileBackup {
    @Id @GeneratedValue(strategy=GenerationType.IDENTITY) private Long id;
    @Column(nullable=false) private Long userId;
    @Column(nullable=false,length=64) private String deviceId;
    @Column(nullable=false,length=64) private String projectKey;
    @Column(nullable=false,length=128) private String fileId;
    @Column(nullable=false,length=36) private String uid;
    @Column(nullable=false,length=512) private String name;
    @Column(nullable=false,length=1024) private String path;
    @Column(length=128) private String parentId;
    @Column(nullable=false,length=64) private String sha256;
    @Column(nullable=false) private Long size;
    @Column(nullable=false,length=1024) private String storagePath;
    @Column(nullable=false) private boolean pendingDeletion;
    @Column(nullable=false) private LocalDateTime updatedAt;
}
