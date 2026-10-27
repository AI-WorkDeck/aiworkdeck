// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.version;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicReference;
import static org.junit.jupiter.api.Assertions.*;

class PathScopedRepoLockTest {
    @TempDir Path temp;
    private final PathScopedRepoLock.Registry registry = new PathScopedRepoLock.Registry();
    private PathScopedRepoLock lock(String path) { return new PathScopedRepoLock(registry, () -> temp.resolve(path)); }
    private boolean elsewhere(PathScopedRepoLock lock) throws Exception {
        return CompletableFuture.supplyAsync(() -> {
            if (!lock.tryLock()) return false;
            try { return true; } finally { lock.unlock(); }
        }).get(3, TimeUnit.SECONDS);
    }

    @Test void laterParentConflictsButIndependentAndSiblingRootsProceed() throws Exception {
        var child = lock("parent/child"); child.lock();
        try {
            assertFalse(elsewhere(lock("parent")));
            assertFalse(elsewhere(lock("parent/child/grandchild")));
            assertFalse(elsewhere(lock("parent/child")));
            assertTrue(elsewhere(lock("parent/sibling")));
            assertTrue(elsewhere(lock("unrelated")));
            assertTrue(elsewhere(lock("parent/child-name-prefix")));
        } finally { child.unlock(); }
        assertTrue(elsewhere(lock("parent")));
    }

    @Test void realSuperStateAndNestedLocalScopesAreReentrant() throws Exception {
        var parent = lock("parent"); var child = lock("parent/child");
        parent.lock(); parent.lockInterruptibly(); child.lock();
        try {
            assertTrue(parent.isHeldByCurrentThread()); assertEquals(2, parent.getHoldCount());
            parent.unlock(); assertEquals(1, parent.getHoldCount());
            assertFalse(elsewhere(lock("parent")));
            parent.unlock();
            assertFalse(elsewhere(lock("parent")), "child still owns the overlapping scope");
        } finally { child.unlock(); }
        assertTrue(elsewhere(parent)); assertFalse(parent.isLocked());
    }

    @Test void symlinkAndNotYetCreatedDescendantsSharePhysicalScope() throws Exception {
        Files.createDirectories(temp.resolve("real"));
        Files.createSymbolicLink(temp.resolve("alias"), temp.resolve("real"));
        var actual = lock("real"); actual.lock();
        try { assertFalse(elsewhere(lock("alias/new/child"))); }
        finally { actual.unlock(); }
    }

    @Test void timedAndInterruptedWaitersDoNotLeavePhantomScopes() throws Exception {
        var parent = lock("parent"); parent.lock();
        var child = lock("parent/child");
        ExecutorService pool = Executors.newSingleThreadExecutor();
        CountDownLatch started = new CountDownLatch(1);
        try {
            assertFalse(pool.submit(() -> child.tryLock(30, TimeUnit.MILLISECONDS)).get(2, TimeUnit.SECONDS));
            AtomicReference<Throwable> failure = new AtomicReference<>();
            Thread waiter = new Thread(() -> {
                started.countDown();
                try { child.lockInterruptibly(); child.unlock(); }
                catch (Throwable e) { failure.set(e); }
            });
            waiter.start(); assertTrue(started.await(1, TimeUnit.SECONDS));
            waiter.interrupt(); waiter.join(2000);
            assertFalse(waiter.isAlive()); assertInstanceOf(InterruptedException.class, failure.get());
            assertTrue(elsewhere(lock("unrelated")));
        } finally { parent.unlock(); pool.shutdownNow(); }
        assertTrue(elsewhere(child)); assertTrue(elsewhere(parent));
    }

