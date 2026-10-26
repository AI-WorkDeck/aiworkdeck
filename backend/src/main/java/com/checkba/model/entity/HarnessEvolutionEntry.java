// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.model.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.Lob;
import jakarta.persistence.Table;

import java.time.LocalDateTime;

/**
 * Harness 自进化记录的持久化行（dev-board#1481）。
 *
 * <p>规则正文写在记忆文档里（下一轮注入上下文靠它）；这张表保存的是<b>卡片与管理入口</b>需要的索引：
 * 作用域切换、升格技能、撤销都要按 id 找回记录的记忆空间/路径/修订号与状态，进程重启后也必须找得到。
 * 完整记录以 JSON 存进 {@code payload_json}（字段随记录演进不必改表），查询维度单独成列并建索引。
 * 四个 profile 均为 {@code ddl-auto: update}，本表由 JPA 自动建出，无需迁移脚本。
 */
@Entity
@Table(name = "ai_harness_evolution", indexes = {
        @Index(name = "idx_harness_evo_user_created", columnList = "user_id, created_at"),
        @Index(name = "idx_harness_evo_conversation", columnList = "conversation_id")
})
public class HarnessEvolutionEntry {

    @Id
    @Column(length = 32)
    private String id;

    @Column(name = "user_id")
    private Long userId;

    @Column(name = "project_id")
    private Long projectId;

    @Column(name = "conversation_id", length = 64)
    private String conversationId;

    @Column(length = 16)
    private String scope;

    @Column(length = 24)
    private String status;

    @Lob
    @Column(name = "payload_json", nullable = false, columnDefinition = "TEXT")
    private String payloadJson;

    @Column(name = "created_at", nullable = false)
    private LocalDateTime createdAt = LocalDateTime.now();

    @Column(name = "updated_at", nullable = false)
    private LocalDateTime updatedAt = LocalDateTime.now();

    public String getId() { return id; }
    public void setId(String id) { this.id = id; }

    public Long getUserId() { return userId; }
    public void setUserId(Long userId) { this.userId = userId; }

    public Long getProjectId() { return projectId; }
    public void setProjectId(Long projectId) { this.projectId = projectId; }

    public String getConversationId() { return conversationId; }
    public void setConversationId(String conversationId) { this.conversationId = conversationId; }

    public String getScope() { return scope; }
    public void setScope(String scope) { this.scope = scope; }

    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }

    public String getPayloadJson() { return payloadJson; }
    public void setPayloadJson(String payloadJson) { this.payloadJson = payloadJson; }

    public LocalDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }

    public LocalDateTime getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(LocalDateTime updatedAt) { this.updatedAt = updatedAt; }
}
