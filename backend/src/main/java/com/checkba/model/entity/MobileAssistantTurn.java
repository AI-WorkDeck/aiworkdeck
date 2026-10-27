// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.model.entity;
import jakarta.persistence.*;
import lombok.Data;

@Entity
@Table(name="mobile_assistant_turn", uniqueConstraints=@UniqueConstraint(columnNames={"user_id","request_id"}), indexes=@Index(name="idx_mobile_assistant_history",columnList="user_id,conversation_id,created_at"))
@Data
public class MobileAssistantTurn {
    @Id @GeneratedValue(strategy=GenerationType.IDENTITY) private Long id;
    @Column(nullable=false) private Long userId;
    @Column(nullable=false,length=36) private String conversationId;
    @Column(nullable=false,length=36) private String requestId;
    @Column(nullable=false,length=8000) private String question;
    @Column(length=24000) private String answer;
    @Column(nullable=false,length=24) private String status;
    @Column(nullable=false) private long attemptRevision;
    @Column(length=256000) private String sourcesJson;
    @Column(nullable=false) private java.time.Instant createdAt;
}
