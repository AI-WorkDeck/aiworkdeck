// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.ai.mcp;

import com.checkba.service.LangText;
import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.io.*;
import java.nio.ByteBuffer;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.function.BooleanSupplier;

/** One explicitly trusted local process per operation; never invoked while merely reading settings. */
@Component
public class UserMcpStdioClient {
    static final int MAX_BYTES = 2 * 1024 * 1024;
    private static final Set<String> VERSIONS = Set.of("2025-11-25", "2025-06-18", "2025-03-26");
    private static final Set<String> INHERITED_ENV = Set.of("PATH", "HOME", "USERPROFILE", "HOMEDRIVE", "HOMEPATH",
            "APPDATA", "LOCALAPPDATA", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "TMPDIR", "LANG", "LC_ALL", "LC_CTYPE");
    private static final ObjectMapper JSON = new ObjectMapper().enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
            .enable(JsonParser.Feature.STRICT_DUPLICATE_DETECTION);
    private static final TypeReference<Map<String, Object>> MAP = new TypeReference<>() {};
    private final boolean localMode;

    public UserMcpStdioClient(@Value("${security.local-mode:false}") boolean localMode) { this.localMode = localMode; }
    public record Config(String command, List<String> args, Map<String, String> env, String cwd, Integer timeoutSeconds) {}
    public boolean available() { return localMode; }

    /** Structural validation only: saving a configuration must not execute or resolve its command. */
    public static void validate(Config c) {
        if (c == null || !validText(c.command(), 4096) || c.command().isBlank()
                || c.command().contains("\n") || c.command().contains("\r") || !c.command().equals(c.command().strip())) throw invalidConfig();
        try {
            if ((c.command().contains("/") || c.command().contains("\\")) && !Path.of(c.command()).isAbsolute()) throw invalidConfig();
            if (!c.command().contains("/") && !c.command().contains("\\") && !c.command().matches("[A-Za-z0-9_.+\\-]+")) throw invalidConfig();
            if (c.cwd() != null && !c.cwd().isEmpty() && (!validText(c.cwd(), 4096) || c.cwd().contains("\n") || c.cwd().contains("\r")
                    || !Path.of(c.cwd()).isAbsolute())) throw invalidConfig();
        } catch (InvalidPathException e) { throw invalidConfig(); }
        if (c.timeoutSeconds() != null && (c.timeoutSeconds() < 1 || c.timeoutSeconds() > 180)) throw invalidConfig();
        int size = c.command().length() + (c.cwd() == null ? 0 : c.cwd().length());
        if (c.args() != null) {
            if (c.args().size() > 256) throw invalidConfig();
            for (String arg : c.args()) { if (!validText(arg, 16384)) throw invalidConfig(); size += arg.length(); }
        }
        if (c.env() != null) {
            if (c.env().size() > 128) throw invalidConfig();
            for (var entry : c.env().entrySet()) {
                if (entry.getKey() == null || !entry.getKey().matches("[A-Za-z_][A-Za-z0-9_]{0,127}")
                        || !validText(entry.getValue(), 16384)) throw invalidConfig();
                size += entry.getKey().length() + entry.getValue().length();
            }
        }
        if (size > 128 * 1024) throw invalidConfig();
    }

    public List<Map<String, Object>> listTools(Config config, BooleanSupplier allowed) {
        try (Session session = open(config, allowed)) { session.initialize(); return session.discover(); }
    }

    public Map<String, Object> call(Config config, String name, Map<String, Object> schema,
                                    Map<String, Object> args, BooleanSupplier allowed) {
        if (name == null || name.isBlank() || name.length() > 256) throw invalidConfig();
        UserMcpSchema.validate(schema, args);
        try (Session session = open(config, allowed)) {
            session.initialize();
            Map<String, Object> tool = session.discover().stream().filter(t -> name.equals(t.get("name"))).findFirst()
                    .orElseThrow(() -> failure("tool_unavailable", "MCP 服务未提供该工具。", "The MCP server does not offer this tool."));
            if (!JSON.valueToTree(schema).equals(JSON.valueToTree(tool.get("inputSchema"))))
                throw failure("schema_mismatch", "MCP 工具定义已变化，请重新测试连接。", "The MCP tool schema changed. Test the connection again.");
            JsonNode result = session.rpc("tools/call", Map.of("name", name, "arguments", args));
            if (!result.isObject() || !result.path("content").isArray()) throw protocol();
            session.guard();
            return JSON.convertValue(result, MAP);
        }
    }

