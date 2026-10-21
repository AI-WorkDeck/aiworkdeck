// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service;

import org.apache.pdfbox.Loader;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.TimeUnit;

/** Office PDF output must come from a layout engine, never from extracted-text reconstruction. */
@Component
public class LibreOfficePdfConverter {
    @Value("${external.libreoffice.executable:}")
    private String configuredExecutable;
    @Value("${external.libreoffice.timeout-seconds:120}")
    private long timeoutSeconds = 120;

    public enum Failure { NOT_INSTALLED, NOT_EXECUTABLE, START_FAILED, FILE_IO, TIMEOUT, EXIT_FAILED, NO_OUTPUT, INVALID_OUTPUT, INTERRUPTED }
    public static class ConversionException extends IllegalArgumentException {
        public final Failure failure;
        ConversionException(Failure failure, String detail) {
            super(detail + LangText.of(
                    "。请在内置编辑器中打开文档，从「文件 → 导出为」导出 PDF；也可安装或修复 LibreOffice 后重试。未生成有损替代文件。",
                    ". Open the document in the built-in editor and export PDF from File → Export As, or install/repair LibreOffice and retry. No lossy substitute was created."));
            this.failure = failure;
        }
    }

    public record Readiness(String status, String executable, String message) { }

    /** Read-only capability probe for component management; no document is loaded. */
    public Readiness probe() {
        List<Path> paths = candidates(System.getProperty("os.name", ""), System.getProperty("user.home", ""), System.getenv(), configuredExecutable);
        Path candidate = paths.stream().filter(Files::isRegularFile).filter(Files::isExecutable).findFirst()
                .orElseGet(() -> paths.stream().filter(Files::isRegularFile).findFirst().orElse(null));
        if (candidate == null) return new Readiness("MISSING", "", LangText.of("未找到 LibreOffice", "LibreOffice was not found"));
        if (!Files.isExecutable(candidate)) return new Readiness("NOT_EXECUTABLE", candidate.toString(), LangText.of("LibreOffice 程序不可执行", "LibreOffice is not executable"));
        Process process = null;
        try {
            process = new ProcessBuilder(candidate.toString(), "--version").redirectErrorStream(true)
                    .redirectOutput(ProcessBuilder.Redirect.DISCARD).start();
            if (!process.waitFor(5, TimeUnit.SECONDS)) return new Readiness("TIMED_OUT", candidate.toString(), LangText.of("LibreOffice 检测超时", "LibreOffice probe timed out"));
            if (process.exitValue() != 0) return new Readiness("FAILED", candidate.toString(), LangText.of("LibreOffice 未能正常启动", "LibreOffice could not start correctly"));
            return new Readiness("AVAILABLE", candidate.toString(), LangText.of("LibreOffice 可用", "LibreOffice is ready"));
        } catch (IOException e) {
            return new Readiness("FAILED", candidate.toString(), LangText.of("无法启动 LibreOffice，请检查安装和文件权限", "Could not start LibreOffice; check installation and permissions"));
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return new Readiness("FAILED", candidate.toString(), LangText.of("LibreOffice 检测已中断", "LibreOffice probe was interrupted"));
        } finally {
            if (process != null && process.isAlive()) {
                process.descendants().forEach(ProcessHandle::destroyForcibly);
                process.destroyForcibly();
            }
        }
    }

