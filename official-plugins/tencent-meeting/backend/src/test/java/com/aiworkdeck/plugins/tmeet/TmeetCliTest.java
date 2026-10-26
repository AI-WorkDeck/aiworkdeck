// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.aiworkdeck.plugins.tmeet;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import java.nio.file.*;
import java.time.Duration;
import java.util.List;
import static org.junit.jupiter.api.Assertions.*;

class TmeetCliTest {
    @TempDir Path dir;
    @Test void unavailableExecutableHasNoRawPathInError() {
        var runner = new TmeetCli.NativeRunner(dir.resolve("private-unavailable").toString());
        var error = assertThrows(TmeetCli.Failure.class, () -> runner.run(List.of("--version"), Duration.ofSeconds(1)));
        assertEquals(TmeetCli.MISSING, error.getMessage()); assertFalse(error.getMessage().contains("private-unavailable"));
    }
    @org.junit.jupiter.api.condition.DisabledOnOs(org.junit.jupiter.api.condition.OS.WINDOWS)
    @Test void nonzeroExitAndTimeoutAreHandledWithoutRealCli() throws Exception {
        Path script = dir.resolve("fake-cli");
        Files.writeString(script, "#!/bin/sh\nif [ \"$1\" = fail ]; then echo sensitive >&2; exit 8; fi\nsleep 10\n");
        assertTrue(script.toFile().setExecutable(true));
        var runner = new TmeetCli.NativeRunner(script.toString());
        assertEquals(8, runner.run(List.of("fail"), Duration.ofSeconds(1)).exitCode());
        long start = System.nanoTime();
        assertThrows(TmeetCli.Failure.class, () -> runner.run(List.of("slow"), Duration.ofMillis(80)));
        assertTrue(Duration.ofNanos(System.nanoTime() - start).toSeconds() < 3);
    }
    @org.junit.jupiter.api.condition.DisabledOnOs(org.junit.jupiter.api.condition.OS.WINDOWS)
    @Test void loginProcessKeepsItsLockUntilCredentialsAreWritten() throws Exception {
        Path script = dir.resolve("fake-login-cli"), complete = dir.resolve("complete"), statusCalls = dir.resolve("status-calls");
        Files.writeString(script, "#!/bin/sh\n" +
            "if [ \"$2\" = login ]; then\n" +
            "  echo 'https://meeting.tencent.com/authorize?code=synthetic-lock-fixture'\n" +
            "  while [ ! -f '" + complete + "' ]; do sleep 0.02; done\n" +
            "  exit 0\nfi\n" +
            "echo called >> '" + statusCalls + "'\necho 'Logged in'\n");
        assertTrue(script.toFile().setExecutable(true));
        var runner = new TmeetCli.NativeRunner(script.toString());
        try {
            assertTrue(runner.login(7).contains("synthetic-lock-fixture"));
            assertTrue(runner.loginPending());
            assertThrows(TmeetCli.Failure.class, () -> runner.run(List.of("auth", "status"), Duration.ofSeconds(1)));
            assertFalse(Files.exists(statusCalls), "No competing status process is allowed during login");
            Files.writeString(complete, "done");
            long deadline = System.nanoTime() + Duration.ofSeconds(2).toNanos();
            while (runner.loginPending() && System.nanoTime() < deadline) Thread.sleep(20);
            assertFalse(runner.loginPending());
            assertTrue(runner.run(List.of("auth", "status"), Duration.ofSeconds(1)).output().contains("Logged in"));
            assertEquals(1, Files.readAllLines(statusCalls).size());
        } finally { runner.cancelLogin(7); }
    }

    @org.junit.jupiter.api.condition.DisabledOnOs(org.junit.jupiter.api.condition.OS.WINDOWS)
    @Test void pluginReloadCannotInterruptTheExistingLogin() throws Exception {
        Path script = dir.resolve("reload-cli"), complete = dir.resolve("complete"), calls = dir.resolve("calls");
        Files.writeString(script, "#!/bin/sh\necho \"$1 $2\" >> '" + calls + "'\n" +
            "if [ \"$2\" = login ]; then\n" +
            "echo 'https://meeting.tencent.com/authorize?code=synthetic-reload-fixture'\n" +
            "while [ ! -f '" + complete + "' ]; do sleep 0.02; done\nfi\n");
        assertTrue(script.toFile().setExecutable(true));
        var original = new TmeetCli.NativeRunner(script.toString());
        try (var loader = new java.net.URLClassLoader(new java.net.URL[]{TmeetCli.class.getProtectionDomain().getCodeSource().getLocation()}, ClassLoader.getPlatformClassLoader())) {
            Class<?> type = loader.loadClass(TmeetCli.NativeRunner.class.getName());
            assertNotSame(TmeetCli.NativeRunner.class, type);
            var constructor = type.getDeclaredConstructor(String.class); constructor.setAccessible(true);
            Object reloaded = constructor.newInstance(script.toString());
            var pending = type.getDeclaredMethod("loginPending"); pending.setAccessible(true);
            var login = type.getDeclaredMethod("login", long.class); login.setAccessible(true);
            var run = type.getDeclaredMethod("run", List.class, Duration.class); run.setAccessible(true);
            var cancel = type.getDeclaredMethod("cancelLogin", long.class); cancel.setAccessible(true);
            String url = original.login(7);
            assertEquals(true, pending.invoke(reloaded), "A fresh classloader must see the old process");
            assertNull(login.invoke(reloaded, 7L), "Reload waits without launching another login or exposing the old URL");
            assertEquals(url, original.login(7), "The original instance can resume its existing URL");
            var error = assertThrows(java.lang.reflect.InvocationTargetException.class,
                () -> run.invoke(reloaded, List.of("auth", "status"), Duration.ofSeconds(1)));
            assertTrue(error.getCause().getMessage().contains("等待浏览器授权"));
            assertThrows(java.lang.reflect.InvocationTargetException.class, () -> cancel.invoke(reloaded, 7L));
            assertTrue(original.loginPending(), "A reloaded instance must not cancel the old process");
            assertEquals(List.of("auth login"), Files.readAllLines(calls));
            assertFalse(System.getProperties().toString().contains("synthetic-reload-fixture"), "No authorization URL belongs in diagnostics");
            Files.writeString(complete, "done");
            long deadline = System.nanoTime() + Duration.ofSeconds(2).toNanos();
            while ((boolean) pending.invoke(reloaded) && System.nanoTime() < deadline) Thread.sleep(20);
            assertEquals(false, pending.invoke(reloaded));
            run.invoke(reloaded, List.of("auth", "status"), Duration.ofSeconds(1));
            assertEquals(List.of("auth login", "auth status"), Files.readAllLines(calls));
        } finally { original.cancelLogin(7); }
    }

}
