// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.model.entity.lawfirm;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import java.time.Instant;
/** 合伙人从本机收案发布到律所云端、供同事提交工时的事项。只存事项名称与委托人名称，不存收费、利冲或项目文件。 */
@Entity @Table(name="lawfirm_cloud_matter", indexes=@Index(name="idx_lf_cloud_matter_firm",columnList="firm_id")) @Getter @Setter
public class LawFirmCloudMatter {
    @Id @Column(length=36) private String id;
    @Column(nullable=false,length=128) private String firmId;
    /** 发布人（律所管理员），也是唯一能取回并审核该事项工时的人。 */
    @Column(nullable=false) private Long ownerId;
    @Column(length=128) private String ownerName;
    @Column(nullable=false,length=256) private String title;
    @Column(length=256) private String clientName;
    @Column(nullable=false) private boolean active;
    private Instant createdAt;
    private Instant updatedAt;
    @Version private long version;
}
