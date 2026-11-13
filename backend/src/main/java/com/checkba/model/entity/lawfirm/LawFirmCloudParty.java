// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.model.entity.lawfirm;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import lombok.Data;

import java.time.Instant;

/**
 * 律所云端主体（服务器端，按律所隔离）：律所管理员开启「客户管理」云端功能后，本所客户与关联主体放在这里，
 * 供全所共享与云端利冲检索。字段与本机 {@link LawFirmParty} 对应；userId 是云端账户的用户 id。
 * 只保存客户档案信息，不保存收案、收费或回款。
 */
@Entity
@Table(name = "lawfirm_cloud_party")
@Data
public class LawFirmCloudParty {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(length = 64, nullable = false)
    private String firmId;

    @Column(name = "is_client")
    private boolean client;

    @Column(length = 32)
    private String clientNo;

    @Column(length = 256, nullable = false)
    private String name;

    @Column(length = 128)
    private String creditCode;

    @Column(length = 32)
    private String partyType;

    @Column(length = 128)
    private String industry;

    @Column(length = 512)
    private String address;

    @Column(columnDefinition = "TEXT")
    private String notes;

    /** [{name, title, phone, email}] */
    @Column(columnDefinition = "TEXT")
    private String contactsJson;

    /**
     * 上传来源（上传者 userId + 本机主体 id，形如 {@code 12:345}）。重复上传靠它对上同一行——
     * 自然人不按姓名合并，没有证件号时只能这样认出「还是那一位」。
     */
    @Column(length = 64)
    private String importKey;

    private Long ownerUserId;
    private Long partnerUserId;
    private Long createdBy;
    private Instant createdAt;
    private Instant updatedAt;

    @Version
    private long version;
}
