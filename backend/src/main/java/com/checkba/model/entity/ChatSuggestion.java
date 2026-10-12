// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.model.entity;

import jakarta.persistence.*;
import lombok.Data;
import java.time.LocalDateTime;

/** Desktop-local suggestion evidence, never part of the telemetry ledger. */
@Data
@Entity
@Table(name = "chat_suggestion", indexes = @Index(name = "idx_chat_suggestion_owner", columnList = "user_id, conversation_id, created_at"))
public class ChatSuggestion {
    @Id @Column(length = 36) private String id;
    @Column(name = "user_id", nullable = false) private Long userId;
    @Column(name = "conversation_id", nullable = false, length = 64) private String conversationId;
    @Column(nullable = false) private Long sourceMessageId;
    @Column(length = 160) private String modelId;
    @Column(length = 240) private String text;
    @Column(length = 16) private String outcome;
    @Column(length = 128) private String clientRequestId;
    @Column(length = 500) private String correction;
    @Column(name = "created_at", nullable = false) private LocalDateTime createdAt;
}
