// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.exception;

import com.checkba.service.LangText;

/**
 * Per-user rate limit exceeded ({@link com.checkba.service.UserRateLimiter}). Rendered as HTTP 429
 * with a Retry-After header by GlobalExceptionHandler.
 *
 * <p>Message must not contain 「登录」「未授权」「请先」: older clients match those substrings on
 * error messages and would clear the session.
 */
public class RateLimitedException extends RuntimeException {

    private final long retryAfterSeconds;

    public RateLimitedException(long retryAfterSeconds) {
        super(message(retryAfterSeconds));
        this.retryAfterSeconds = retryAfterSeconds;
    }

    /** Same 429 shape with a more specific, already localized message (e.g. project chat「发送太快」). */
    public RateLimitedException(long retryAfterSeconds, String message) {
        super(message);
        this.retryAfterSeconds = retryAfterSeconds;
    }

    public long getRetryAfterSeconds() {
        return retryAfterSeconds;
    }

    public static String message(long retryAfterSeconds) {
        return LangText.of("操作太频繁，请 " + retryAfterSeconds + " 秒后再试",
                "Too many requests. Please try again in " + retryAfterSeconds + " seconds");
    }
}
