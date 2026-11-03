// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.model.entity;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import java.time.LocalDateTime;

/** Durable import tombstone: intentionally retained when its conversation is deleted. */
@Entity
@Table(name = "desktop_assistant_copy_receipt")
@Getter @Setter
public class DesktopAssistantCopyReceipt {
    @Id @Column(length = 64) private String id;
    @Column(nullable = false, length = 64) private String accountScope;
    @Column(nullable = false, length = 64) private String requestId;
    @Column(nullable = false) private Long projectId;
    @Column(nullable = false, length = 64) private String projectUid;
    @Column(nullable = false, length = 64) private String conversationId;
    @Column(nullable = false, length = 64) private String sha256;
    @Column(nullable = false) private int messageCount;
    @Column(nullable = false, length = 32) private String sourceChannel = "mobile-assistant";
    @Column(nullable = false) private LocalDateTime importedAt;
    @Column(length = 128) private String targetDeviceId;
    private LocalDateTime acknowledgedAt;
}
