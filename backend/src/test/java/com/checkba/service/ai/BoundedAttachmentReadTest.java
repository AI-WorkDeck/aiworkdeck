// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.ai;

import org.junit.jupiter.api.Test;
import java.time.Duration;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import static org.junit.jupiter.api.Assertions.*;

class BoundedAttachmentReadTest {
    @Test void hungParserTimesOutAndItsLateResultIsNeverDelivered() throws Exception {
        ExecutorService executor = Executors.newSingleThreadExecutor();
        CountDownLatch release = new CountDownLatch(1);
        CountDownLatch interrupted = new CountDownLatch(1);
        try {
            assertTimeoutPreemptively(Duration.ofSeconds(2), () ->
                    assertThrows(BoundedAttachmentRead.Unavailable.class, () -> BoundedAttachmentRead.await(executor, () -> {
                        while (release.getCount() != 0) {
                            try { release.await(); } catch (InterruptedException ignored) { interrupted.countDown(); }
                        }
                        return "late";
                    }, () -> false, Duration.ofMillis(50))));
            assertTrue(interrupted.await(1, TimeUnit.SECONDS));
        } finally { release.countDown(); executor.shutdownNow(); }
    }

    @Test void userCanStopWhileParserStillHasNoResult() throws Exception {
        ExecutorService executor = Executors.newSingleThreadExecutor();
        AtomicBoolean cancel = new AtomicBoolean();
        CountDownLatch entered = new CountDownLatch(1);
        try {
            CompletableFuture<Void> caller = CompletableFuture.runAsync(() -> assertThrows(CancellationException.class,
                    () -> BoundedAttachmentRead.await(executor, () -> {
                        entered.countDown();
                        try { new CountDownLatch(1).await(); } catch (InterruptedException stopped) { Thread.currentThread().interrupt(); }
                        return "discard";
                    }, cancel::get, Duration.ofMinutes(2))));
            assertTrue(entered.await(1, TimeUnit.SECONDS));
            cancel.set(true);
            caller.get(1, TimeUnit.SECONDS);
        } finally { executor.shutdownNow(); }
    }

    @Test void saturatedWorkersFailImmediatelyInsteadOfQueuingForever() {
        assertThrows(BoundedAttachmentRead.Unavailable.class, () -> BoundedAttachmentRead.await(
                task -> { throw new RejectedExecutionException(); }, () -> "never", () -> false, Duration.ofMinutes(2)));
    }

    @Test void cancelledBeforeStartDoesNotReadAnything() {
        AtomicBoolean started = new AtomicBoolean();
        assertThrows(CancellationException.class, () -> BoundedAttachmentRead.await(Runnable::run,
                () -> { started.set(true); return "no"; }, () -> true, Duration.ofMinutes(2)));
        assertFalse(started.get());
    }

    @Test void successfulReadAndBusinessErrorKeepTheirOriginalResults() {
        assertEquals("text", BoundedAttachmentRead.await(Runnable::run, () -> "text", () -> false, Duration.ofSeconds(1)));
        IllegalArgumentException error = new IllegalArgumentException("bad file");
        assertSame(error, assertThrows(IllegalArgumentException.class, () -> BoundedAttachmentRead.await(
                Runnable::run, () -> { throw error; }, () -> false, Duration.ofSeconds(1))));
    }
}
