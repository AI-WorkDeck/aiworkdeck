// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.aiworkdeck.plugins.dpia;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;

/** Line-delimited RPC. Host callbacks stay on the caller thread, preserving host identity. */
final class DpiaRuntime {
    static final ObjectMapper JSON = new ObjectMapper();
    static final int MAX_OUTPUT = 40 * 1024 * 1024;
    record Request(List<String> command, Map<String, String> environment, Path directory,
                   ObjectNode payload, Duration timeout) {}
    interface Callback { Object invoke(String method, JsonNode args); }
    interface Runner { JsonNode run(Request request, Callback callback); }
    interface Launcher { Process start(Request request) throws IOException; }
    static final class Failure extends RuntimeException {
        Failure(String message) { super(message); }
    }

    static final class NativeRunner implements Runner {
        private final Launcher launcher;
        private final int outputLimit;
        NativeRunner() {
            this(request -> {
                ProcessBuilder builder = new ProcessBuilder(request.command()).directory(request.directory().toFile());
                builder.environment().putAll(request.environment());
                // Never forward runtime diagnostics (which can contain local paths or document contents).
                builder.redirectError(ProcessBuilder.Redirect.DISCARD);
                return builder.start();
            }, MAX_OUTPUT);
        }
        NativeRunner(Launcher launcher, int outputLimit) { this.launcher = launcher; this.outputLimit = outputLimit; }

        @Override public JsonNode run(Request request, Callback callback) {
            Process process;
            try { process = launcher.start(request); }
            catch (IOException e) { throw new Failure("无法启动 DPIA 运行环境，请检查 Node.js 路径设置"); }
            AtomicBoolean timedOut = new AtomicBoolean();
            ScheduledExecutorService timer = Executors.newSingleThreadScheduledExecutor(runnable -> {
                Thread thread = new Thread(runnable, "dpia-runtime-timeout"); thread.setDaemon(true); return thread;
            });
            timer.schedule(() -> { timedOut.set(true); terminate(process); }, request.timeout().toMillis(), TimeUnit.MILLISECONDS);
            try (InputStream input = process.getInputStream();
                 Writer writer = new OutputStreamWriter(process.getOutputStream(), StandardCharsets.UTF_8)) {
                send(writer, JSON.createObjectNode().set("payload", request.payload()));
                ByteArrayOutputStream line = new ByteArrayOutputStream();
                JsonNode result = null;
                int count = 0;
                int value;
                while ((value = input.read()) != -1) {
                    if (++count > outputLimit) throw new Failure("DPIA 返回内容超过限制，请缩小处理范围");
                    if (value != '\n') { line.write(value); continue; }
                    if (line.size() == 0) continue;
                    JsonNode message = JSON.readTree(line.toString(StandardCharsets.UTF_8)); line.reset();
                    if (message == null || !message.isObject() || result != null) throw new Failure("DPIA 运行环境返回格式异常");
                    if (message.has("result")) { result = message.get("result"); continue; }
                    JsonNode host = message.path("host");
                    if (!message.path("id").isIntegralNumber() || !host.path("method").isTextual() || !host.path("args").isObject())
                        throw new Failure("DPIA 运行环境返回格式异常");
                    ObjectNode response = JSON.createObjectNode().set("id", message.get("id"));
                    try { response.set("result", JSON.valueToTree(callback.invoke(host.path("method").asText(), host.path("args")))); }
                    catch (Exception e) { response.put("error", "宿主会话操作失败，请检查项目权限和会话状态"); }
                    send(writer, response);
                }
                if (process.waitFor() != 0 || line.size() != 0 || result == null) throw new Failure("DPIA 运行未完成，请检查运行环境后重试");
                if (timedOut.get()) throw new Failure("DPIA 操作超时，请缩小处理范围后重试");
                if (!result.isObject() || !result.path("ok").isBoolean()) throw new Failure("DPIA 运行环境返回格式异常");
                return result;
            } catch (Failure e) {
                if (timedOut.get()) throw new Failure("DPIA 操作超时，请缩小处理范围后重试");
                throw e;
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt(); throw new Failure("DPIA 操作已取消");
            } catch (IOException e) {
                throw new Failure(timedOut.get() ? "DPIA 操作超时，请缩小处理范围后重试" : "DPIA 运行通信失败，请重试");
            } finally {
                timer.shutdownNow(); terminate(process);
            }
        }
        private static void send(Writer writer, JsonNode message) throws IOException {
            writer.write(JSON.writeValueAsString(message)); writer.write('\n'); writer.flush();
        }
        private static void terminate(Process process) {
            try { process.descendants().forEach(ProcessHandle::destroyForcibly); } catch (UnsupportedOperationException ignored) {}
            process.destroyForcibly();
        }
    }
}
