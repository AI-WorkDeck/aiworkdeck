// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.im;

/**
 * Audit hook for client-portal project chat (B4). Implemented by the firm audit log once it is on master; until then
 * there is no bean and {@link ImService} records nothing. Implementations must never throw and must keep details to
 * fixed scalar keys: no message text, access codes or session tokens.
 */
public interface ClientPortalChatAudit {
    /** A client holding an access code entered the project group for the first time. */
    void joined(Long clientUserId, Long projectId, String conversationId, String conversationTitle, boolean shareHistory);

    /**
     * A client's chat request was refused. {@code reason} is one of {@link ImService#DENIED_CODE_INACTIVE},
     * {@link ImService#DENIED_OUT_OF_SCOPE}, {@link ImService#DENIED_ACTION}.
     */
    void denied(Long clientUserId, Long projectId, String reason);
}