    private Session open(Config c, BooleanSupplier allowed) {
        if (!available()) throw new PluginMcpException("stdio_unavailable", 403,
                LangText.of("本地 MCP 命令仅可在桌面本地模式运行。", "Local MCP commands require desktop local mode."));
        validate(c);
        // Snapshot caller-owned collections before starting the trusted configuration.
        return new Session(new Config(c.command(), c.args() == null ? List.of() : List.copyOf(c.args()),
                c.env() == null ? Map.of() : Map.copyOf(c.env()), c.cwd() == null || c.cwd().isEmpty() ? null : c.cwd(), c.timeoutSeconds()), Objects.requireNonNull(allowed));
    }

    static Map<String, String> environment(Map<String, String> inherited, Map<String, String> explicit) {
        Map<String, String> result = new LinkedHashMap<>();
        inherited.forEach((key, value) -> { if (INHERITED_ENV.contains(key.toUpperCase(Locale.ROOT))) result.put(key, value); });
        explicit.forEach((key, value) -> {
            // Windows environment names are case insensitive; avoid ambiguous PATH/Path duplicates.
            if (isWindows()) result.keySet().removeIf(existing -> existing.equalsIgnoreCase(key));
            result.put(key, value);
        });
        return result;
    }

    /** Resolve PATH ourselves: ProcessBuilder's Unix command search otherwise uses the parent's PATH. */
    static List<String> command(Config c, Map<String, String> env, boolean windows) {
        Path executable = resolve(c.command(), env, windows);
        List<String> result = new ArrayList<>();
        String file = executable.getFileName().toString().toLowerCase(Locale.ROOT);
        if (windows && (file.endsWith(".cmd") || file.endsWith(".bat"))) {
            // npm's standard launcher can be executed as node + JS with no cmd.exe parsing.
            // Arbitrary batch files require a shell and are intentionally not interpreted here.
            String cli = switch (file) { case "npx.cmd" -> "npx-cli.js"; case "npm.cmd" -> "npm-cli.js"; default -> null; };
            Path script = executable.getParent().resolve("node_modules/npm/bin/" + cli);
            if (cli == null || !Files.isRegularFile(script)) throw failure("unsupported_command",
                    "请使用可执行程序；Windows 的 npm/npx 可使用标准安装目录。", "Use an executable; Windows npm/npx requires its standard installation layout.");
            Path node = executable.getParent().resolve("node.exe");
            if (!Files.isRegularFile(node)) node = resolve("node.exe", env, true);
            result.add(node.toString()); result.add(script.toString());
        } else result.add(executable.toString());
        result.addAll(c.args());
        return result;
    }

    private static Path resolve(String command, Map<String, String> env, boolean windows) {
        Path direct = Path.of(command);
        if (direct.isAbsolute()) {
            if (Files.isRegularFile(direct) && (windows || Files.isExecutable(direct))) return direct;
        } else {
            String path = env.entrySet().stream().filter(e -> e.getKey().equalsIgnoreCase("PATH")).map(Map.Entry::getValue).findFirst().orElse("");
            for (String directory : path.split(windows ? ";" : ":")) {
                // Never search the backend cwd via a blank/relative PATH entry.
                if (directory.isBlank()) continue;
                try {
                    Path dir = Path.of(directory);
                    if (!dir.isAbsolute()) continue;
                    for (String suffix : windows ? List.of("", ".exe", ".com", ".cmd", ".bat") : List.of("")) {
                        Path candidate = dir.resolve(command + suffix);
                        if (Files.isRegularFile(candidate) && (windows || Files.isExecutable(candidate))) return candidate;
                    }
                } catch (InvalidPathException ignored) { /* invalid PATH segment is not executable */ }
            }
        }
        throw failure("command_unavailable", "找不到 MCP 可执行程序，请检查命令和 PATH。", "MCP executable was not found. Check the command and PATH.");
    }

