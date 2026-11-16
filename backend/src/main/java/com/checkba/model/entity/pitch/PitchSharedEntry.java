// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.model.entity.pitch;

import jakarta.persistence.*;
import java.time.Instant;
import lombok.Getter;
import lombok.Setter;

/**
 * 律师在「投标与提案」里选择分享出去的一条业绩或律师简历（律所云端 pitch 功能）。
 * 只存作者选定分享的字段（payloadJson）；真实客户名仅在作者勾选时随行保存。撤回后清空内容，只留使用记录的指向。
 */
@Entity
@Table(name = "pitch_shared_entry",
        uniqueConstraints = @UniqueConstraint(name = "uk_pitch_entry_owner_local", columnNames = {"firm_id", "owner_user_id", "local_id"}),
        indexes = @Index(name = "idx_pitch_entry_firm", columnList = "firm_id, withdrawn_at"))
@Getter
@Setter
public class PitchSharedEntry {
    @Id
    @Column(length = 36)
    private String id;
    @Column(name = "firm_id", nullable = false, length = 128)
    private String firmId;
    @Column(name = "owner_user_id", nullable = false)
    private Long ownerUserId;
    @Column(name = "owner_name", length = 128)
    private String ownerName;
    /** 作者本机库里的条目 id（同一作者同一条只占一行，再次分享即更新）。 */
    @Column(name = "local_id", nullable = false, length = 64)
    private String localId;
    /** credential | lawyer */
    @Column(nullable = false, length = 16)
    private String kind;
    /** team | firm */
    @Column(nullable = false, length = 8)
    private String scope;
    /** scope=team 时可见的团队（逗号分隔，分享时从作者当时所在团队中选定）。 */
    @Column(name = "team_ids", length = 1024)
    private String teamIds;
    @Column(name = "include_client", nullable = false)
    private boolean includeClient;
    @Column(name = "payload_json", columnDefinition = "TEXT")
    private String payloadJson;
    @Column(name = "created_at", nullable = false)
    private Instant createdAt;
    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;
    @Column(name = "withdrawn_at")
    private Instant withdrawnAt;
    @Version
    private long version;
}
