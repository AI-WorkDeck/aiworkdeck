// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.im;

import com.checkba.service.audit.FirmAuditLog;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Component;

/**
 * Client-portal project chat in the firm audit log (B4 on S20): category CLIENT, action CLIENT_PORTAL_CHAT_JOINED, and
 * the same action marked failed for a refusal. Details are fixed scalar keys only ({@code shareHistory},
 * {@code reason}); never message text, access codes or session tokens. A no-op where the audit log is off (desktop).
 */
@Component
public class FirmClientPortalChatAudit implements ClientPortalChatAudit {
    public static final String CATEGORY = "CLIENT", ACTION = "CLIENT_PORTAL_CHAT_JOINED";
    private final ObjectProvider<FirmAuditLog> audit;

    public FirmClientPortalChatAudit(ObjectProvider<FirmAuditLog> audit) {
        this.audit = audit;
    }

    @Override
    public void joined(Long clientUserId, Long projectId, String conversationId, String conversationTitle, boolean shareHistory) {
        FirmAuditLog log = audit.getIfAvailable();
        if (log == null) return;
        log.record(FirmAuditLog.event(CATEGORY, ACTION).actor(clientUserId).project(projectId)
                .target("CONVERSATION", conversationId, conversationTitle).detail("shareHistory", shareHistory));
    }

    @Override
    public void denied(Long clientUserId, Long projectId, String reason) {
        FirmAuditLog log = audit.getIfAvailable();
        if (log == null) return;
        FirmAuditLog.Event e = FirmAuditLog.event(CATEGORY, ACTION).failed().actor(clientUserId).detail("reason", reason);
        // A refusal for a code that no longer works has no project left to file it under: the client's own firm then.
        if (projectId != null) e.project(projectId); else e.firmOf(clientUserId);
        // The refused request rolls back; the record must not wait for a commit that never comes.
        log.recordNow(e);
    }
}