    @Test void queuedWriterWinsOverStatusPollingButNotOverUnrelatedScopes() throws Exception {
        var held = lock("parent"); held.lock();
        var writer = lock("parent/child");
        CountDownLatch entered = new CountDownLatch(1), release = new CountDownLatch(1);
        ExecutorService pool = Executors.newSingleThreadExecutor();
        try {
            Future<?> task = pool.submit(() -> {
                writer.lock();
                try { entered.countDown(); assertTrue(release.await(3, TimeUnit.SECONDS)); }
                catch (InterruptedException e) { throw new RuntimeException(e); }
                finally { writer.unlock(); }
            });
            long until = System.nanoTime() + TimeUnit.SECONDS.toNanos(2);
            while (true) {
                synchronized (registry) { if (!registry.waiting.isEmpty()) break; }
                if (System.nanoTime() > until) fail("writer never queued");
                Thread.sleep(1);
            }
            assertTrue(elsewhere(lock("unrelated")));
            held.unlock();
            assertFalse(elsewhere(lock("parent")), "polling cannot overtake pending/active writer");
            assertTrue(entered.await(2, TimeUnit.SECONDS));
            release.countDown(); task.get(2, TimeUnit.SECONDS);
        } finally {
            release.countDown(); if (held.isHeldByCurrentThread()) held.unlock(); pool.shutdownNow();
        }
    }

    @Test void rootLookupDoesNotBlockIndependentAcquisitionOrOwnerUnlock() throws Exception {
        var held = lock("parent"); held.lock();
        CountDownLatch looking = new CountDownLatch(1), release = new CountDownLatch(1);
        var slow = new PathScopedRepoLock(registry, () -> {
            looking.countDown();
            try { assertTrue(release.await(3, TimeUnit.SECONDS)); }
            catch (InterruptedException e) { throw new RuntimeException(e); }
            return temp.resolve("other");
        });
        ExecutorService pool = Executors.newSingleThreadExecutor();
        try {
            Future<?> task = pool.submit(() -> { slow.lock(); slow.unlock(); });
            assertTrue(looking.await(2, TimeUnit.SECONDS));
            assertTrue(elsewhere(lock("independent")));
            held.unlock(); release.countDown(); task.get(2, TimeUnit.SECONDS);
        } finally { release.countDown(); if (held.isHeldByCurrentThread()) held.unlock(); pool.shutdownNow(); }
    }

    @Test void lateParentWaitsForEveryActiveChildAndRejectsUnsafeScopeUpgrade() throws Exception {
        var first = lock("parent/one"); first.lock();
        var second = lock("parent/two");
        CountDownLatch secondEntered = new CountDownLatch(1), releaseSecond = new CountDownLatch(1);
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            Future<?> child = pool.submit(() -> {
                second.lock();
                try { secondEntered.countDown(); assertTrue(releaseSecond.await(4, TimeUnit.SECONDS)); }
                catch (InterruptedException e) { throw new RuntimeException(e); }
                finally { second.unlock(); }
            });
            assertTrue(secondEntered.await(2, TimeUnit.SECONDS));
            var parent = lock("parent");
            assertThrows(IllegalStateException.class, parent::tryLock);
            assertTrue(first.isHeldByCurrentThread(), "rejected widening preserves the original child lock");
            Future<?> waiting = pool.submit(() -> { parent.lock(); parent.unlock(); });
            first.unlock();
            assertThrows(TimeoutException.class, () -> waiting.get(50, TimeUnit.MILLISECONDS));
            releaseSecond.countDown(); child.get(2, TimeUnit.SECONDS); waiting.get(2, TimeUnit.SECONDS);
            assertTrue(elsewhere(parent));
        } finally {
            releaseSecond.countDown(); if (first.isHeldByCurrentThread()) first.unlock(); pool.shutdownNow();
        }
    }

    @Test void relocationIsResolvedForNextOperationButNotForReentrantCall() throws Exception {
        AtomicReference<Path> root = new AtomicReference<>(temp.resolve("old"));
        var moving = new PathScopedRepoLock(registry, root::get);
        moving.lock(); root.set(temp.resolve("new")); moving.lock();
        try { assertFalse(elsewhere(lock("old"))); assertTrue(elsewhere(lock("new"))); }
        finally { moving.unlock(); moving.unlock(); }
        moving.lock();
        try { assertTrue(elsewhere(lock("old"))); assertFalse(elsewhere(lock("new"))); }
        finally { moving.unlock(); }
    }
}
