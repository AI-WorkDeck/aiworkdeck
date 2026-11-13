// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.model.entity.lawfirm;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import jakarta.persistence.Version;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.Instant;
import java.time.LocalDate;

/**
 * 计费工时条目（本机台账）。来源两种：工作记录（user_activity_log 按「项目 × 日」汇总，source=WORK_RECORD，
 * sourceKey 防重复生成）和律师手动补录（MANUAL）。状态：DRAFT（律师可改）→ SUBMITTED（待审核）→
 * APPROVED（审核通过，可出账单）/ RETURNED（退回律师）→ BILLED（已进账单，billId 非空）；DISMISSED 为律师忽略的
 * 工作记录汇总（保留以免重新生成）。金额一律用分；时长一律用整数分钟。
 */
@Entity
@Table(name = "lawfirm_time_entry", indexes = {
        @Index(name = "idx_lf_time_entry_user_date", columnList = "user_id, work_date"),
        @Index(name = "idx_lf_time_entry_status", columnList = "status"),
        @Index(name = "idx_lf_time_entry_bill", columnList = "bill_id")
}, uniqueConstraints = {
        @UniqueConstraint(name = "uk_lf_time_entry_source", columnNames = {"user_id", "source_key"})
})
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class LawFirmTimeEntry {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Version
    private Long version;

    /** 计时人（律师）。 */
    @Column(nullable = false)
    private Long userId;

    @Column(length = 128)
    private String timekeeperName;

    /** 工作台项目（与工作记录同一个键）。 */
    private Long projectId;

    /** 收案/事项；为空时按 projectId 推导，审核通过时固定下来。 */
    private Long intakeId;

    @Column(nullable = false)
    private LocalDate workDate;

    /** 工作记录自动累计的分钟数（已扣空闲，按 6 分钟向上取整）；手动补录为空。 */
    private Integer capturedMinutes;

    /** 律师申报的分钟数。 */
    @Column(nullable = false)
    private Integer minutes;

    /** 审核后计费的分钟数（核减后）；未审核时为空，按 minutes 计。 */
    private Integer billedMinutes;

    @Column(length = 1000)
    private String description;

    /** 律师申报时是否标为可收费（用于计算核销/不收费造成的实现率损失）。 */
    @Builder.Default
    private Boolean billableClaimed = true;

    /** 当前是否收费（审核人可改为不收费）。 */
    @Builder.Default
    private Boolean billable = true;

    @Column(length = 32, nullable = false)
    private String source;

    @Column(length = 96)
    private String sourceKey;

    /** 律师在草稿阶段改过时长或描述后，重新从工作记录生成不再覆盖。 */
    @Builder.Default
    private Boolean edited = false;

    @Column(length = 32, nullable = false)
    private String status;

    /** 审核通过时固定的适用费率与标准费率（分/小时）。 */
    private Long rateCents;
    private Long standardRateCents;

    private Long billId;

    private Long reviewedByUserId;

    @Column(length = 128)
    private String reviewedByName;

    private Instant submittedAt;
    private Instant reviewedAt;
    private Instant createdAt;
    private Instant updatedAt;

    public int effectiveBilledMinutes() {
        return billedMinutes != null ? billedMinutes : (minutes == null ? 0 : minutes);
    }
}
