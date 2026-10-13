// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.model.entity;

import jakarta.persistence.*;

@Entity @Table(name="im_attachment",uniqueConstraints=@UniqueConstraint(columnNames={"conversation_id","uploaded_by","client_message_id"}),indexes=@Index(columnList="conversation_id")) @lombok.Data
public class ImAttachment {
 @Id @Column(length=36) private String id;
 @Column(name="conversation_id",nullable=false,length=36) private String conversationId;
 @Column(name="uploaded_by",nullable=false) private Long uploadedBy;
 @Column(name="client_message_id",length=100) private String clientMessageId;
 @Column(nullable=false,length=180) private String name;
 @Column(nullable=false) private long size;
 @Column(nullable=false,length=64) private String sha256;
 @Column(nullable=false) private boolean clientVisible;
 @Column(length=36) private String sourceProjectUid;
 @Column(length=36) private String sourceFileUid;
 @org.hibernate.annotations.JdbcTypeCode(org.hibernate.type.SqlTypes.LONGVARBINARY)
 // PostgreSQL and desktop H2 PostgreSQL mode use bytea; a large inferred length becomes unsupported BLOB in H2.
 @Basic(fetch=FetchType.LAZY) @Column(nullable=false,columnDefinition="bytea") private byte[] content;
 @Column(nullable=false) private java.time.Instant createdAt;
}
