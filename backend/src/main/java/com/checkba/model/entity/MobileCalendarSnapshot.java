// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.model.entity;
import jakarta.persistence.*;
import lombok.Data;
import java.time.Instant;
@Entity
@Table(name="mobile_calendar_snapshot", uniqueConstraints=@UniqueConstraint(columnNames={"user_id","device_id"}))
@Data
public class MobileCalendarSnapshot {
    @Id @GeneratedValue(strategy=GenerationType.IDENTITY) private Long id;
    @Column(nullable=false) private Long userId;
    @Column(nullable=false,length=64) private String deviceId;
    @Column(nullable=false) private Instant sourceUpdatedAt;
    @Column(nullable=false) private Instant syncedAt;
    @Column(nullable=false,columnDefinition="TEXT") private String eventsJson;
}
