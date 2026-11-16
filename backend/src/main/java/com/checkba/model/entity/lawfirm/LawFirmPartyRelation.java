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
 * 主体之间的有向关系：from 对 to 是 relationType。只存直接关系；间接股东/子公司由
 * {@code LawFirmPartyGraph} 沿股权链推导。类型见 {@code LawFirmPartyGraph.TYPES}：
 * SHAREHOLDER（from 持有 to 股权，shareBps 为持股比例×100，可空）、ACTUAL_CONTROLLER、SUPPLIER、
 * GUARANTOR（from 为 to 担保），以及无方向的 SPOUSE / FAMILY / CONCERTED_ACTOR / AFFILIATE / OTHER。
 */
@Entity
@Table(name = "lawfirm_party_relation")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class LawFirmPartyRelation {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false)
    private Long fromPartyId;

    @Column(nullable = false)
    private Long toPartyId;

    @Column(length = 32, nullable = false)
    private String relationType;

    /** 持股比例（万分比，6000 = 60%）；仅 SHAREHOLDER 有意义。 */
    private Integer shareBps;

    @Column(length = 256)
    private String note;

    /** MANUAL / INTAKE（由收案登记的关联方转来） */
    @Column(length = 32)
    private String source;

    private Long createdByUserId;
    private Instant createdAt;
}
