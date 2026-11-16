// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.im;

/**
 * A client's upload exceeded a configured limit (B4). Rendered as {@code {code: 1, reason, limitBytes, message}} so the
 * portal can say in the reader's language whether one file was too large or the client's total is used up.
 */
public class ImLimitException extends IllegalArgumentException {
    public static final String FILE_TOO_LARGE = "FILE_TOO_LARGE", QUOTA_FULL = "UPLOAD_QUOTA_FULL";
    private final String reason;
    private final long limitBytes;

    public ImLimitException(String reason, long limitBytes, String message) {
        super(message);
        this.reason = reason;
        this.limitBytes = limitBytes;
    }

    public String getReason() { return reason; }

    public long getLimitBytes() { return limitBytes; }
}