    private static boolean isWindows() { return System.getProperty("os.name", "").toLowerCase(Locale.ROOT).startsWith("windows"); }

    private static List<String> processArguments(List<String> command) {
        if (!isWindows()) return command;
        List<String> result = new ArrayList<>(command);
        // OpenJDK 17/21's default Windows ProcessImpl preserves prequoted arguments, but
        // does not escape embedded quotes in raw arguments. Encode each argv using CRT rules.
        // https://learn.microsoft.com/en-us/cpp/c-language/parsing-c-command-line-arguments
        boolean legacy = !"false".equalsIgnoreCase(System.getProperty("jdk.lang.Process.allowAmbiguousCommands"));
        for (int i = 1; i < result.size(); i++) {
            String arg = result.get(i);
            if (!legacy) {
                // Strict ProcessImpl handles raw quotes itself, except outer quotes which it
                // treats as user-supplied quoting. Reject those rather than silently alter argv.
                if (arg.length() >= 2 && arg.startsWith("\"") && arg.endsWith("\"")) throw invalidConfig();
                continue;
            }
            StringBuilder quoted = new StringBuilder("\"");
            int slashes = 0;
            for (int j = 0; j < arg.length(); j++) {
                char ch = arg.charAt(j);
                if (ch == '\\') { slashes++; continue; }
                quoted.append("\\".repeat(ch == '"' ? slashes * 2 + 1 : slashes)).append(ch);
                slashes = 0;
            }
            result.set(i, quoted.append("\\".repeat(slashes * 2)).append('"').toString());
        }
        return result;
    }

    private static final class Session implements AutoCloseable {
        private final BooleanSupplier allowed;
        private final long deadline;
        private final Process process;
        private final ExecutorService io;
        private final BlockingQueue<Object> received = new ArrayBlockingQueue<>(16);
        private final Map<Long, ProcessHandle> descendants = new LinkedHashMap<>();
        private volatile boolean closed;

        Session(Config config, BooleanSupplier allowed) {
            this.allowed = allowed;
            deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(config.timeoutSeconds() == null ? 60 : config.timeoutSeconds());
            guard();
            ProcessBuilder builder = new ProcessBuilder();
            Map<String, String> env = environment(System.getenv(), config.env());
            builder.environment().clear(); builder.environment().putAll(env);
            builder.command(processArguments(command(config, env, isWindows())));
            if (config.cwd() != null) builder.directory(Path.of(config.cwd()).toFile());
            guard();
            try { process = builder.start(); }
            catch (IOException | IllegalArgumentException e) { throw failure("transport_error", "无法启动 MCP 进程。", "Could not start the MCP process."); }
            io = Executors.newFixedThreadPool(3, runnable -> {
                Thread thread = new Thread(runnable, "user-mcp-stdio-" + process.pid()); thread.setDaemon(true); return thread;
            });
            io.submit(this::read);
            io.submit(() -> {
                // Drain continuously, retaining no arbitrary stderr text (which may contain secrets).
                try (InputStream stderr = process.getErrorStream()) { stderr.transferTo(OutputStream.nullOutputStream()); }
                catch (IOException ignored) { /* cleanup/exit closes the pipe */ }
            });
        }

        void guard() {
            if (Thread.currentThread().isInterrupted() || !allowed.getAsBoolean())
                throw new PluginMcpException("cancelled", 409, LangText.of("MCP 调用已取消或连接权限已变化。", "MCP call cancelled or connection access changed."));
            if (System.nanoTime() >= deadline) throw failure("timeout", "MCP 进程响应超时。", "The MCP process timed out.");
            if (process != null) process.descendants().forEach(handle -> descendants.put(handle.pid(), handle));
        }

