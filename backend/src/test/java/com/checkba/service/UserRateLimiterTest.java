// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service;

import com.checkba.exception.RateLimitedException;
import org.junit.jupiter.api.Test;

import java.util.concurrent.atomic.AtomicLong;

import static org.junit.jupiter.api.Assertions.*;

/** Per-user server limits: bucket per (kind, user), local mode bypass, refill, 429 message. */
class UserRateLimiterTest {

    private final AtomicLong now = new AtomicLong(1_700_000_000_000L);

    private UserRateLimiter server(int chat) {
        return new UserRateLimiter(false, chat, 300, 20, 120, now::get);
    }

    @Test
    void serverModeRejectsAfterBurstAndRefillsAtSustainedRate() {
        UserRateLimiter limiter = server(30);
        for (int i = 0; i < 30; i++) limiter.check(UserRateLimiter.Kind.CHAT, 7L);
        RateLimitedException e = assertThrows(RateLimitedException.class,
                () -> limiter.check(UserRateLimiter.Kind.CHAT, 7L));
        assertEquals(2, e.getRetryAfterSeconds(), "30/min refills one token every 2 seconds");
        now.addAndGet(2_000);
        assertEquals(0, limiter.acquire(UserRateLimiter.Kind.CHAT, 7L));
        assertTrue(limiter.acquire(UserRateLimiter.Kind.CHAT, 7L) > 0);
    }

    @Test
    void bucketsAreSeparatePerUserAndPerKind() {
        UserRateLimiter limiter = server(1);
        assertEquals(0, limiter.acquire(UserRateLimiter.Kind.CHAT, 7L));
        assertTrue(limiter.acquire(UserRateLimiter.Kind.CHAT, 7L) > 0);
        assertEquals(0, limiter.acquire(UserRateLimiter.Kind.CHAT, 8L), "another user is unaffected");
        assertEquals(0, limiter.acquire(UserRateLimiter.Kind.OCR, 7L), "another kind is unaffected");
    }

    @Test
    void localModeNeverLimits() {
        UserRateLimiter limiter = new UserRateLimiter(true, 1, 1, 1, 1, now::get);
        for (UserRateLimiter.Kind kind : UserRateLimiter.Kind.values()) {
            for (int i = 0; i < 100; i++) assertEquals(0, limiter.acquire(kind, 7L));
        }
    }

    @Test
    void nonPositiveLimitDisablesThatKind() {
        UserRateLimiter limiter = server(0);
        for (int i = 0; i < 100; i++) limiter.check(UserRateLimiter.Kind.CHAT, 7L);
    }

    @Test
    void messageIsNotMistakenForSessionLoss() {
        String msg = RateLimitedException.message(5);
        for (String banned : new String[]{"登录", "未授权", "请先"}) assertFalse(msg.contains(banned), msg);
        assertTrue(msg.contains("5"));
    }
}
