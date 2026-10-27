// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.localcore;

import java.time.Duration;
import java.util.Objects;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.locks.Condition;
import java.util.concurrent.locks.ReentrantLock;

/**
 * One-way ownership handoff from the startup core to JPA. Every core operation, including a read,
 * must hold a lease for its entire lifetime. This class neither opens storage nor starts threads.
 * FAILED is terminal: failure does not prove that an external handoff can safely be undone.
 */
public final class LocalCoreOwnership {
    public enum State { CORE, DRAINING, JPA, FAILED }

    @FunctionalInterface
    public interface Handoff {
        /** Return normally only after external ownership has been transferred successfully. */
        void run() throws Exception;
    }

    public static final class CoreLease implements AutoCloseable {
        private final LocalCoreOwnership owner;
        private boolean closed;

        private CoreLease(LocalCoreOwnership owner) { this.owner = owner; }

        /** May be called from another thread. Repeated closes have no effect. */
        @Override
        public void close() { owner.release(this); }
    }

    private final ReentrantLock lock = new ReentrantLock();
    private final Condition drained = lock.newCondition();
    private State state = State.CORE;
    private int leases;

    public State state() {
        lock.lock();
        try { return state; }
        finally { lock.unlock(); }
    }

    /** Atomically admits one operation in CORE; all other states reject new operations. */
    public CoreLease acquireCoreLease() {
        lock.lock();
        try {
            if (state != State.CORE) throw new IllegalStateException("Core ownership is " + state);
            leases++;
            return new CoreLease(this);
        } finally { lock.unlock(); }
    }

    /**
     * Stops new leases, waits for existing leases to close, then invokes the handoff synchronously.
     * The timeout bounds ONLY the lease-draining wait, starting at the transition to DRAINING. It is
     * not a deadline for the callback: abandoning a callback could leave it transferring ownership
     * after this method returned. The callback runs outside the lock while state remains DRAINING.
     *
     * A timeout, an interruption after entering DRAINING, or a callback Exception/Error leaves FAILED.
     * An interruption before entering leaves the current state unchanged. InterruptedException is
     * propagated with the thread's interrupt flag restored. The flag is also checked immediately
     * before the callback and before committing JPA after a normal return. FAILED does not roll back
     * any external actions the callback may already have performed. Only normal, uninterrupted
     * completion advances to JPA. There is no retry/reset from JPA or FAILED.
     *
     * Zero permits an immediate handoff only when no leases remain. Negative/null arguments are
     * rejected without changing state. Repeated handoff calls reject without affecting the first.
     */
    public void drainAndHandoff(Duration timeout, Handoff handoff) throws Exception {
        Objects.requireNonNull(timeout, "timeout");
        Objects.requireNonNull(handoff, "handoff");
        if (timeout.isNegative()) throw new IllegalArgumentException("timeout must not be negative");
        long remaining = timeout.toNanos();
        try {
            lock.lockInterruptibly();
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            throw interrupted;
        }
        try {
            if (state != State.CORE) throw new IllegalStateException("Cannot hand off ownership from " + state);
            state = State.DRAINING;
            try {
                while (leases != 0) {
                    if (remaining <= 0) {
                        state = State.FAILED;
                        throw new TimeoutException("Core leases did not drain before the timeout");
                    }
                    remaining = drained.awaitNanos(remaining);
                }
                if (Thread.currentThread().isInterrupted()) throw new InterruptedException("Ownership handoff interrupted");
            } catch (InterruptedException interrupted) {
                state = State.FAILED;
                Thread.currentThread().interrupt();
                throw interrupted;
            }
        } finally { lock.unlock(); }

        try {
            if (Thread.currentThread().isInterrupted()) throw new InterruptedException("Ownership handoff interrupted");
            handoff.run();
        } catch (Exception | Error failure) {
            lock.lock();
            try { state = State.FAILED; }
            finally { lock.unlock(); }
            if (failure instanceof InterruptedException) Thread.currentThread().interrupt();
            throw failure;
        }
        lock.lock();
        try {
            if (Thread.currentThread().isInterrupted()) {
                state = State.FAILED;
                throw new InterruptedException("Ownership handoff interrupted before JPA publication");
            }
            state = State.JPA;
        }
        finally { lock.unlock(); }
    }

    private void release(CoreLease lease) {
        lock.lock();
        try {
            if (lease.closed) return;
            lease.closed = true;
            leases--;
            if (leases == 0) drained.signalAll();
        } finally { lock.unlock(); }
    }
}
