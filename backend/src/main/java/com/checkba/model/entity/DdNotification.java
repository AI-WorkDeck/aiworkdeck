// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.model.entity;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import java.time.LocalDateTime;

/** Persistent in-product inbox; this is not a claim that an OS push was delivered. */
@Entity
@Table(name = "dd_notification", uniqueConstraints = @UniqueConstraint(
    name = "uk_dd_notification_event", columnNames = {"recipient_id", "event_key"}))
@Getter
@Setter
public class DdNotification {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY) private Long id;
    @Column(name = "project_id", nullable = false) private Long projectId;
    @Column(name = "recipient_id", nullable = false) private Long recipientId;
    @Column(name = "event_key", length = 160, nullable = false) private String eventKey;
    private Long requestId;
    private Long itemId;
    private Long submissionId;
    @Column(length = 32, nullable = false) private String kind;
    @Column(length = 512, nullable = false) private String title;
    @Column(nullable = false) private LocalDateTime createdAt;
    private LocalDateTime readAt;
    /** Derived from the current checklist state, never from the read receipt. */
    @Transient private String actionState = "none";

    /** Additive JSON fields: the producer's time zone, never the receiving desktop's, locates the timestamp. */
    @Transient public String getCreatedAtIso() {
        return createdAt == null ? null : createdAt.atZone(java.time.ZoneId.systemDefault()).toInstant().toString();
    }
    @Transient public String getReadAtIso() {
        return readAt == null ? null : readAt.atZone(java.time.ZoneId.systemDefault()).toInstant().toString();
    }
}
