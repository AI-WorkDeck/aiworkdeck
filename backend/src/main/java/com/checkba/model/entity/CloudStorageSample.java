// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.model.entity;
import jakarta.persistence.*;
import lombok.Data;
import java.time.Instant;
@Entity @Data
@Table(name="cloud_storage_sample", indexes=@Index(name="idx_cloud_storage_sample_owner",columnList="user_id,observed_at"))
public class CloudStorageSample {
    @Id @GeneratedValue(strategy=GenerationType.IDENTITY) private Long id;
    @Column(nullable=false) private Long userId;
    @Column(nullable=false) private Instant observedAt;
    @Column(nullable=false) private long storedBytes;
}
