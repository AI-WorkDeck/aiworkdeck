// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.ai.mcp;

import com.checkba.service.ai.mcp.fixture.UserMcpStdioFixture;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import java.nio.file.*;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import static org.junit.jupiter.api.Assertions.*;

class UserMcpStdioClientTest {
    @TempDir Path temp;
    private static final ObjectMapper JSON = new ObjectMapper();
    private final UserMcpStdioClient client = new UserMcpStdioClient(true);
    private Path trace() { return temp.resolve("trace"); }
    private static String fixtureClassPath() {
        // Keep the fixture's argv small rather than passing this application's full dependency graph.
        try {
            List<String> entries = new ArrayList<>();
            for (Class<?> type : List.of(UserMcpStdioFixture.class, ObjectMapper.class,
                    com.fasterxml.jackson.core.JsonFactory.class, com.fasterxml.jackson.annotation.JsonInclude.class))
                entries.add(Path.of(type.getProtectionDomain().getCodeSource().getLocation().toURI()).toString());
            return String.join(java.io.File.pathSeparator, entries);
        } catch (java.net.URISyntaxException e) { throw new AssertionError(e); }
    }
    private UserMcpStdioClient.Config config(String mode) {
        return new UserMcpStdioClient.Config(Path.of(System.getProperty("java.home"), "bin", System.getProperty("os.name").startsWith("Windows") ? "java.exe" : "java").toString(),
                List.of("-cp", fixtureClassPath(),
                        UserMcpStdioFixture.class.getName(), mode, trace().toString()), Map.of("SYNTHETIC_MCP_TOKEN", "explicit-value"), temp.toString(), 5);
    }
    private UserMcpStdioClient.Config timeout(String mode, int seconds) {
        var c = config(mode); return new UserMcpStdioClient.Config(c.command(), c.args(), c.env(), c.cwd(), seconds);
    }
    private Map<String, Object> call(String mode) { return client.call(config(mode), "echo", UserMcpStdioFixture.SCHEMA, Map.of("query", "中文 😀"), () -> true); }
    private void assertStopped() throws Exception {
        long pid = Long.parseLong(Files.readString(Path.of(trace() + ".pid")));
        assertTimeoutPreemptively(Duration.ofSeconds(2), () -> { while (ProcessHandle.of(pid).map(ProcessHandle::isAlive).orElse(false)) Thread.sleep(20); });
        assertFalse(Thread.getAllStackTraces().keySet().stream().anyMatch(t -> t.isAlive() && t.getName().equals("user-mcp-stdio-" + pid)), "No reader, writer or stderr drainer may survive cleanup");
    }
    private void awaitMethod(String method) throws Exception {
        assertTimeoutPreemptively(Duration.ofSeconds(4), () -> {
            while (!Files.exists(trace()) || !Files.readString(trace()).contains(method)) Thread.sleep(20);
        });
    }

