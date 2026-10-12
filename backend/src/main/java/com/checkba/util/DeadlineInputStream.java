// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.util;

import java.io.*;
import java.net.SocketTimeoutException;
import java.time.Duration;
import java.util.concurrent.*;

/** HttpRequest.timeout no longer bounds reads after ofInputStream receives response headers. */
public final class DeadlineInputStream extends FilterInputStream {
    private static final ScheduledThreadPoolExecutor DEADLINES = new ScheduledThreadPoolExecutor(1, task -> {
        Thread thread = new Thread(task, "version-object-body-deadline");
        thread.setDaemon(true);
        return thread;
    });
    static { DEADLINES.setRemoveOnCancelPolicy(true); }
    private volatile boolean expired;
    private final ScheduledFuture<?> deadline;

    public DeadlineInputStream(InputStream source, Duration timeout) {
        super(source);
        deadline = DEADLINES.schedule(() -> {
            expired = true;
            // Interrupt an already blocked HTTP read, not just the next read call.
            try { source.close(); } catch (IOException ignored) { }
        }, timeout.toMillis(), TimeUnit.MILLISECONDS);
    }

    private void checkDeadline() throws IOException {
        if (expired) throw new SocketTimeoutException("Version object response timed out");
    }
    @Override public int read() throws IOException {
        checkDeadline();
        int value = in.read();
        checkDeadline();
        return value;
    }
    @Override public int read(byte[] bytes, int offset, int length) throws IOException {
        checkDeadline();
        int count = in.read(bytes, offset, length);
        checkDeadline();
        return count;
    }
    @Override public void close() throws IOException {
        deadline.cancel(false);
        in.close();
    }
}
