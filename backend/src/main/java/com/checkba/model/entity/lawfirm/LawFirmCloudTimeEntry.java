// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.model.entity.lawfirm;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import java.time.Instant;
import java.time.LocalDate;
/**
 * 律师提交到律所云端的一条工时：日期、分钟、工作内容描述、事项、是否收费，以及合伙人的审核结论。
 * 不含费率与金额——费率、账单、发票都只在合伙人本机台账里。
 * 状态：SUBMITTED（律师已提交）→ RECEIVED（合伙人已取回）→ APPROVED / RETURNED → BILLED。
 */
@Entity @Table(name="lawfirm_cloud_time_entry",
        indexes={@Index(name="idx_lf_cloud_time_matter",columnList="matter_id, status"),@Index(name="idx_lf_cloud_time_lawyer",columnList="firm_id, lawyer_id")},
        uniqueConstraints=@UniqueConstraint(name="uk_lf_cloud_time_client",columnNames={"firm_id","lawyer_id","client_key"}))
@Getter @Setter
public class LawFirmCloudTimeEntry {
    @Id @Column(length=36) private String id;
    @Column(nullable=false,length=128) private String firmId;
    @Column(nullable=false,length=36) private String matterId;
    @Column(nullable=false) private Long lawyerId;
    @Column(length=128) private String lawyerName;
    /** 律师本机工时的编号，用于重复提交时幂等。 */
    @Column(nullable=false,length=64) private String clientKey;
    @Column(nullable=false) private LocalDate workDate;
    @Column(nullable=false) private int minutes;
    @Column(length=1000) private String description;
    @Column(nullable=false) private boolean billable;
    @Column(nullable=false,length=16) private String status;
    private Integer billedMinutes;
    @Column(length=1000) private String reviewedDescription;
    private Boolean reviewedBillable;
    /** JSON 数组：[{action, actorName, reason, at}]，合伙人本机审核痕迹的副本，供律师查看。 */
    @Column(columnDefinition="TEXT") private String reviewJson;
    @Column(length=64) private String billNo;
    private Instant submittedAt;
    private Instant updatedAt;
    @Version private long version;
}
