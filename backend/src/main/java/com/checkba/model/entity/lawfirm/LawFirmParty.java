// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.model.entity.lawfirm;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.Instant;

/**
 * 主体（本机台账）：客户与非客户主体（股东、实际控制人、供应商、配偶等）同一张表，
 * {@link #client} 为真即客户档案。收案 {@link LawFirmMatterIntake#getClientId()} 指向客户行；
 * 主体之间的关系在 {@link LawFirmPartyRelation}。利冲引擎沿这份主体与关系检索。
 * 收案上的 clientName/clientCreditCode 是提交当时的快照，现行信息以本表为准。
 */
@Entity
@Table(name = "lawfirm_party")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class LawFirmParty {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /** 是否本所客户；非客户主体只参与关系与利冲检索。 */
    @Builder.Default
    @Column(name = "is_client")
    private Boolean client = false;

    /** 客户编号（KH-年份-序号），非客户主体为空。 */
    @Column(length = 32, unique = true)
    private String clientNo;

    @Column(length = 256, nullable = false)
    private String name;

    @Column(length = 128)
    private String creditCode;

    /** ORGANIZATION / INDIVIDUAL */
    @Column(length = 32)
    private String partyType;

    @Column(length = 128)
    private String industry;

    @Column(length = 512)
    private String address;

    /** [{name, title, phone, email}] */
    @Column(columnDefinition = "TEXT")
    private String contactsJson;

    /** 客户维护人 */
    private Long ownerUserId;

    @Column(length = 128)
    private String ownerName;

    /** 主办合伙人 */
    private Long partnerUserId;

    @Column(length = 128)
    private String partnerName;

    @Column(columnDefinition = "TEXT")
    private String notes;

    /** 手动登记的联系记录 [{date, channel, note, byUserId, byName}]，最新在前，最多 50 条。 */
    @Column(columnDefinition = "TEXT")
    private String contactLogJson;

    /** INTAKE（收案时建档或由旧收案归集）/ MANUAL / RELATION（登记关系时建的非客户主体） */
    @Column(length = 32)
    private String source;

    private Long createdByUserId;
    private Instant createdAt;
    private Instant updatedAt;

    public boolean isClientParty() {
        return Boolean.TRUE.equals(client);
    }
}
