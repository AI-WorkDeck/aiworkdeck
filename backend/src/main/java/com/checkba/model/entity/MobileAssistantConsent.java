// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.model.entity;
import jakarta.persistence.*;
import lombok.Data;

@Entity
@Table(name="mobile_assistant_consent")
@Data
public class MobileAssistantConsent {
    @Id private Long userId;
    @Column(nullable=false) private boolean enabled;
    @Column(nullable=false,length=32) private String consentVersion;
    @Column(nullable=false) private long revision;
}
