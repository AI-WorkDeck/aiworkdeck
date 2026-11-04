// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.model.entity;
import jakarta.persistence.*;
import lombok.Data;
@Entity @Data
@Table(name="cloud_egress_receipt")
public class CloudEgressReceipt {
 @Id @Column(length=120) private String id;
 @Column(nullable=false) private Long userId;
 @Column(nullable=false,length=64) private String resourceHash;
 @Column(nullable=false) private long bytes;
 @Column(nullable=false) private long deliveredBytes;
 @Column(nullable=false,length=24) private String state;
 @Column(nullable=false) private boolean completed;
}
