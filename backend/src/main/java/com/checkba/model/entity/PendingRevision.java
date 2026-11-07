// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.model.entity;

import jakarta.persistence.*;

import java.time.LocalDateTime;

/**
 * 外部 Agent（本机 MCP propose_revision）提交的待审修订。提案只落这张表，不碰文件；
 * 用户接受时才经编辑器以修订模式（redline）套用，拒绝即删除记录。
 * 样板同 ProjectTask：手写 getter/setter，不用 Lombok @Data。
 */
@Entity
@Table(name = "pending_revision", indexes = {
        @Index(name = "idx_pending_revision_file", columnList = "file_id"),
        @Index(name = "idx_pending_revision_project", columnList = "project_id")
})
public class PendingRevision {

    public static final String PENDING = "PENDING";
    public static final String STALE = "STALE";

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "file_id", nullable = false)
    private Long fileId;

    @Column(name = "project_id", nullable = false)
    private Long projectId;

    /** 提案时的文件版本令牌（见 PendingRevisionService.fileVersion）。 */
    @Column(name = "base_version", nullable = false, length = 64)
    private String baseVersion;

    /** [{find, replace, reason}] 的 JSON。 */
    @Column(name = "edits_json", columnDefinition = "TEXT", nullable = false)
    private String editsJson;

    /** 来源，如 "mcp:claude-code"。 */
    @Column(nullable = false, length = 128)
    private String source;

    /** PENDING | STALE */
    @Column(nullable = false, length = 16)
    private String status = PENDING;

    @Column(name = "created_at", nullable = false)
    private LocalDateTime createdAt;

    @Column(name = "created_by", nullable = false)
    private Long createdBy;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public Long getFileId() { return fileId; }
    public void setFileId(Long fileId) { this.fileId = fileId; }
    public Long getProjectId() { return projectId; }
    public void setProjectId(Long projectId) { this.projectId = projectId; }
    public String getBaseVersion() { return baseVersion; }
    public void setBaseVersion(String baseVersion) { this.baseVersion = baseVersion; }
    public String getEditsJson() { return editsJson; }
    public void setEditsJson(String editsJson) { this.editsJson = editsJson; }
    public String getSource() { return source; }
    public void setSource(String source) { this.source = source; }
    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }
    public LocalDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }
    public Long getCreatedBy() { return createdBy; }
    public void setCreatedBy(Long createdBy) { this.createdBy = createdBy; }
}