    public byte[] convert(byte[] bytes, String extension) {
        Path executable = findExecutable();
        if (executable == null) {
            boolean installed = candidates(System.getProperty("os.name", ""), System.getProperty("user.home", ""),
                    System.getenv(), configuredExecutable).stream().anyMatch(Files::isRegularFile);
            if (installed) throw failure(Failure.NOT_EXECUTABLE, "LibreOffice 程序不可执行，请检查文件权限", "LibreOffice is not executable; check file permissions");
            throw failure(Failure.NOT_INSTALLED, "未找到可用的 LibreOffice", "LibreOffice was not found");
        }
        Path work = null;
        Process process = null;
        try {
            work = Files.createTempDirectory("awd-soffice-pdf-");
            Path input = work.resolve("input." + extension);
            Files.write(input, bytes);
            ProcessBuilder builder = new ProcessBuilder(executable.toString(), "--headless", "--nologo",
                    "--nofirststartwizard", "-env:UserInstallation=" + work.resolve("profile").toUri(),
                    "--convert-to", "pdf", "--outdir", work.toString(), input.toString());
            // Drain native output without unbounded memory/disk growth or a blocked pipe.
            builder.redirectErrorStream(true).redirectOutput(ProcessBuilder.Redirect.DISCARD);
            try {
                process = builder.start();
            } catch (IOException e) {
                throw failure(Failure.START_FAILED, "无法启动 LibreOffice，请检查安装、程序路径与文件权限",
                        "Could not start LibreOffice; check installation, executable path and permissions");
            }
            if (!process.waitFor(Math.max(1, timeoutSeconds), TimeUnit.SECONDS)) {
                throw failure(Failure.TIMEOUT, "LibreOffice 转换超时", "LibreOffice conversion timed out");
            }
            if (process.exitValue() != 0) {
                throw failure(Failure.EXIT_FAILED, "LibreOffice 转换失败（退出码 " + process.exitValue() + "）",
                        "LibreOffice conversion failed (exit code " + process.exitValue() + ")");
            }
            Path output = work.resolve("input.pdf");
            if (!Files.isRegularFile(output) || Files.size(output) == 0) {
                throw failure(Failure.NO_OUTPUT, "LibreOffice 未生成 PDF", "LibreOffice did not produce a PDF");
            }
            byte[] pdf = Files.readAllBytes(output);
            try (var document = Loader.loadPDF(pdf)) {
                if (document.getNumberOfPages() < 1) throw new IOException("empty PDF");
            } catch (IOException e) {
                throw failure(Failure.INVALID_OUTPUT, "LibreOffice 生成的 PDF 无效", "LibreOffice produced an invalid PDF");
            }
            return pdf;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw failure(Failure.INTERRUPTED, "PDF 转换已中断", "PDF conversion was interrupted");
        } catch (IOException e) {
            throw failure(Failure.FILE_IO, "无法读写转换文件，请检查临时目录权限与磁盘空间",
                    "Could not read/write conversion files; check temporary directory permissions and disk space");
        } finally {
            if (process != null && process.isAlive()) {
                process.descendants().forEach(ProcessHandle::destroyForcibly);
                process.destroyForcibly();
                try { process.waitFor(5, TimeUnit.SECONDS); }
                catch (InterruptedException e) { Thread.currentThread().interrupt(); }
            }
            if (work != null) {
                try (var paths = Files.walk(work)) {
                    paths.sorted(java.util.Comparator.reverseOrder()).forEach(path -> {
                        try { Files.deleteIfExists(path); } catch (IOException ignored) { }
                    });
                } catch (IOException ignored) { }
            }
        }
    }

    private static ConversionException failure(Failure failure, String zh, String en) {
        return new ConversionException(failure, LangText.of(zh, en));
    }

    Path findExecutable() {
        return findExecutable(System.getProperty("os.name", ""), System.getProperty("user.home", ""),
                System.getenv(), configuredExecutable);
    }

    static Path findExecutable(String osName, String home, Map<String, String> env, String configured) {
        return candidates(osName, home, env, configured).stream().filter(Files::isRegularFile)
                .filter(Files::isExecutable).findFirst().orElse(null);
    }

    private static List<Path> candidates(String osName, String home, Map<String, String> env, String configured) {
        boolean windows = osName.toLowerCase(Locale.ROOT).startsWith("windows");
        String binary = windows ? "soffice.exe" : "soffice";
        List<Path> candidates = new ArrayList<>();
        String override = configured;
        if (override == null || override.isBlank()) override = env.get("LIBREOFFICE_PATH");
        if (override == null || override.isBlank()) override = env.get("SOFFICE_PATH");
        if (override != null && !override.isBlank()) {
            Path base = Path.of(override.trim());
            candidates.add(base);
            candidates.add(base.resolve("program").resolve(binary));
            candidates.add(base.resolve("Contents/MacOS/soffice"));
            candidates.add(base.resolve(binary));
        } else {
            if (windows) {
                for (String key : List.of("ProgramFiles", "ProgramW6432", "ProgramFiles(x86)", "LOCALAPPDATA")) {
                    String root = env.get(key);
                    if (root != null && !root.isBlank()) candidates.add(Path.of(root, "LibreOffice", "program", binary));
                }
            } else {
                candidates.add(Path.of("/Applications/LibreOffice.app/Contents/MacOS/soffice"));
                candidates.add(Path.of(home, "Applications/LibreOffice.app/Contents/MacOS/soffice"));
                for (String root : List.of("/opt/homebrew/bin", "/usr/local/bin", "/usr/bin")) candidates.add(Path.of(root, binary));
            }
            String path = env.getOrDefault("PATH", env.getOrDefault("Path", ""));
            for (String root : path.split(windows ? ";" : ":")) {
                // Empty PATH entries are cwd and must not discover an unrelated project executable.
                if (!root.isBlank()) candidates.add(Path.of(root.replaceAll("^\"|\"$", ""), binary));
            }
        }
        return candidates;
    }
}
