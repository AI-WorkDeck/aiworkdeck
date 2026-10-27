// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.model.entity;
import jakarta.persistence.*;
import lombok.Data;
import java.time.Instant;
@Entity
@Table(name="mobile_calendar_push_device",uniqueConstraints=@UniqueConstraint(columnNames={"token"}))
@Data
public class MobileCalendarPushDevice {
    @Id @Column(length=36) private String installationId;
    @Column(nullable=false) private Long userId;
    @Column(nullable=false,length=256) private String token;
    @Column(nullable=false,length=16) private String environment;
    @Column(nullable=false) private Instant registeredAt;
}