    @Test void realProcessDiscoveryInitializesAndNeverCallsBusinessTools() throws Exception {
        assertEquals("echo", client.listTools(config("normal"), () -> true).get(0).get("name"));
        assertEquals(List.of("initialize", "notifications/initialized", "tools/list"), Files.readAllLines(trace()));
        assertStopped();
    }
    @Test void realCallPreservesUtf8AndUsesOneSessionThenCleansUp() throws Exception {
        var result = call("normal");
        var content = (List<?>) result.get("content");
        var payload = JSON.readTree((String) ((Map<?, ?>) content.get(0)).get("text"));
        assertEquals("中文 😀", payload.path("query").asText());
        assertEquals(temp.toRealPath(), Path.of(payload.path("cwd").asText()).toRealPath());
        assertEquals("explicit-value", payload.path("env").path("SYNTHETIC_MCP_TOKEN").asText());
        Set<String> inherited = Set.of("PATH", "HOME", "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "APPDATA", "LOCALAPPDATA",
                "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "TMPDIR", "LANG", "LC_ALL", "LC_CTYPE", "SYNTHETIC_MCP_TOKEN",
                "__CF_USER_TEXT_ENCODING"); // macOS adds this during the child JVM's native startup.
        payload.path("env").fieldNames().forEachRemaining(key -> assertTrue(inherited.contains(key.toUpperCase(Locale.ROOT)), key));
        assertEquals(List.of("initialize", "notifications/initialized", "tools/list", "tools/call"), Files.readAllLines(trace()));
        assertStopped();
    }
    @Test void eachOperationHasItsOwnProcess() throws Exception {
        call("normal"); String first = Files.readString(Path.of(trace() + ".pid")); assertStopped();
        call("normal"); assertNotEquals(first, Files.readString(Path.of(trace() + ".pid"))); assertStopped();
    }
    @Test void paginationFindsToolsBeyondFirstPage() throws Exception {
        assertEquals(2, client.listTools(config("pagination"), () -> true).size());
        Files.delete(trace()); call("pagination");
        assertEquals(2, Collections.frequency(Files.readAllLines(trace()), "tools/list")); assertStopped();
    }
    @Test void schemaDriftNeverExecutesTool() throws Exception {
        assertEquals("schema_mismatch", assertThrows(PluginMcpException.class, () -> call("schema-drift")).code());
        assertFalse(Files.readString(trace()).contains("tools/call")); assertStopped();
    }
    @Test void invalidArgumentsFailBeforeLaunch() {
        assertEquals("invalid_arguments", assertThrows(PluginMcpException.class, () -> client.call(config("normal"), "echo", UserMcpStdioFixture.SCHEMA, Map.of(), () -> true)).code());
        assertFalse(Files.exists(Path.of(trace() + ".pid")));
    }
    @Test void stderrFloodIsDrainedWithoutBeingExposed() throws Exception { call("stderr"); assertStopped(); }
    @Test void protocolErrorDoesNotExposeRemoteSecret() throws Exception {
        var failure = assertThrows(PluginMcpException.class, () -> call("remote-error"));
        assertEquals("remote_error", failure.code()); assertFalse(failure.getMessage().contains("synthetic-secret")); assertNull(failure.getCause()); assertStopped();
    }
    @Test void invalidStdoutAndIncompatibleVersionFailClosed() throws Exception {
        for (String mode : List.of("stdout-log", "bad-utf8", "bad-version", "repeated-cursor")) {
            var failure = assertThrows(PluginMcpException.class, () -> call(mode), mode);
            assertEquals("protocol_error", failure.code(), mode); assertFalse(failure.getMessage().contains("secret")); assertStopped();
        }
    }
    @Test void oversizedLineIsBoundedEvenWithoutNewline() throws Exception {
        assertEquals("response_too_large", assertThrows(PluginMcpException.class, () -> call("oversize")).code()); assertStopped();
    }
    @Test void processExitBeforeAndDuringCallNeverReplays() throws Exception {
        assertEquals("transport_error", assertThrows(PluginMcpException.class, () -> call("exit")).code()); assertStopped();
        assertEquals("transport_error", assertThrows(PluginMcpException.class, () -> call("exit-call")).code());
        assertEquals(1, Collections.frequency(Files.readAllLines(trace()), "tools/call")); assertStopped();
    }
    @Test void notificationsAndServerPingAreSupported() throws Exception { call("notification"); assertTrue(Files.readString(trace()).contains("server-response")); assertStopped(); }
    @Test void toolErrorsRemainStructured() throws Exception { assertEquals(true, call("tool-error").get("isError")); assertStopped(); }
    @Test void serverModeAndRevokedAccessNeverStartProcess() {
        var server = new UserMcpStdioClient(false); assertFalse(server.available());
        assertEquals("stdio_unavailable", assertThrows(PluginMcpException.class, () -> server.listTools(config("normal"), () -> true)).code());
        assertEquals("cancelled", assertThrows(PluginMcpException.class, () -> client.listTools(config("normal"), () -> false)).code());
        assertFalse(Files.exists(Path.of(trace() + ".pid")));
    }
    @Test void accessRevocationDuringCallStopsBlockedReadAndProcess() throws Exception {
        AtomicBoolean allowed = new AtomicBoolean(true);
        ExecutorService worker = Executors.newSingleThreadExecutor();
        try {
            Future<?> task = worker.submit(() -> client.call(config("slow"), "echo", UserMcpStdioFixture.SCHEMA, Map.of("query", "x"), allowed::get));
            awaitMethod("tools/call"); allowed.set(false);
            var failure = assertThrows(ExecutionException.class, () -> task.get(2, TimeUnit.SECONDS));
            assertEquals("cancelled", ((PluginMcpException) failure.getCause()).code()); assertStopped();
        } finally { worker.shutdownNow(); }
    }
    @Test void accessRevocationDuringDiscoveryStopsProcessTree() throws Exception {
        AtomicBoolean allowed = new AtomicBoolean(true);
        ExecutorService worker = Executors.newSingleThreadExecutor();
        try {
            Future<?> task = worker.submit(() -> client.listTools(config("tree"), allowed::get));
            assertTimeoutPreemptively(Duration.ofSeconds(4), () -> {
                while (!Files.exists(Path.of(trace() + ".child.pid"))) Thread.sleep(20);
            });
            allowed.set(false);
            var failure = assertThrows(ExecutionException.class, () -> task.get(2, TimeUnit.SECONDS));
            assertEquals("cancelled", ((PluginMcpException) failure.getCause()).code()); assertStopped();
            long child = Long.parseLong(Files.readString(Path.of(trace() + ".child.pid")));
            assertTimeoutPreemptively(Duration.ofSeconds(2), () -> { while (ProcessHandle.of(child).map(ProcessHandle::isAlive).orElse(false)) Thread.sleep(20); });
        } finally { worker.shutdownNow(); }
    }
    @Test void interruptPreservesFlagAndTerminatesProcess() throws Exception {
        AtomicReference<PluginMcpException> failure = new AtomicReference<>(); AtomicBoolean interrupted = new AtomicBoolean();
        Thread worker = new Thread(() -> {
            try { call("slow"); } catch (PluginMcpException e) { failure.set(e); interrupted.set(Thread.currentThread().isInterrupted()); }
        });
        worker.start(); awaitMethod("tools/call"); worker.interrupt(); worker.join(2500);
        assertFalse(worker.isAlive()); assertEquals("cancelled", failure.get().code()); assertTrue(interrupted.get()); assertStopped();
    }
    @Test void deadlineCoversBlockedReadsAndDescendants() throws Exception {
        assertTimeoutPreemptively(Duration.ofSeconds(4), () -> assertEquals("timeout", assertThrows(PluginMcpException.class,
                () -> client.listTools(timeout("tree", 1), () -> true)).code()));
        assertStopped();
        long child = Long.parseLong(Files.readString(Path.of(trace() + ".child.pid")));
        assertTimeoutPreemptively(Duration.ofSeconds(2), () -> { while (ProcessHandle.of(child).map(ProcessHandle::isAlive).orElse(false)) Thread.sleep(20); });
    }
    @Test void deadlineAlsoCoversBlockedStdinWrites() throws Exception {
        assertTimeoutPreemptively(Duration.ofSeconds(4), () -> assertEquals("timeout", assertThrows(PluginMcpException.class,
                () -> client.call(timeout("no-read-call", 1), "echo", UserMcpStdioFixture.SCHEMA, Map.of("query", "x".repeat(512 * 1024)), () -> true)).code()));
        assertStopped();
    }
    @Test void environmentUsesAllowlistAndExplicitOverridesOnly() {
        var env = UserMcpStdioClient.environment(Map.of("PATH", "/usr/bin", "HOME", "/synthetic", "OPENROUTER_API_KEY", "never-inherit", "AWS_SECRET_ACCESS_KEY", "never-inherit", "JAVA_TOOL_OPTIONS", "never-inherit"),
                Map.of("EXPLICIT_TOKEN", "synthetic", "HOME", "/override"));
        assertEquals(Map.of("PATH", "/usr/bin", "HOME", "/override", "EXPLICIT_TOKEN", "synthetic"), env);
    }
    @Test void pathResolutionAndArgumentBoundariesAvoidShellParsing() throws Exception {
        var c = config("normal"); var arguments = new ArrayList<>(c.args());
        List<String> values = List.of("space ; & $(do-not-run) ' \" %PATH% !value!", "", "\"quoted\"",
                "C:\\path with spaces\\", "slash\\\"quote", "\\\\", "line\nbreak", "中文 😀");
        arguments.addAll(values);
        c = new UserMcpStdioClient.Config(Path.of(c.command()).getFileName().toString(), arguments,
                Map.of("PATH", Path.of(c.command()).getParent().toString()), c.cwd(), c.timeoutSeconds());
        var result = client.call(c, "echo", UserMcpStdioFixture.SCHEMA, Map.of("query", "x"), () -> true);
        var payload = JSON.readTree((String) ((Map<?, ?>) ((List<?>) result.get("content")).get(0)).get("text"));
        assertEquals(JSON.valueToTree(values), payload.path("argv")); assertStopped();
    }
    @Test void windowsNpxShimUsesNodeDirectlyAndNeverCmdExe() throws Exception {
        Path node = Files.createFile(temp.resolve("node.exe")); Path shim = Files.createFile(temp.resolve("npx.cmd"));
        Path script = temp.resolve("node_modules/npm/bin/npx-cli.js"); Files.createDirectories(script.getParent()); Files.createFile(script);
        var c = new UserMcpStdioClient.Config(shim.toString(), List.of("a & b", "%TOKEN%"), Map.of(), null, null);
        assertEquals(List.of(node.toString(), script.toString(), "a & b", "%TOKEN%"), UserMcpStdioClient.command(c, Map.of(), true));
        Path arbitrary = Files.createFile(temp.resolve("other.cmd"));
        assertEquals("unsupported_command", assertThrows(PluginMcpException.class, () -> UserMcpStdioClient.command(
                new UserMcpStdioClient.Config(arbitrary.toString(), List.of(), Map.of(), null, null), Map.of(), true)).code());
    }
    @Test void structureValidationDoesNotLaunchAndRejectsInvalidConfigs() {
        UserMcpStdioClient.validate(new UserMcpStdioClient.Config("not-installed-command", null, null, null, null));
        UserMcpStdioClient.validate(new UserMcpStdioClient.Config("not-installed-command", null, null, "", null));
        for (var c : List.of(new UserMcpStdioClient.Config("npx -y package", null, null, null, null),
                new UserMcpStdioClient.Config("npx", List.of("a\0b"), null, null, null),
                new UserMcpStdioClient.Config("npx", null, Map.of("BAD=KEY", "v"), null, null),
                new UserMcpStdioClient.Config("npx", null, null, "relative", null),
                new UserMcpStdioClient.Config("npx", null, null, null, 181)))
            assertEquals("invalid_stdio_config", assertThrows(PluginMcpException.class, () -> UserMcpStdioClient.validate(c)).code());
        assertFalse(Files.exists(Path.of(trace() + ".pid")));
    }
}
