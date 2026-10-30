// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.ai;

import java.time.Duration;
import java.util.concurrent.*;
import java.util.function.BooleanSupplier;
import java.util.function.Supplier;

/** Bounds read waits without turning an uninterruptible parser into an unbounded thread leak. */
final class BoundedAttachmentRead {
    private static final ExecutorService READS = new ThreadPoolExecutor(
            0, 4, 60, TimeUnit.SECONDS, new SynchronousQueue<>(), r -> {
                Thread thread = new Thread(r, "attachment-read");
                thread.setDaemon(true);
                return thread;
            }, new ThreadPoolExecutor.AbortPolicy());

    static final class Unavailable extends RuntimeException {
        Unavailable(Throwable cause) { super("ATTACHMENT_READ_TIMEOUT", cause); }
        boolean busy() { return getCause() instanceof RejectedExecutionException; }
    }

    static <T> T await(Supplier<T> read, BooleanSupplier cancelled, Duration limit) {
        return await(READS, read, cancelled, limit);
    }

    static <T> T await(Executor executor, Supplier<T> read, BooleanSupplier cancelled, Duration limit) {
        if (cancelled.getAsBoolean()) throw new CancellationException();
        FutureTask<T> task = new FutureTask<>(read::get);
        long deadline = System.nanoTime() + limit.toNanos();
        try {
            executor.execute(task);
            while (true) {
                if (cancelled.getAsBoolean()) throw new CancellationException();
                long remaining = deadline - System.nanoTime();
                if (remaining <= 0) throw new Unavailable(new TimeoutException());
                try {
                    T result = task.get(Math.min(remaining, TimeUnit.MILLISECONDS.toNanos(250)), TimeUnit.NANOSECONDS);
                    if (cancelled.getAsBoolean()) throw new CancellationException();
                    return result;
                } catch (TimeoutException waiting) {
                    // SSE heartbeats are connectivity, not evidence that parsing is making progress.
                }
            }
        } catch (RejectedExecutionException busy) {
            throw new Unavailable(busy);
        } catch (InterruptedException stopped) {
            Thread.currentThread().interrupt();
            throw new CancellationException();
        } catch (ExecutionException failed) {
            if (failed.getCause() instanceof RuntimeException runtime) throw runtime;
            if (failed.getCause() instanceof Error error) throw error;
            throw new IllegalStateException(failed.getCause());
        } finally {
            task.cancel(true);
        }
    }
}
