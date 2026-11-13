// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.model.entity.lawfirm;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import java.time.Instant;
/** 律所是否开启「云端工时汇总」（律所管理员按律所开启，默认关闭）。 */
@Entity @Table(name="lawfirm_cloud_billing_setting") @Getter @Setter
public class LawFirmCloudBillingSetting {
    @Id @Column(length=128) private String firmId;
    @Column(nullable=false) private boolean enabled;
    private Long updatedBy;
    private Instant updatedAt;
    @Version private long version;
}
