// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.model.entity;
import jakarta.persistence.*;
import lombok.Data;

/** A durable move intent. The request and source locator never change on retry. */
@Entity
@Table(name="mobile_media_move", uniqueConstraints={
    @UniqueConstraint(columnNames={"user_id","request_id"}),
    @UniqueConstraint(columnNames={"user_id","source_client_media_id"}),
    @UniqueConstraint(columnNames={"user_id","target_client_media_id"})})
@Data
public class MobileMediaMove {
    @Id @GeneratedValue(strategy=GenerationType.IDENTITY) private Long id;
    @Column(nullable=false) private Long userId;
    @Column(nullable=false,length=36) private String requestId;
    @Column(nullable=false,length=36) private String sourceClientMediaId;
    @Column(nullable=false,length=36) private String targetClientMediaId;
    @Lob @Column(nullable=false) private String requestJson;
    @Lob @Column(nullable=false) private String sourceJson;
    @Column(nullable=false,length=24) private String status;
    @Column(nullable=false,length=36) private String commandId;
    @Column(nullable=false) private Long commandExpiresAt;
    @Column(nullable=false,length=1024) private String error="";
    @Column(nullable=false) private java.time.LocalDateTime createdAt;
}