        void initialize() {
            JsonNode result = rpc("initialize", Map.of("protocolVersion", "2025-11-25", "capabilities", Map.of(),
                    "clientInfo", Map.of("name", "AIWorkDeck", "version", "1.0")));
            if (!VERSIONS.contains(result.path("protocolVersion").asText()) || !result.path("capabilities").path("tools").isObject()) throw protocol();
            send(Map.of("jsonrpc", "2.0", "method", "notifications/initialized"));
        }

        List<Map<String, Object>> discover() {
            List<Map<String, Object>> tools = new ArrayList<>();
            Set<String> names = new HashSet<>(), cursors = new HashSet<>();
            String cursor = null;
            int size = 0;
            for (int page = 0; page < 16; page++) {
                JsonNode result = rpc("tools/list", cursor == null ? Map.of() : Map.of("cursor", cursor));
                JsonNode rows = result.path("tools");
                if (!rows.isArray() || tools.size() + rows.size() > 256) throw protocol();
                for (JsonNode row : rows) {
                    if (!row.isObject() || !row.path("name").isTextual() || row.path("name").asText().isBlank()
                            || row.path("name").asText().length() > 256 || !names.add(row.path("name").asText()) || !row.path("inputSchema").isObject()) throw protocol();
                    size += row.toString().length();
                    if (size > 256 * 1024) throw protocol();
                    Map<String, Object> tool = JSON.convertValue(row, MAP);
                    UserMcpSchema.check(JSON.convertValue(row.path("inputSchema"), MAP));
                    tools.add(tool);
                }
                JsonNode next = result.get("nextCursor");
                if (next == null || next.isNull()) return tools;
                if (!next.isTextual() || next.asText().length() > 4096) throw protocol();
                cursor = next.asText();
                if (cursor.isBlank()) return tools;
                if (!cursors.add(cursor)) throw protocol();
            }
            throw protocol();
        }

        JsonNode rpc(String method, Map<String, Object> params) {
            String id = UUID.randomUUID().toString();
            send(Map.of("jsonrpc", "2.0", "id", id, "method", method, "params", params));
            while (true) {
                guard();
                Object message;
                try { message = received.poll(50, TimeUnit.MILLISECONDS); }
                catch (InterruptedException e) { Thread.currentThread().interrupt(); guard(); throw protocol(); }
                if (message == null) continue;
                if (message instanceof PluginMcpException error) throw error;
                JsonNode frame = (JsonNode) message;
                if (frame.has("method")) {
                    if (!frame.path("method").isTextual() || frame.has("result") || frame.has("error")) throw protocol();
                    if (frame.has("id")) {
                        if (!frame.path("id").isTextual() && !frame.path("id").isIntegralNumber()) throw protocol();
                        // No roots/sampling/elicitation capabilities are advertised. Ping is universal.
                        Object response = "ping".equals(frame.path("method").asText())
                                ? Map.of("jsonrpc", "2.0", "id", frame.get("id"), "result", Map.of())
                                : Map.of("jsonrpc", "2.0", "id", frame.get("id"), "error", Map.of("code", -32601, "message", "Method not found"));
                        send(response);
                    }
                    continue;
                }
                if (!frame.path("id").isTextual() || !id.equals(frame.path("id").asText()) || frame.has("error") == frame.has("result")) throw protocol();
                if (frame.has("error")) throw failure("remote_error", "MCP 服务返回协议错误。", "The MCP server returned a protocol error.");
                guard();
                return frame.get("result");
            }
        }

