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

/** 律所云端主体之间的有向关系，类型与本机 {@link LawFirmPartyRelation} 相同。 */
@Entity
@Table(name = "lawfirm_cloud_relation")
@Data
public class LawFirmCloudRelation {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(length = 64, nullable = false)
    private String firmId;

    @Column(nullable = false)
    private Long fromPartyId;

    @Column(nullable = false)
    private Long toPartyId;

    @Column(length = 32, nullable = false)
    private String relationType;

    private Integer shareBps;

    @Column(length = 256)
    private String note;

    private Long createdBy;
    private Instant createdAt;

    @Version
    private long version;
}
