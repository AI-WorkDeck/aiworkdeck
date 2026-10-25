// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.localcore;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.locks.LockSupport;

import static com.checkba.localcore.LocalCoreOwnership.State.*;
import static org.junit.jupiter.api.Assertions.*;

class LocalCoreOwnershipTest {
    @Test void concurrentLeasesAllFinishBeforeHandoffRuns() throws Exception {
        var owner = new LocalCoreOwnership();
        int operations = 8;
        var admitted = new CountDownLatch(operations);
        var release = new CountDownLatch(1);
        var active = new AtomicInteger();
        var callbackCount = new AtomicInteger();
        var pool = Executors.newFixedThreadPool(operations + 1);
        try {
            List<Future<?>> workers = new ArrayList<>();
            for (int index = 0; index < operations; index++) {
                workers.add(pool.submit(() -> {
                    try (var lease = owner.acquireCoreLease()) {
                        active.incrementAndGet(); admitted.countDown();
                        assertTrue(release.await(5, TimeUnit.SECONDS));
                        active.decrementAndGet();
                    }
                    return null;
                }));
            }
            assertTrue(admitted.await(3, TimeUnit.SECONDS));
            Future<?> transfer = pool.submit(() -> {
                owner.drainAndHandoff(Duration.ofSeconds(5), () -> {
                    assertEquals(0, active.get()); callbackCount.incrementAndGet();
                });
                return null;
            });
            awaitState(owner, DRAINING);
            assertEquals(0, callbackCount.get());
            assertThrows(IllegalStateException.class, owner::acquireCoreLease);
            release.countDown();
            for (Future<?> worker : workers) worker.get(3, TimeUnit.SECONDS);
            transfer.get(3, TimeUnit.SECONDS);
            assertEquals(1, callbackCount.get()); assertEquals(JPA, owner.state());
        } finally { release.countDown(); pool.shutdownNow(); }
    }

    @Test void drainingAndRunningCallbackRejectLateLeasesAndDuplicateHandoff() throws Exception {
        var owner = new LocalCoreOwnership();
        var lease = owner.acquireCoreLease();
        var callbackEntered = new CountDownLatch(1);
        var callbackRelease = new CountDownLatch(1);
        var callbackCount = new AtomicInteger();
        var pool = Executors.newFixedThreadPool(2);
        try {
            Future<?> transfer = pool.submit(() -> {
                owner.drainAndHandoff(Duration.ofSeconds(5), () -> {
                    callbackCount.incrementAndGet(); callbackEntered.countDown();
                    assertTrue(callbackRelease.await(5, TimeUnit.SECONDS));
                });
                return null;
            });
            awaitState(owner, DRAINING);
            assertThrows(IllegalStateException.class, owner::acquireCoreLease);
            assertThrows(IllegalStateException.class, () -> owner.drainAndHandoff(Duration.ZERO, () -> fail("duplicate callback")));
            lease.close();
            assertTrue(callbackEntered.await(3, TimeUnit.SECONDS));
            // Also proves callback I/O does not hold the coordinator lock.
            pool.submit(() -> {
                assertEquals(DRAINING, owner.state());
                assertThrows(IllegalStateException.class, owner::acquireCoreLease);
                assertThrows(IllegalStateException.class, () -> owner.drainAndHandoff(Duration.ZERO, () -> fail("duplicate callback")));
            }).get(1, TimeUnit.SECONDS);
            callbackRelease.countDown(); transfer.get(3, TimeUnit.SECONDS);
            assertEquals(JPA, owner.state()); assertEquals(1, callbackCount.get());
            assertThrows(IllegalStateException.class, owner::acquireCoreLease);
            assertThrows(IllegalStateException.class, () -> owner.drainAndHandoff(Duration.ZERO, () -> fail("repeated JPA handoff")));
            assertEquals(JPA, owner.state());
        } finally { lease.close(); callbackRelease.countDown(); pool.shutdownNow(); }
    }

    @Test void closingOneLeaseTwiceCannotReleaseAnotherLease() throws Exception {
        var owner = new LocalCoreOwnership();
        var first = owner.acquireCoreLease();
        var second = owner.acquireCoreLease();
        var pool = Executors.newFixedThreadPool(2);
        try {
            Future<?> closeA = pool.submit(first::close);
            Future<?> closeB = pool.submit(first::close);
            closeA.get(1, TimeUnit.SECONDS); closeB.get(1, TimeUnit.SECONDS);
            assertThrows(TimeoutException.class, () -> owner.drainAndHandoff(Duration.ZERO, () -> fail("second lease is still active")));
            assertEquals(FAILED, owner.state());
            second.close(); first.close(); second.close();
            assertEquals(FAILED, owner.state());
            assertThrows(IllegalStateException.class, owner::acquireCoreLease);
        } finally { first.close(); second.close(); pool.shutdownNow(); }
    }

    @Test void drainedLeasesAndRepeatedClosesPermitExactlyOneHandoff() throws Exception {
        var owner = new LocalCoreOwnership();
        var first = owner.acquireCoreLease(); var second = owner.acquireCoreLease();
        first.close(); first.close(); second.close(); second.close();
        var calls = new AtomicInteger();
        owner.drainAndHandoff(Duration.ZERO, calls::incrementAndGet);
        assertEquals(1, calls.get()); assertEquals(JPA, owner.state());
    }

