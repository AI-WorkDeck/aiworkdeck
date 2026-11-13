// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.model.entity.pitch;

import jakarta.persistence.*;
import java.time.Instant;
import lombok.Getter;
import lombok.Setter;

/** 同事把一条共享业绩/简历用进自己的投标材料时留下的记录，作者可以查看自己的经验被用在了哪里。 */
@Entity
@Table(name = "pitch_entry_use", indexes = @Index(name = "idx_pitch_use_entry", columnList = "entry_id, used_at"))
@Getter
@Setter
public class PitchEntryUse {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    @Column(name = "firm_id", nullable = false, length = 128)
    private String firmId;
    @Column(name = "entry_id", nullable = false, length = 36)
    private String entryId;
    @Column(name = "used_by_user_id", nullable = false)
    private Long usedByUserId;
    @Column(name = "used_by_name", length = 128)
    private String usedByName;
    /** 用在哪份材料：使用人填写的项目/文件名称（截断到 200 字）。 */
    @Column(length = 200)
    private String label;
    @Column(name = "used_at", nullable = false)
    private Instant usedAt;
}
