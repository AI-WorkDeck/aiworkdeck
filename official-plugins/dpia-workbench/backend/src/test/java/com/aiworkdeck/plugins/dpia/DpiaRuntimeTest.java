// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.aiworkdeck.plugins.dpia;

import org.junit.jupiter.api.Test;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.time.Duration;
import java.util.*;
import static com.aiworkdeck.plugins.dpia.DpiaRuntime.*;
import static org.junit.jupiter.api.Assertions.*;

class DpiaRuntimeTest {
    Request request(Duration timeout) { return new Request(List.of("node"), Map.of(), Path.of("."), JSON.createObjectNode().put("action", "list"), timeout); }
    NativeRunner runner(StubProcess process) { return new NativeRunner(req -> process, MAX_OUTPUT); }

    @Test void runsCallbacksOnCallerThreadAndWritesResponsesBeforeAcceptingResult() throws Exception {
        StubProcess process = new StubProcess("{\"host\":{\"method\":\"ensure\",\"args\":{\"key\":\"s1\"}},\"id\":1}\n"
            + "{\"host\":{\"method\":\"submit\",\"args\":{\"key\":\"s1\"}},\"id\":2}\n"
            + "{\"result\":{\"ok\":true,\"value\":{\"id\":\"s1\"}}}\n", 0);
        Thread caller = Thread.currentThread(); List<String> methods = new ArrayList<>();
        var result = runner(process).run(request(Duration.ofSeconds(1)), (method, args) -> {
            assertSame(caller, Thread.currentThread()); assertEquals("s1", args.path("key").asText()); methods.add(method);
            if (method.equals("submit")) throw new IllegalArgumentException("/secret/path token");
            return Map.of("conversationId", "c1");
        });
        assertTrue(result.path("ok").asBoolean()); assertEquals(List.of("ensure", "submit"), methods);
        List<String> lines = process.stdin.toString(StandardCharsets.UTF_8).lines().toList();
        assertEquals("list", JSON.readTree(lines.getFirst()).path("payload").path("action").asText());
        assertEquals("c1", JSON.readTree(lines.get(1)).path("result").path("conversationId").asText());
        assertEquals(2, JSON.readTree(lines.get(2)).path("id").asInt());
        assertTrue(JSON.readTree(lines.get(2)).has("error")); assertFalse(lines.get(2).contains("secret")); assertTrue(process.destroyed);
    }
    @Test void rejectsMalformedPartialExtraMessagesAndNonzeroExit() {
        for (String stdout : List.of("invalid\n", "{}\n", "{\"result\":{\"ok\":true}}", "{\"result\":{}}\n",
            "{\"result\":{\"ok\":true}}\n{\"result\":{\"ok\":true}}\n")) {
            StubProcess process = new StubProcess(stdout, 0);
            assertThrows(Failure.class, () -> runner(process).run(request(Duration.ofSeconds(1)), (method, args) -> true)); assertTrue(process.destroyed);
        }
        StubProcess process = new StubProcess("{\"result\":{\"ok\":true}}\n", 1);
        assertThrows(Failure.class, () -> runner(process).run(request(Duration.ofSeconds(1)), (method, args) -> true));
    }
    @Test void preservesStructuredRuntimeFailure() {
        StubProcess process = new StubProcess("{\"result\":{\"ok\":false,\"error\":{\"message\":\"无法生成\"}}}\n", 0);
        var result = runner(process).run(request(Duration.ofSeconds(1)), (method, args) -> true);
        assertFalse(result.path("ok").asBoolean()); assertEquals("无法生成", result.path("error").path("message").asText());
    }
    @Test void outputLimitAppliesBeforeAnUnterminatedLineCanGrowForever() {
        StubProcess process = new StubProcess("x".repeat(300), 0);
        Failure failure = assertThrows(Failure.class, () -> new NativeRunner(req -> process, 128).run(request(Duration.ofSeconds(1)), (method, args) -> true));
        assertTrue(failure.getMessage().contains("超过限制")); assertTrue(process.destroyed);
    }
    @Test void timeoutKillsProcessWhileWaitingForStdout() {
        BlockingInput stdout = new BlockingInput(); StubProcess process = new StubProcess(stdout, 0);
        Failure failure = assertTimeoutPreemptively(Duration.ofSeconds(2), () -> assertThrows(Failure.class,
            () -> runner(process).run(request(Duration.ofMillis(30)), (method, args) -> true)));
        assertTrue(failure.getMessage().contains("超时")); assertTrue(process.destroyed);
    }
    @Test void missingExecutableHasActionableSanitizedMessage() {
        Failure failure = assertThrows(Failure.class, () -> new NativeRunner(req -> { throw new IOException("/secret/path"); }, MAX_OUTPUT)
            .run(request(Duration.ofSeconds(1)), (method, args) -> true));
        assertTrue(failure.getMessage().contains("Node.js")); assertFalse(failure.getMessage().contains("secret"));
    }
    static final class BlockingInput extends InputStream {
        boolean closed;
        @Override public synchronized int read() throws IOException {
            while (!closed) { try { wait(); } catch (InterruptedException e) { Thread.currentThread().interrupt(); throw new IOException(e); } }
            return -1;
        }
        @Override public synchronized void close() { closed = true; notifyAll(); }
    }
    static final class StubProcess extends Process {
        final ByteArrayOutputStream stdin = new ByteArrayOutputStream();
        final InputStream stdout; final int exit; volatile boolean destroyed;
        StubProcess(String stdout, int exit) { this(new ByteArrayInputStream(stdout.getBytes(StandardCharsets.UTF_8)), exit); }
        StubProcess(InputStream stdout, int exit) { this.stdout = stdout; this.exit = exit; }
        @Override public OutputStream getOutputStream() { return stdin; }
        @Override public InputStream getInputStream() { return stdout; }
        @Override public InputStream getErrorStream() { return InputStream.nullInputStream(); }
        @Override public int waitFor() { return exit; }
        @Override public int exitValue() { return exit; }
        @Override public void destroy() { destroyed = true; try { stdout.close(); } catch (IOException ignored) {} }
        @Override public Process destroyForcibly() { destroy(); return this; }
    }
}
