// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service;

import com.checkba.exception.RateLimitedException;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.util.EnumMap;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.LongSupplier;

/**
 * Per-user request limits for the expensive server endpoints: agent chat starts, file uploads,
 * OCR and browser-proxy fetches. One account (or a stolen session) must not be able to saturate
 * the shared server that every firm on it depends on.
 *
 * <p>Token bucket per (kind, user): capacity = the per-minute limit, refilled continuously at
 * limit/60 per second. A burst of up to the full limit is allowed, after which requests are
 * admitted at the sustained rate. A limit of 0 or less disables that kind.
 *
 * <p>Server mode only. In local mode (desktop/dev) every check is a no-op: the single user is
 * the machine owner and there is no shared tenant to protect.
 *
 * <p>Accepted limitation: buckets live in process memory. A restart resets them, and a
 * multi-instance deployment counts per instance; there the front nginx {@code limit_req}
 * must be the real limiter (same stance as {@link AuthAbuseGuard}).
 */
@Service
public class UserRateLimiter {

    public enum Kind { CHAT, UPLOAD, OCR, BROWSER_PROXY }

    private static final int PURGE_THRESHOLD = 10_000;

    private final boolean localMode;
    private final Map<Kind, Integer> perMinute = new EnumMap<>(Kind.class);
    private final LongSupplier nowMillis;
    private final Map<String, Bucket> buckets = new ConcurrentHashMap<>();

    @Autowired
    public UserRateLimiter(
            @Value("${security.local-mode:false}") boolean localMode,
            @Value("${security.rate-limit.chat-per-minute:30}") int chat,
            @Value("${security.rate-limit.upload-per-minute:300}") int upload,
            @Value("${security.rate-limit.ocr-per-minute:20}") int ocr,
            @Value("${security.rate-limit.browser-proxy-per-minute:120}") int browserProxy) {
        this(localMode, chat, upload, ocr, browserProxy, System::currentTimeMillis);
    }

    /** Test constructor with a controllable clock. */
    UserRateLimiter(boolean localMode, int chat, int upload, int ocr, int browserProxy, LongSupplier nowMillis) {
        this.localMode = localMode;
        perMinute.put(Kind.CHAT, chat);
        perMinute.put(Kind.UPLOAD, upload);
        perMinute.put(Kind.OCR, ocr);
        perMinute.put(Kind.BROWSER_PROXY, browserProxy);
        this.nowMillis = nowMillis;
    }

    /** Throws {@link RateLimitedException} (HTTP 429 via GlobalExceptionHandler) when over the limit. */
    public void check(Kind kind, Long userId) {
        long retryAfter = acquire(kind, userId);
        if (retryAfter > 0) throw new RateLimitedException(retryAfter);
    }

    /** Takes one token. Returns 0 when admitted, otherwise the seconds until the next token. */
    public long acquire(Kind kind, Long userId) {
        int limit = perMinute.getOrDefault(kind, 0);
        if (localMode || userId == null || limit <= 0) return 0;
        if (buckets.size() > PURGE_THRESHOLD) purgeFull();
        long now = nowMillis.getAsLong();
        long[] retry = {0};
        buckets.compute(kind + ":" + userId, (key, bucket) -> {
            if (bucket == null) bucket = new Bucket(limit, now);
            bucket.refill(limit, now);
            if (bucket.tokens >= 1) {
                bucket.tokens -= 1;
            } else {
                double perMilli = limit / 60_000.0;
                retry[0] = Math.max(1, (long) Math.ceil((1 - bucket.tokens) / perMilli / 1000.0));
            }
            return bucket;
        });
        return retry[0];
    }

    private void purgeFull() {
        long now = nowMillis.getAsLong();
        buckets.entrySet().removeIf(e -> now - e.getValue().updatedAt > 60_000L);
    }

    private static final class Bucket {
        double tokens;
        long updatedAt;

        Bucket(int capacity, long now) {
            tokens = capacity;
            updatedAt = now;
        }

        void refill(int capacity, long now) {
            long elapsed = Math.max(0, now - updatedAt);
            tokens = Math.min(capacity, tokens + elapsed * (capacity / 60_000.0));
            updatedAt = now;
        }
    }
}