        void send(Object payload) {
            guard();
            byte[] bytes;
            try { bytes = JSON.writeValueAsBytes(payload); }
            catch (IOException e) { throw protocol(); }
            if (bytes.length > MAX_BYTES) throw tooLarge();
            Future<?> write = io.submit(() -> {
                try { OutputStream stdin = process.getOutputStream(); stdin.write(bytes); stdin.write('\n'); stdin.flush(); }
                catch (IOException e) { throw failure("transport_error", "MCP 进程连接已关闭。", "The MCP process connection closed."); }
            });
            try {
                while (true) {
                    guard();
                    try { write.get(50, TimeUnit.MILLISECONDS); guard(); return; }
                    catch (TimeoutException ignored) { /* guards also cover blocked stdin writes */ }
                }
            } catch (InterruptedException e) { Thread.currentThread().interrupt(); guard(); }
            catch (ExecutionException e) { throw failure("transport_error", "MCP 进程连接已关闭。", "The MCP process connection closed."); }
            finally { if (!write.isDone()) write.cancel(true); }
        }

        private void read() {
            try (InputStream stdout = new BufferedInputStream(process.getInputStream())) {
                while (!closed) {
                    ByteArrayOutputStream line = new ByteArrayOutputStream();
                    int value;
                    while ((value = stdout.read()) != -1 && value != '\n') {
                        if (line.size() >= MAX_BYTES) throw tooLarge();
                        line.write(value);
                    }
                    if (value == -1) throw failure("transport_error", "MCP 进程已退出或关闭输出。", "The MCP process exited or closed its output.");
                    String text = StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
                            .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(line.toByteArray())).toString();
                    JsonNode frame = JSON.readTree(text);
                    if (frame == null || !frame.isObject() || !"2.0".equals(frame.path("jsonrpc").asText())) throw protocol();
                    received.put(frame);
                }
            } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
            catch (Exception e) {
                if (!closed) {
                    try { received.put(e instanceof PluginMcpException ? e : protocol()); }
                    catch (InterruptedException interrupted) { Thread.currentThread().interrupt(); }
                }
            }
        }

        @Override public void close() {
            closed = true;
            process.descendants().forEach(handle -> descendants.put(handle.pid(), handle));
            List<ProcessHandle> handles = new ArrayList<>(descendants.values());
            Collections.reverse(handles);
            // Stop descendants before their parent disappears; retain handles across all polling cycles.
            handles.forEach(ProcessHandle::destroy);
            process.destroy();
            boolean interrupted = Thread.interrupted();
            try { process.waitFor(200, TimeUnit.MILLISECONDS); }
            catch (InterruptedException e) { interrupted = true; }
            handles.forEach(handle -> { if (handle.isAlive()) handle.destroyForcibly(); });
            if (process.isAlive()) process.destroyForcibly();
            try { process.waitFor(500, TimeUnit.MILLISECONDS); }
            catch (InterruptedException e) { interrupted = true; }
            closeStream(process.getOutputStream()); closeStream(process.getInputStream()); closeStream(process.getErrorStream());
            io.shutdownNow();
            try { io.awaitTermination(500, TimeUnit.MILLISECONDS); }
            catch (InterruptedException e) { interrupted = true; }
            if (interrupted) Thread.currentThread().interrupt();
        }
    }

    private static void closeStream(Closeable stream) { try { stream.close(); } catch (IOException ignored) { /* process is terminated */ } }
    private static boolean validText(String value, int max) { return value != null && value.length() <= max && value.indexOf('\0') < 0; }
    private static PluginMcpException invalidConfig() { return new PluginMcpException("invalid_stdio_config", 400,
            LangText.of("MCP 本地命令配置无效，请检查命令、参数、环境变量、绝对工作目录及超时时间。", "Invalid local MCP command configuration. Check the command, arguments, environment, absolute working directory and timeout.")); }
    private static PluginMcpException protocol() { return failure("protocol_error", "MCP 进程返回了无效协议消息。", "The MCP process returned an invalid protocol message."); }
    private static PluginMcpException tooLarge() { return failure("response_too_large", "MCP 消息超过大小限制。", "The MCP message exceeds the size limit."); }
    private static PluginMcpException failure(String code, String zh, String en) { return new PluginMcpException(code, 502, LangText.of(zh, en)); }
}
