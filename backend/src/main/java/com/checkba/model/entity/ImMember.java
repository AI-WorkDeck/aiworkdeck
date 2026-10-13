// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.model.entity;

import jakarta.persistence.*;

@Entity @Table(name="im_member", uniqueConstraints=@UniqueConstraint(columnNames={"conversation_id","user_id"})) @lombok.Data
public class ImMember {
 @Id @GeneratedValue(strategy=GenerationType.IDENTITY) private Long id;
 @Column(name="conversation_id",nullable=false,length=36) private String conversationId;
 @Column(name="user_id",nullable=false) private Long userId;
 @Column(nullable=false,length=16) private String role;
 @Column(nullable=false) private long lastReadId;
 @Column(nullable=false) private java.time.Instant joinedAt;
}
