// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.model.entity;

import jakarta.persistence.*;

@Entity @Table(name="im_conversation") @lombok.Data
public class ImConversation {
 @Id @Column(length=36) private String id;
 @Column(nullable=false,length=128) private String title;
 @Column(nullable=false,length=16) private String type;
 @Column(nullable=false) private Long ownerId;
 @Column(nullable=false) private java.time.Instant createdAt;
 private java.time.Instant lastMessageAt;
}
