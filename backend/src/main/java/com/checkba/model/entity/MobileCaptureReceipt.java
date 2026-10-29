// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.model.entity;
import jakarta.persistence.*;
import lombok.Data;

/** Relay identity survives the 30-day blob/inbox cleanup. No capture bytes are stored here. */
@Entity
@Table(name="mobile_capture_receipt", uniqueConstraints=@UniqueConstraint(columnNames={"user_id","client_media_id"}))
@Data
public class MobileCaptureReceipt {
    @Id @GeneratedValue(strategy=GenerationType.IDENTITY) private Long id;
    @Column(nullable=false) private Long userId;
    @Column(nullable=false) private Long inboxId;
    @Column(nullable=false,length=64) private String clientMediaId;
    @Column(nullable=false,length=64) private String deviceId;
    @Column(nullable=false,length=64) private String projectKey;
    @Column(nullable=false,length=1024) private String relativePath;
    @Column(nullable=false) private Long fileSize;
    private java.time.LocalDateTime deliveredAt;
}