    @Test void timeoutFailsClosedAndLateCloseCannotReviveCore() {
        var owner = new LocalCoreOwnership();
        var lease = owner.acquireCoreLease();
        assertThrows(TimeoutException.class, () -> owner.drainAndHandoff(Duration.ZERO, () -> fail("timed out callback")));
        assertEquals(FAILED, owner.state()); lease.close();
        assertThrows(IllegalStateException.class, owner::acquireCoreLease);
        assertThrows(IllegalStateException.class, () -> owner.drainAndHandoff(Duration.ZERO, () -> fail("failed owner retried")));
        assertEquals(FAILED, owner.state());
    }

    @Test void interruptionBeforeEnteringPreservesCoreAndInterruptFlag() throws Exception {
        var owner = new LocalCoreOwnership();
        FutureTask<Void> task = new FutureTask<>(() -> {
            Thread.currentThread().interrupt();
            assertThrows(InterruptedException.class, () -> owner.drainAndHandoff(Duration.ZERO, () -> fail("interrupted callback")));
            assertTrue(Thread.currentThread().isInterrupted()); assertEquals(CORE, owner.state());
            return null;
        });
        Thread thread = new Thread(task, "ownership-pre-interrupted"); thread.start();
        task.get(3, TimeUnit.SECONDS);
        try (var lease = owner.acquireCoreLease()) { assertEquals(CORE, owner.state()); }
    }

    @Test void interruptionWhileDrainingFailsClosedAndPreservesInterruptFlag() throws Exception {
        var owner = new LocalCoreOwnership();
        var lease = owner.acquireCoreLease();
        var interruptPreserved = new AtomicBoolean();
        FutureTask<Void> task = new FutureTask<>(() -> {
            try { owner.drainAndHandoff(Duration.ofSeconds(5), () -> fail("interrupted drain callback")); }
            catch (InterruptedException interrupted) {
                interruptPreserved.set(Thread.currentThread().isInterrupted()); throw interrupted;
            }
            return null;
        });
        Thread thread = new Thread(task, "ownership-draining"); thread.start();
        try {
            awaitState(owner, DRAINING); thread.interrupt();
            ExecutionException failure = assertThrows(ExecutionException.class, () -> task.get(3, TimeUnit.SECONDS));
            assertInstanceOf(InterruptedException.class, failure.getCause());
            assertTrue(interruptPreserved.get()); assertEquals(FAILED, owner.state());
            lease.close(); assertEquals(FAILED, owner.state());
            assertThrows(IllegalStateException.class, owner::acquireCoreLease);
        } finally { lease.close(); thread.interrupt(); thread.join(1000); }
    }

    @Test void callbackExceptionFailsClosedAndPropagatesOriginalFailure() {
        var owner = new LocalCoreOwnership();
        var expected = new IOException("handoff failed");
        Exception failure = assertThrows(IOException.class, () -> owner.drainAndHandoff(Duration.ZERO, () -> { throw expected; }));
        assertSame(expected, failure); assertEquals(FAILED, owner.state());
        assertThrows(IllegalStateException.class, owner::acquireCoreLease);
        assertThrows(IllegalStateException.class, () -> owner.drainAndHandoff(Duration.ZERO, () -> fail("failure retry")));
    }

    @Test void callbackErrorAlsoFailsClosed() {
        var owner = new LocalCoreOwnership();
        var expected = new AssertionError("callback error");
        Error failure = assertThrows(AssertionError.class, () -> owner.drainAndHandoff(Duration.ZERO, () -> { throw expected; }));
        assertSame(expected, failure); assertEquals(FAILED, owner.state());
        assertThrows(IllegalStateException.class, owner::acquireCoreLease);
    }

    @Test void callbackInterruptedExceptionFailsClosedAndRestoresInterruptFlag() {
        var owner = new LocalCoreOwnership();
        try {
            assertThrows(InterruptedException.class, () -> owner.drainAndHandoff(Duration.ZERO, () -> {
                throw new InterruptedException("callback interrupted");
            }));
            assertTrue(Thread.currentThread().isInterrupted()); assertEquals(FAILED, owner.state());
        } finally { Thread.interrupted(); }
    }

    @Test void callbackReturningWithInterruptFlagFailsClosedWithoutClaimingRollback() {
        var owner = new LocalCoreOwnership();
        var externalAction = new AtomicBoolean();
        try {
            assertThrows(InterruptedException.class, () -> owner.drainAndHandoff(Duration.ZERO, () -> {
                externalAction.set(true);
                Thread.currentThread().interrupt();
            }));
            assertTrue(Thread.currentThread().isInterrupted()); assertEquals(FAILED, owner.state());
            assertTrue(externalAction.get(), "FAILED does not undo callback side effects");
            assertThrows(IllegalStateException.class, owner::acquireCoreLease);
        } finally { Thread.interrupted(); }
    }

    @Test void invalidArgumentsDoNotStartDraining() {
        var owner = new LocalCoreOwnership();
        assertThrows(IllegalArgumentException.class, () -> owner.drainAndHandoff(Duration.ofNanos(-1), () -> {}));
        assertThrows(NullPointerException.class, () -> owner.drainAndHandoff(null, () -> {}));
        assertThrows(NullPointerException.class, () -> owner.drainAndHandoff(Duration.ZERO, null));
        assertEquals(CORE, owner.state());
    }

    private static void awaitState(LocalCoreOwnership owner, LocalCoreOwnership.State expected) {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(3);
        while (owner.state() != expected && System.nanoTime() < deadline) {
            LockSupport.parkNanos(TimeUnit.MILLISECONDS.toNanos(1));
        }
        assertEquals(expected, owner.state());
    }
}
