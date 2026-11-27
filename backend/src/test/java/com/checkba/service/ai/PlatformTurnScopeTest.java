// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.ai;

import org.junit.jupiter.api.Test;

import java.util.Map;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.*;

/** Q24：轮次里的辅助平台调用也带本轮计费标记，包括跨线程提交；轮次外、BYOK 一律不带。 */
class PlatformTurnScopeTest {
    private static final String TAG = "0123456789abcdef0123456789abcdef";

    @Test
    void auxiliaryPlatformCallsInsideATurnCarryTheTag() {
        assertEquals(Map.of(), ChatModelFactory.turnHeaders("awdai_x"));
        PlatformTurnScope.run(TAG, () -> {
            assertEquals(Map.of("X-AWD-Turn", TAG), ChatModelFactory.turnHeaders("awdai_x"));
            assertEquals(Map.of(), ChatModelFactory.turnHeaders("sk-or-x"));
            assertEquals(TAG, OpenRouterStreamingChatModel.turnTagOf(null));
        });
        assertNull(PlatformTurnScope.current());
        PlatformTurnScope.run("not-a-tag", () -> assertEquals(Map.of(), ChatModelFactory.turnHeaders("awdai_x")));
    }

    @Test
    void wrapCarriesTheTurnAcrossThreads() throws Exception {
        ExecutorService pool = Executors.newSingleThreadExecutor();
        try {
            AtomicReference<String> seenRunnable = new AtomicReference<>();
            AtomicReference<Runnable> task = new AtomicReference<>();
            Callable<String>[] callable = new Callable[1];
            PlatformTurnScope.run(TAG, () -> {
                task.set(PlatformAiUserScope.wrap(() -> seenRunnable.set(PlatformTurnScope.current())));
                callable[0] = PlatformAiUserScope.wrap((Callable<String>) PlatformTurnScope::current);
            });
            pool.submit(task.get()).get();
            assertEquals(TAG, seenRunnable.get());
            assertEquals(TAG, pool.submit(callable[0]).get());
            assertNull(pool.submit(PlatformTurnScope::current).get(), "the pool thread is clean afterwards");
            Callable<String> failing = PlatformAiUserScope.wrap((Callable<String>) () -> { throw new java.io.IOException("boom"); });
            assertThrows(java.io.IOException.class, failing::call);
        } finally {
            pool.shutdownNow();
        }
    }

    @Test
    void untaggedSpendIsRememberedPerTurn() {
        String other = "fedcba9876543210fedcba9876543210";
        PlatformTurnScope.markUntaggedSpend();          // outside a turn: nothing to remember
        PlatformTurnScope.run(TAG, PlatformTurnScope::markUntaggedSpend);
        assertTrue(PlatformTurnScope.hadUntaggedSpend(TAG));
        assertFalse(PlatformTurnScope.hadUntaggedSpend(other));
    }

    @Test
    void backgroundWorkOfATurnCountsAsPendingUntilItEnds() {
        String tag = "11112222333344445555666677778888";
        assertEquals(0, PlatformTurnScope.openWork(tag));
        PlatformTurnScope.beginWork(tag);
        PlatformTurnScope.beginWork(tag);
        assertEquals(2, PlatformTurnScope.openWork(tag));
        PlatformTurnScope.endWork(tag);
        PlatformTurnScope.endWork(tag);
        PlatformTurnScope.endWork(tag);   // extra end is harmless
        assertEquals(0, PlatformTurnScope.openWork(tag));
        PlatformTurnScope.beginWork(null);
        assertEquals(0, PlatformTurnScope.openWork(null));
    }
}
