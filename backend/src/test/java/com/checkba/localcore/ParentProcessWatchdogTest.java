// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.localcore;

import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ParentProcessWatchdogTest {

    @Test
    void firesWhenWatchedProcessExits() throws Exception {
        // JDK 单文件启动一个阻塞在 stdin 上的子进程，跨平台，不依赖 sleep 命令
        Path src = Files.createTempFile("Waiter", ".java");
        Files.writeString(src, "public class Waiter { public static void main(String[] a) throws Exception { System.in.read(); } }");
        Process child = new ProcessBuilder(
                Path.of(System.getProperty("java.home"), "bin", "java").toString(), src.toString()).start();
        try {
            CountDownLatch fired = new CountDownLatch(1);
            assertTrue(ParentProcessWatchdog.watch(String.valueOf(child.pid()), fired::countDown));
            assertFalse(fired.await(300, TimeUnit.MILLISECONDS), "still alive: must not fire");
            child.destroyForcibly();
            assertTrue(fired.await(10, TimeUnit.SECONDS), "must fire after the watched process exits");
        } finally {
            child.destroyForcibly();
            Files.deleteIfExists(src);
        }
    }

    @Test
    void ignoresMissingOrInvalidPid() {
        assertFalse(ParentProcessWatchdog.watch(null, () -> { }));
        assertFalse(ParentProcessWatchdog.watch("not-a-pid", () -> { }));
        assertFalse(ParentProcessWatchdog.watch(String.valueOf(Long.MAX_VALUE), () -> { }));
    }
}
