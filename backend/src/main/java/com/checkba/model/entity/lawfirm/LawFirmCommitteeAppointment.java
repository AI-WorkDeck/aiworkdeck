// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.model.entity.lawfirm;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import java.time.Instant;
@Entity @Table(name="lawfirm_committee_appointment", uniqueConstraints=@UniqueConstraint(columnNames={"firm_id","user_id"}))
@Getter @Setter
public class LawFirmCommitteeAppointment {
    @Id @Column(length=36) private String id;
    @Column(name="firm_id",nullable=false,length=128) private String firmId;
    @Column(name="user_id",nullable=false) private Long userId;
    @Column(nullable=false) private Long appointedBy;
    @Column(nullable=false,length=20) private String state;
    @Version private long version;
    private Instant updatedAt;
}
