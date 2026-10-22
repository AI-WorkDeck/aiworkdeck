// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.model.entity;

import jakarta.persistence.*;

@Entity @Table(name="im_message",uniqueConstraints=@UniqueConstraint(columnNames={"conversation_id","sender_id","client_message_id"}),indexes=@Index(columnList="conversation_id,id")) @lombok.Data
public class ImMessage {
 @Id @GeneratedValue(strategy=GenerationType.IDENTITY) private Long id;
 @Column(nullable=false,length=36,unique=true) private String uid;
 @Column(name="conversation_id",nullable=false,length=36) private String conversationId;
 @Column(name="sender_id",nullable=false) private Long senderId;
 @Column(name="client_message_id",nullable=false,length=100) private String clientMessageId;
 @Column(nullable=false,length=8000) private String text;
 @Column(length=36) private String attachmentId;
 @Column(nullable=false) private java.time.Instant createdAt;
 @Column(length=16) private String actorType;
 @Column(length=128) private String agentName;
}
