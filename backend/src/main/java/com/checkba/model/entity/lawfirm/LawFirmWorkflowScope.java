// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.model.entity.lawfirm;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
/** A database mutex only: no copied firm directory, members, legacy cases or financial data. */
@Entity @Table(name="lawfirm_workflow_scope") @Getter @Setter
public class LawFirmWorkflowScope {
    @Id @Column(length=128) private String firmId;
}
