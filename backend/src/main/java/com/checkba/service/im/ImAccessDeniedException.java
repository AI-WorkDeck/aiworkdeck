// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.im;

/**
 * A chat request refused for an access-code client (B4). Rendered as the usual {@code {code: 1, message}} plus a
 * machine {@code reason}, so the portal can tell "this chat is no longer yours" (stop polling) from an ordinary
 * business error such as an empty file (show it and carry on).
 */
public class ImAccessDeniedException extends IllegalArgumentException {
    private final String reason;

    public ImAccessDeniedException(String reason, String message) {
        super(message);
        this.reason = reason;
    }

    public String getReason() {
        return reason;
    }
}
