// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.version;

import java.io.IOException;
import java.nio.file.NoSuchFileException;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.locks.Condition;
import java.util.concurrent.locks.ReentrantLock;
import java.util.function.Supplier;

/** Serializes overlapping local roots, including parents registered after their children. */
final class PathScopedRepoLock extends ReentrantLock {
    static final class Registry {
        final List<PathScopedRepoLock> active = new ArrayList<>();
        final List<Request> waiting = new ArrayList<>();
    }
    private record Request(Path root, Thread thread) {}
    private final Registry registry;
    private final Supplier<Path> rootSupplier;
    // Fields are guarded by registry; only the owning thread may also read heldRoot when reentering.
    // Super owns the actual reentrant lock state.
    private Path heldRoot;
    private Thread holder;

    PathScopedRepoLock(Registry registry, Supplier<Path> rootSupplier) {
        this.registry = registry;
        this.rootSupplier = rootSupplier;
    }

    private static boolean overlaps(Path a, Path b) { return a.startsWith(b) || b.startsWith(a); }

    /** Resolve existing ancestors too: a not-yet-created child may sit below a symlink. */
    private static Path canonical(Path path) {
        Path absolute = path.toAbsolutePath().normalize();
        Path existing = absolute;
        while (existing != null) {
            try { return existing.toRealPath().resolve(existing.relativize(absolute)).normalize(); }
            catch (NoSuchFileException missing) { existing = existing.getParent(); }
            catch (IOException failure) { throw new VersionException("无法确定版本锁目录", failure); }
        }
        throw new IllegalStateException("Cannot resolve repository root");
    }

    private Request request() {
        // A reentrant call must keep the outer operation's scope even if storage is relocated.
        return new Request(isHeldByCurrentThread() ? heldRoot : canonical(rootSupplier.get()), Thread.currentThread());
    }

    private boolean acquire(Request request) {
        if (isHeldByCurrentThread()) return super.tryLock();
        boolean ownsScope = registry.active.stream().anyMatch(lock -> lock.holder == request.thread);
        for (PathScopedRepoLock lock : registry.active) {
            if (lock.holder != request.thread && overlaps(lock.heldRoot, request.root)) {
                // Existing callers only nest operations for the same project. Never deadlock if a
                // future caller tries to widen two simultaneously held sibling scopes to a parent.
                if (ownsScope) throw new IllegalStateException("Cannot wait for another repository scope while holding one");
                return false;
            }
        }
        // Read-only status polling must not repeatedly jump ahead of a waiting content writer.
        if (!ownsScope) for (Request earlier : registry.waiting) {
            if (earlier == request) break;
            if (earlier.thread != request.thread && overlaps(earlier.root, request.root)) return false;
        }
        if (!super.tryLock()) return false;
        heldRoot = request.root;
        holder = request.thread;
        registry.active.add(this);
        return true;
    }

    @Override public boolean tryLock() {
        Request request = request();
        synchronized (registry) { return acquire(request); }
    }

    @Override public void lock() {
        boolean interrupted = false;
        Request request = request();
        synchronized (registry) {
            registry.waiting.add(request);
            try {
                while (!acquire(request)) {
                    try { registry.wait(); }
                    catch (InterruptedException ignored) { interrupted = true; }
                }
            } finally {
                registry.waiting.remove(request);
                registry.notifyAll();
                if (interrupted) Thread.currentThread().interrupt();
            }
        }
    }

    @Override public void lockInterruptibly() throws InterruptedException {
        await(0, false);
    }

    @Override public boolean tryLock(long timeout, TimeUnit unit) throws InterruptedException {
        return await(unit.toNanos(timeout), true);
    }

    private boolean await(long nanos, boolean timed) throws InterruptedException {
        if (Thread.interrupted()) throw new InterruptedException();
        long deadline = System.nanoTime() + nanos;
        Request request = request();
        synchronized (registry) {
            registry.waiting.add(request);
            try {
                while (!acquire(request)) {
                    if (!timed) registry.wait();
                    else {
                        long remaining = deadline - System.nanoTime();
                        if (remaining <= 0) return false;
                        TimeUnit.NANOSECONDS.timedWait(registry, remaining);
                    }
                }
                return true;
            } finally {
                registry.waiting.remove(request);
                registry.notifyAll();
            }
        }
    }

    @Override public void unlock() {
        synchronized (registry) {
            super.unlock();
            if (!isHeldByCurrentThread()) {
                registry.active.remove(this);
                heldRoot = null;
                holder = null;
                registry.notifyAll();
            }
        }
    }

    @Override public Condition newCondition() {
        throw new UnsupportedOperationException("Repository scopes do not support condition waits");
    }
}
