// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.aiworkdeck.plugins.dpia;

import com.fasterxml.jackson.databind.JsonNode;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.function.Function;
import static com.aiworkdeck.plugins.dpia.DpiaRuntime.JSON;

/** Direct, bounded probes: this entry remains usable when Node RPC cannot start. */
final class DpiaEnvironment {
    record Result(int exitCode, String output, String failure) { }
    interface Probe { Result run(List<String> command, Map<String, String> environment); }
    private final Probe probe;
    private final String os;
    DpiaEnvironment() { this(DpiaEnvironment::run, System.getProperty("os.name", "")); }
    DpiaEnvironment(Probe probe, String os) { this.probe = probe; this.os = os; }

    Map<String, Object> check(Path root, Function<String, String> settings, Map<String, String> env) {
        List<Map<String, String>> checks = new ArrayList<>();
        String platform = os.toLowerCase(Locale.ROOT);
        boolean supported = platform.startsWith("mac") || platform.startsWith("windows") || platform.startsWith("linux");
        if (!supported) {
            checks.add(item("platform", "操作系统", false, "当前系统不在支持范围，请使用 macOS、Windows 或 Linux 的插件运行环境。"));
            return response(root, checks, false);
        }
        String node = setting(settings, env, "nodePath", "AWD_DPIA_NODE", "node");
        Result n = probe.run(List.of(node, "--version"), Map.of());
        var version = java.util.regex.Pattern.compile("^v(\\d+)\\.").matcher(n.output().trim());
        boolean nodeReady = n.failure() == null && n.exitCode() == 0 && version.find() && Integer.parseInt(version.group(1)) >= 20;
        checks.add(item("node", "Node.js", nodeReady, nodeReady ? n.output().trim() + " 可用" : failure(n, "需要 Node.js 20 或更新版本；安装当前 LTS 后，在插件设置填写 node 可执行文件路径。")));
        String python = setting(settings, env, "pythonPath", "AWD_DPIA_PYTHON", env.getOrDefault("DSH_DPIA_PYTHON", "python3"));
        String font = setting(settings, env, "pdfFontPath", "DSH_DPIA_PDF_FONT", null);
        Map<String, String> child = font == null ? Map.of("PYTHONDONTWRITEBYTECODE", "1") : Map.of("PYTHONDONTWRITEBYTECODE", "1", "DSH_DPIA_PDF_FONT", font);
        Result p = probe.run(List.of(python, root.resolve("runtime/environment-check.py").toString()), child);
        boolean parsed = false;
        if (p.failure() == null && p.exitCode() == 0) {
            try {
                JsonNode data = JSON.readTree(p.output());
                if (data.path("checks").isArray() && data.path("checks").size() == 6) {
                    for (JsonNode c : data.path("checks")) {
                        checks.add(item(c.path("id").asText(), c.path("label").asText(), "ready".equals(c.path("status").asText()), c.path("message").asText()));
                    }
                    parsed = true;
                }
            } catch (Exception ignored) { }
        }
        if (!parsed) checks.add(item("python", "Python、文档库与字体", false, failure(p,
                "无法完成 Python 检测。请安装 Python 3.9+，在独立环境安装插件 runtime/requirements.txt，并在插件设置填写该环境的 Python 路径。")));
        String office = setting(settings, env, "sofficePath", "AWD_DPIA_SOFFICE", null);
        if (office == null) office = findOffice(env);
        Result lo = probe.run(List.of(office, "--version"), Map.of());
        boolean loReady = lo.failure() == null && lo.exitCode() == 0 && lo.output().contains("LibreOffice");
        checks.add(item("libreoffice", "LibreOffice", loReady, loReady ? "程序可启动；报告导出时仍需验证实际文件。" : failure(lo,
                "请安装或修复 LibreOffice，在插件设置填写 soffice 可执行文件路径，再重新检测。")));
        return response(root, checks, true);
    }
    private Map<String, Object> response(Path root, List<Map<String, String>> checks, boolean supported) {
        return Map.of("platform", os, "supported", supported, "ready", supported && checks.stream().allMatch(c -> c.get("status").equals("ready")),
                "checks", checks, "requirementsPath", root.resolve("runtime/requirements.txt").toString());
    }
    private static Map<String, String> item(String id, String label, boolean ready, String message) {
        return Map.of("id", id, "label", label, "status", ready ? "ready" : "needs_attention", "message", message);
    }
    private static String failure(Result result, String instruction) {
        return (result.failure() == null ? (result.exitCode() == 0 ? "" : "程序退出异常（" + result.exitCode() + "）。") : result.failure() + "。") + instruction;
    }
    private static String setting(Function<String, String> settings, Map<String, String> env, String key, String variable, String fallback) {
        String value = settings.apply(key);
        if (value == null || value.isBlank()) value = env.get(variable);
        return value == null || value.isBlank() ? fallback : value.trim();
    }
    // Matches runtime/render.py: PATH first, then existing macOS/Windows defaults.
    private String findOffice(Map<String, String> env) {
        boolean windows = os.toLowerCase(Locale.ROOT).startsWith("windows");
        for (String part : env.getOrDefault("PATH", env.getOrDefault("Path", "")).split(windows ? ";" : ":")) {
            if (part.isBlank()) continue;
            Path file = Path.of(part.replaceAll("^\"|\"$", ""), windows ? "soffice.exe" : "soffice");
            if (Files.isRegularFile(file) && Files.isExecutable(file)) return file.toString();
        }
        Path fallback = windows ? Path.of(env.getOrDefault("PROGRAMFILES", env.getOrDefault("ProgramFiles", "C:/Program Files")), "LibreOffice/program/soffice.exe")
                : Path.of("/Applications/LibreOffice.app/Contents/MacOS/soffice");
        return Files.isRegularFile(fallback) ? fallback.toString() : "soffice";
    }
    static Result run(List<String> command, Map<String, String> environment) {
        Process process = null;
        try {
            ProcessBuilder builder = new ProcessBuilder(command).redirectError(ProcessBuilder.Redirect.DISCARD);
            builder.environment().putAll(environment);
            process = builder.start();
            Process child = process;
            CompletableFuture<byte[]> output = new CompletableFuture<>();
            Thread.ofVirtual().start(() -> {
                try (var stream = child.getInputStream()) { output.complete(stream.readNBytes(16385)); }
                catch (IOException e) { output.completeExceptionally(e); }
            });
            if (!process.waitFor(10, TimeUnit.SECONDS)) return new Result(-1, "", "检测超时，请检查程序是否能正常启动");
            byte[] bytes = output.get(1, TimeUnit.SECONDS);
            if (bytes.length > 16384) return new Result(-1, "", "程序检测输出异常");
            return new Result(process.exitValue(), new String(bytes, StandardCharsets.UTF_8), null);
        } catch (IOException e) {
            return new Result(-1, "", "无法启动程序，请检查是否已安装、路径与执行权限");
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt(); return new Result(-1, "", "检测已中断，可重新检测");
        } catch (ExecutionException | TimeoutException e) {
            return new Result(-1, "", "无法读取程序检测结果，请重新检测");
        } finally {
            if (process != null) {
                process.descendants().forEach(ProcessHandle::destroyForcibly);
                process.destroyForcibly();
            }
        }
    }
}
