// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.model.entity;
import jakarta.persistence.*;
import lombok.Data;
import java.time.Instant;

@Entity
@Table(name="mobile_assistant_desktop_copy", uniqueConstraints=@UniqueConstraint(columnNames={"user_id","request_id"}),
    indexes=@Index(name="idx_assistant_copy_pending",columnList="user_id,target_device_id,status"))
@Data
public class MobileAssistantDesktopCopy {
    @Id @GeneratedValue(strategy=GenerationType.IDENTITY) private Long id;
    @Column(nullable=false) private Long userId;
    @Column(nullable=false,length=36) private String requestId;
    @Column(nullable=false,length=36) private String sourceConversationId;
    @Column(nullable=false,length=64) private String conversationId;
    @Column(nullable=false,length=36) private String targetProjectUid;
    @Column(nullable=false,length=64) private String targetDeviceId;
    @Column(nullable=false,length=64) private String targetProjectKey;
    @Column(nullable=false,length=16) private String status;
    @Column(nullable=false) private long consentRevision;
    @Column(columnDefinition="TEXT") private String snapshotJson;
    @Column(nullable=false,columnDefinition="TEXT") private String sourceTurnIdsJson;
    @Column(nullable=false,length=64) private String sha256;
    @Column(nullable=false) private int messageCount;
    @Column(nullable=false) private Instant expiresAt;
    @Column(nullable=false) private Instant createdAt;
    private Instant deliveredAt;
    @Column(length=64) private String error;
}
