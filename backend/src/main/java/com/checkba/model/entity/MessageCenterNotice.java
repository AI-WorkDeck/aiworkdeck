// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.model.entity;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import java.time.Instant;

/** One account-owned delivery; recipient identity is always the server user ID. */
@Entity
@Table(name="message_center_notice", uniqueConstraints=@UniqueConstraint(name="uk_message_center_delivery",
        columnNames={"recipient_id","source_id","event_key"}), indexes={
        @Index(name="idx_message_center_recipient", columnList="recipient_id,created_at")})
@Getter @Setter
public class MessageCenterNotice {
    @Id @Column(length=36) private String id;
    @Column(name="recipient_id",nullable=false) private Long recipientId;
    @Column(name="sender_id",nullable=false) private Long senderId;
    @Column(name="source_id",nullable=false,length=100) private String sourceId;
    @Column(name="source_kind",nullable=false,length=16) private String sourceKind;
    @Column(name="source_name",nullable=false,length=128) private String sourceName;
    @Column(name="event_key",nullable=false,length=160) private String eventKey;
    @Column(name="project_id") private Long projectId;
    @Column(nullable=false,length=40) private String kind;
    @Column(nullable=false,length=256) private String title;
    @Column(nullable=false,length=4000) private String body;
    @Column(name="action_state",nullable=false,length=16) private String actionState;
    @Column(name="target_json",nullable=false,length=2048) private String targetJson;
    @Column(name="payload_hash",nullable=false,length=64) private String payloadHash;
    @Column(name="created_at",nullable=false) private Instant createdAt;
    @Column(name="read_at") private Instant readAt;
    @Column(name="updated_at",nullable=false) private Instant updatedAt;
}
