// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.messagecenter;

/** Recheck current business membership before exposing persisted notification text or its target. */
public interface MessageCenterAccessPolicy {
    String sourceId();
    /** False means denied; transient authority failures must throw so an incomplete inbox is not shown as empty. */
    boolean canAccess(Long userId, String eventKey);
}
