// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.model.entity;

import jakarta.persistence.*;

@Entity @Table(name="im_invitation") @lombok.Data
public class ImInvitation {
 @Id @Column(length=64) private String tokenHash;
 @Column(nullable=false,length=36) private String conversationId;
 @Column(nullable=false,length=16) private String role;
 @Column(nullable=false) private Long issuedBy;
 @Column(nullable=false) private java.time.Instant expiresAt;
 private java.time.Instant usedAt;
}
