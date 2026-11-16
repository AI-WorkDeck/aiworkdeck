// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.model.entity.lawfirm;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import java.time.Instant;
/**
 * 律所云端功能开关：每个律所一行，enabledFeatures 是已开启的功能键（逗号分隔，如 "clients,time"），
 * 默认为空即全部关闭；只有律所管理员能改。一行一个版本号，任一开关的改动都参与同一乐观校验。
 */
@Entity @Table(name="lawfirm_cloud_settings") @Getter @Setter
public class LawFirmCloudSettings {
    @Id @Column(length=128) private String firmId;
    @Column(nullable=false,length=512) private String enabledFeatures="";
    private Long updatedBy;
    private Instant updatedAt;
    @Version private long version;
}
