// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.aiworkdeck.plugins.tmeet;

import java.io.*;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.*;
import java.util.regex.Pattern;

/** The CLI owns its local account. Never log commands or raw output (both can contain private data). */
class TmeetCli {
    static final String MISSING = "未找到或无法执行腾讯会议 CLI，请先安装 @tencentcloud/tmeet，并确保 Node.js 可用";
    static class Failure extends RuntimeException { Failure(String message) { super(message); } }
    record Result(int exitCode, String output) {}
    interface Runner {
        Result run(List<String> arguments, Duration timeout);
        String login(long userId); // Null means an older plugin instance is still authorizing in its browser page.
        void cancelLogin(long userId);
        default boolean loginPending() { return false; }
    }
    static class NativeRunner implements Runner {
        // Plugin rescans create new classloaders. Interned JDK strings and plain system properties survive them.
        // Keep only PID + start time here: authorization URLs stay private to their original runner.
        private static final String LOGIN_PROCESS = "com.aiworkdeck.plugins.tencent-meeting.login-process";
        private static final Object COMMAND_MONITOR = LOGIN_PROCESS.intern();
        private final java.util.function.Supplier<List<String>> executable;
        private Process loginProcess;
        private long loginUser;
        private String loginUrl;
        NativeRunner() { this(TmeetCli.NativeRunner::resolveExecutable); }
        NativeRunner(String executable) { this(() -> List.of(executable)); }
        NativeRunner(java.util.function.Supplier<List<String>> executable) { this.executable = executable; }
        static boolean windows() { return System.getProperty("os.name").toLowerCase(Locale.ROOT).startsWith("windows"); }
        static List<String> resolveExecutable() {
            return TmeetCliDiscovery.resolve(windows(), System.getenv(), System.getProperty("user.home"));
        }
        private Process start(List<String> args) throws IOException {
            // Never feed identifiers or tokens into cmd.exe/a shell. A Windows npm .cmd shim is not executable here.
            List<String> resolved = executable.get(); // Resolve again after the user repairs an installation.
            String first = resolved.getFirst().toLowerCase(Locale.ROOT);
            if (windows() && (first.endsWith(".cmd") || first.endsWith(".bat"))) throw new IOException("unsupported CLI wrapper");
            List<String> command = new ArrayList<>(resolved); command.addAll(args);
            ProcessBuilder builder = new ProcessBuilder(command).redirectErrorStream(true);
            String path = builder.environment().getOrDefault("PATH", "");
            List<String> extra = new ArrayList<>();
            if (windows()) {
                for (String env : List.of("ProgramFiles", "ProgramFiles(x86)")) {
                    String base = System.getenv(env);
                    if (base != null) extra.add(Path.of(base, "nodejs").toString());
                }
            } else {
                extra.add(System.getProperty("user.home") + "/.local/bin");
                extra.add("/opt/homebrew/bin"); extra.add("/usr/local/bin");
            }
            extra.add(path);
            builder.environment().put("PATH", String.join(File.pathSeparator, extra));
            builder.environment().put("TMEET_AGENT", "AI WorkDeck");
            builder.environment().put("TMEET_MODEL", "Tencent Meeting Plugin");
            return builder.start();
        }
        private static void stop(Process process) {
            process.descendants().forEach(ProcessHandle::destroyForcibly);
            process.destroyForcibly();
        }
        @Override public synchronized Result run(List<String> args, Duration timeout) {
            synchronized (COMMAND_MONITOR) { return runExclusive(args, timeout); }
        }
        private Result runExclusive(List<String> args, Duration timeout) {
            if (loginPending()) throw new Failure("正在等待浏览器授权，请完成后再操作");
            Process process;
            try { process = start(args); } catch (IOException e) { throw new Failure(MISSING); }
            try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
                Future<String> output = executor.submit(() -> {
                    try (InputStream in = process.getInputStream()) {
                        byte[] bytes = in.readNBytes(8 * 1024 * 1024 + 1);
                        if (bytes.length > 8 * 1024 * 1024) { stop(process); throw new Failure("腾讯会议返回内容过大，请缩小查询范围"); }
                        return new String(bytes, StandardCharsets.UTF_8);
                    }
                });
                try {
                    if (!process.waitFor(timeout.toMillis(), TimeUnit.MILLISECONDS)) throw new TimeoutException();
                    return new Result(process.exitValue(), output.get(2, TimeUnit.SECONDS));
                } catch (TimeoutException e) {
                    throw new Failure("腾讯会议请求超时，请稍后重试");
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt(); throw new Failure("腾讯会议请求已取消");
                } catch (ExecutionException e) {
                    if (e.getCause() instanceof Failure f) throw f;
                    throw new Failure("无法读取腾讯会议响应");
                } finally { stop(process); }
            }
        }
        @Override public synchronized String login(long userId) {
            synchronized (COMMAND_MONITOR) { return loginExclusive(userId); }
        }
        private String loginExclusive(long userId) {
            if (loginProcess != null && loginProcess.isAlive()) {
                if (loginUser != userId) throw new Failure("本机已有其他用户正在授权，请稍后重试");
                if (loginUrl != null) return loginUrl;
            }
            if (loginPending()) return null; // Another plugin instance still owns the existing browser authorization.
            loginUrl = null;
            try { loginProcess = start(List.of("auth", "login", "--no-browser")); }
            catch (IOException e) { throw new Failure(MISSING); }
            System.setProperty(LOGIN_PROCESS, processIdentity(loginProcess.toHandle()));
            loginUser = userId;
            Process process = loginProcess;
            CompletableFuture<String> url = new CompletableFuture<>();
            Thread.ofVirtual().start(() -> {
                try (BufferedReader reader = process.inputReader(StandardCharsets.UTF_8)) {
                    String line;
                    while ((line = reader.readLine()) != null) {
                        var match = Pattern.compile("https://[^\\s<>\\\"]+").matcher(line);
                        if (match.find() && validAuthorizeUrl(match.group())) url.complete(match.group());
                    }
                } catch (IOException ignored) { /* sanitized failure below */ }
                finally { url.completeExceptionally(new Failure("未能取得授权地址，请在终端运行 tmeet auth login 完成授权")); }
            });
            Thread.ofVirtual().start(() -> {
                try { process.waitFor(300, TimeUnit.SECONDS); }
                catch (InterruptedException e) { Thread.currentThread().interrupt(); }
                finally { stop(process); }
            });
            try { loginUrl = url.get(10, TimeUnit.SECONDS); return loginUrl; }
            catch (InterruptedException e) { Thread.currentThread().interrupt(); stop(process); throw new Failure("授权已取消"); }
            catch (ExecutionException | TimeoutException e) { stop(process); throw new Failure("未能取得授权地址，请在终端运行 tmeet auth login 完成授权"); }
        }
        private static String processIdentity(ProcessHandle process) {
            return process.pid() + ":" + process.info().startInstant().map(Object::toString).orElse("");
        }
        @Override public synchronized boolean loginPending() {
            synchronized (COMMAND_MONITOR) {
                if (loginProcess != null && loginProcess.isAlive()) return true;
                String saved = System.getProperty(LOGIN_PROCESS, "");
                if (saved.isEmpty()) return false;
                try {
                    long pid = Long.parseLong(saved.split(":", 2)[0]);
                    if (ProcessHandle.of(pid).filter(ProcessHandle::isAlive)
                        .filter(process -> processIdentity(process).equals(saved)).isPresent()) return true;
                } catch (IllegalArgumentException ignored) { /* Ignore malformed or expired process identities. */ }
                System.clearProperty(LOGIN_PROCESS);
                return false;
            }
        }
        @Override public synchronized void cancelLogin(long userId) {
            synchronized (COMMAND_MONITOR) { cancelLoginExclusive(userId); }
        }
        private void cancelLoginExclusive(long userId) {
            if (loginProcess != null && loginProcess.isAlive()) {
                if (loginUser != userId) throw new Failure("本机已有其他用户正在授权，请稍后重试");
                stop(loginProcess);
            } else if (loginPending()) throw new Failure("授权仍在原浏览器中进行，请完成后再操作");
            loginUrl = null;
        }
    }
    static boolean validAuthorizeUrl(String value) {
        try {
            URI uri = URI.create(value);
            String host = uri.getHost();
            return "https".equals(uri.getScheme()) && uri.getUserInfo() == null && (uri.getPort() == -1 || uri.getPort() == 443)
                && host != null && (host.equals("meeting.tencent.com") || host.endsWith(".meeting.tencent.com"));
        } catch (IllegalArgumentException e) { return false; }
    }
}
