// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.model.entity;

import jakarta.persistence.*;
import lombok.Data;
import lombok.EqualsAndHashCode;

import java.time.Instant;

/**
 * 律所管理员审计日志的一行（readiness S20）。只增不改：仓库只开放插入与读取，删除只有按保留期清理一条路。
 *
 * <p>每个律所一条哈希链：{@code hash = SHA-256(prevHash ‖ 规范化字段)}，见
 * {@link com.checkba.service.audit.FirmAuditLog}。不存文档内容、文件字节、提示词、口令与令牌。
 */
@Entity
@Table(name = "firm_audit_event", indexes = {
        @Index(name = "idx_firm_audit_firm_id", columnList = "firm_id, id"),
        @Index(name = "idx_firm_audit_firm_time", columnList = "firm_id, occurred_at")
})
@Data
@EqualsAndHashCode(onlyExplicitlyIncluded = true)
public class FirmAuditEvent {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @EqualsAndHashCode.Include
    private Long id;

    @Column(name = "firm_id", nullable = false, length = 64)
    private String firmId;

    /** 发生时间（毫秒精度，入链前已截断，读回与写入一致）。 */
    @Column(name = "occurred_at", nullable = false)
    private Instant occurredAt;

    @Column(nullable = false, length = 24)
    private String category;

    @Column(nullable = false, length = 48)
    private String action;

    /** SUCCESS / FAILURE。 */
    @Column(nullable = false, length = 16)
    private String outcome;

    @Column(name = "actor_user_id")
    private Long actorUserId;

    @Column(name = "actor_name", length = 128)
    private String actorName;

    @Column(name = "target_type", length = 32)
    private String targetType;

    @Column(name = "target_id", length = 64)
    private String targetId;

    @Column(name = "target_label", length = 256)
    private String targetLabel;

    @Column(name = "project_id")
    private Long projectId;

    @Column(name = "project_name", length = 256)
    private String projectName;

    @Column(name = "source_ip", length = 64)
    private String sourceIp;

    @Column(name = "user_agent", length = 256)
    private String userAgent;

    /** 调用点按固定键组装的小 JSON；从不来自请求体原文。 */
    @Column(name = "detail", columnDefinition = "TEXT")
    private String detail;

    @Column(name = "prev_hash", length = 64)
    private String prevHash;

    @Column(name = "hash", nullable = false, length = 64)
    private String hash;
}
