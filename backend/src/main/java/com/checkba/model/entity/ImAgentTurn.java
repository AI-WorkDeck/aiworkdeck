// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.model.entity;

import jakarta.persistence.*;
import java.time.Instant;

/** One durable receipt per human message; queued context stays in memory, never in this table. */
@Entity @Table(name="im_agent_turn", indexes={@Index(columnList="conversation_id,updated_at"), @Index(columnList="requested_by,updated_at")})
@lombok.Data
public class ImAgentTurn {
 @Id @Column(name="source_message_id") private Long sourceMessageId;
 @Column(name="conversation_id",nullable=false,length=36) private String conversationId;
 @Column(name="requested_by",nullable=false) private Long requestedBy;
 @Column(nullable=false,length=16) private String status;
 @Column(nullable=false) private int attempts;
 @Column(nullable=false) private Instant createdAt;
 @Column(name="updated_at",nullable=false) private Instant updatedAt;
 private Long agentMessageId;
 @Column(length=300) private String error;
}
