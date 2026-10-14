// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.aiworkdeck.plugins.baoqingtian;

import java.time.Duration;
import java.util.function.LongSupplier;

/** One budget across sequential API requests, lock waiting, and COS upload. */
final class CallDeadline implements AutoCloseable {
    private static final ThreadLocal<Budget> CURRENT = new ThreadLocal<>();
    private record Budget(LongSupplier clock, long started) {}
    private final Budget previous;
    private CallDeadline(LongSupplier clock) {
        previous = CURRENT.get();
        if (previous == null) CURRENT.set(new Budget(clock, clock.getAsLong()));
    }
    static CallDeadline open() { return new CallDeadline(System::nanoTime); }
    static CallDeadline open(LongSupplier clock) { return new CallDeadline(clock); }
    static long remainingMillis(long maximum) {
        Budget budget = CURRENT.get();
        if (budget == null) return maximum;
        long left = Duration.ofSeconds(50).toNanos() - (budget.clock.getAsLong() - budget.started);
        if (left < 1_000_000) throw BaoqingtianTools.fail("request_not_sent", "本次连接等待已超时，后续请求尚未发送；请继续原操作核对结果");
        return Math.min(maximum, left / 1_000_000);
    }
    @Override public void close() { if (previous == null) CURRENT.remove(); else CURRENT.set(previous); }
}
