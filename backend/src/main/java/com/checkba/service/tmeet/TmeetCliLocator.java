// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.tmeet;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.function.Function;
import com.fasterxml.jackson.databind.ObjectMapper;

/**
 * tmeet CLI 跨平台发现与命令前缀解析。
 *
 * macOS/Linux：tmeet 是可直接执行文件（配置 TMEET_PATH、PATH、~/.local/bin、
 * /opt/homebrew/bin、/usr/local/bin），命令前缀就是该文件的绝对路径。
 *
 * Windows：npm 全局/项目安装的是 tmeet.cmd shim，绝不能把动态参数交给
 * cmd.exe/.bat/.cmd 转发。定位 shim 相邻的
 * node_modules/@tencentcloud/tmeet/package.json 的 bin 入口，校验 JS 仍在包目录内
 * （防 "../" 逃逸），然后用 node.exe + 绝对 JS 路径组成 ProcessBuilder 参数列表。
 */
final class TmeetCliLocator {

    private static final String PKG_SCOPE_DIR = "@tencentcloud";
    private static final String PKG_NAME = "tmeet";

    private final boolean windows;
    private final Function<String, String> env;
    private final String userHome;

    private TmeetCliLocator(boolean windows, Function<String, String> env, String userHome) {
        this.windows = windows;
        this.env = env;
        this.userHome = userHome;
    }

    /** 解析结果：command 为完整命令前缀（可直接后接子命令参数），displayPath 供 UI 展示。 */
    record Resolution(List<String> command, String displayPath) {}

    /** 无法定位或定位到不可安全执行的入口（路径逃逸、缺 Node 等），message 给出可操作的指引。 */
    static class UnresolvableException extends RuntimeException {
        UnresolvableException(String message) {
            super(message);
        }
    }

    static Resolution resolve(String configuredCliPath, boolean windows,
                              Function<String, String> env, String userHome) {
        return new TmeetCliLocator(windows, env, userHome).resolve(configuredCliPath);
    }

    private Resolution resolve(String configuredCliPath) {
        String configured = configuredCliPath == null ? "" : configuredCliPath.trim();
        String envCli = value("TMEET_PATH");
        if (windows) {
            return resolveWindows(configured, envCli);
        }
        return resolveUnix(configured, envCli);
    }

    // ==================== macOS / Linux ====================

    private Resolution resolveUnix(String configured, String envCli) {
        if (!configured.isEmpty()) {
            Path p = Path.of(configured);
            if (isExecutableFile(p)) {
                return new Resolution(List.of(p.toAbsolutePath().normalize().toString()),
                        p.toAbsolutePath().normalize().toString());
            }
        }
        if (envCli != null && !envCli.isBlank()) {
            Path p = Path.of(envCli.trim());
            if (isExecutableFile(p)) {
                return new Resolution(List.of(p.toAbsolutePath().normalize().toString()),
                        p.toAbsolutePath().normalize().toString());
            }
        }
        for (String dir : pathDirs()) {
            Path p = Path.of(dir, "tmeet");
            if (isExecutableFile(p)) {
                return new Resolution(List.of(p.toAbsolutePath().normalize().toString()),
                        p.toAbsolutePath().normalize().toString());
            }
        }
        List<Path> common = List.of(
                Path.of(userHome, ".local", "bin", "tmeet"),
                Path.of("/opt/homebrew/bin/tmeet"),
                Path.of("/usr/local/bin/tmeet"));
        for (Path p : common) {
            if (isExecutableFile(p)) {
                return new Resolution(List.of(p.toAbsolutePath().toString()), p.toAbsolutePath().toString());
            }
        }
        // 兜底交给运行时 PATH（保持旧 resolveCliPath 行为：不因未安装而抛错）
        return new Resolution(List.of("tmeet"), "tmeet");
    }

    // ==================== Windows ====================

    private Resolution resolveWindows(String configured, String envCli) {
        Path direct = firstRegularFile(configured, envCli);
        if (direct != null) {
            String name = direct.getFileName().toString().toLowerCase();
            if (name.endsWith(".js") || name.endsWith(".cjs") || name.endsWith(".mjs")) {
                // 配置直指包内 JS 入口：仍需 Node 才能执行
                return new Resolution(List.of(findNodeExe(null).toString(),
                        direct.toAbsolutePath().normalize().toString()),
                        direct.toAbsolutePath().normalize().toString());
            }
            if (name.endsWith(".cmd") || name.endsWith(".bat")) {
                return fromShim(direct);
            }
            // 配置直指真实可执行文件（非 shim）：尊重配置
            return new Resolution(List.of(direct.toAbsolutePath().normalize().toString()),
                    direct.toAbsolutePath().normalize().toString());
        }

        // 无显式配置：PATH 与 npm 全局目录里找 tmeet.cmd
        for (String dir : windowsCandidateDirs()) {
            Path exe = Path.of(dir, "tmeet.exe");
            if (Files.isRegularFile(exe)) return new Resolution(List.of(exe.toAbsolutePath().toString()), exe.toAbsolutePath().toString());
            Path shim = Path.of(dir, "tmeet.cmd");
            if (Files.isRegularFile(shim)) {
                return fromShim(shim);
            }
        }
        throw new UnresolvableException(
                "未找到 tmeet CLI（Windows 下需 npm 安装 @tencentcloud/tmeet，"
                        + "或通过 tmeet.cli.path / TMEET_PATH 指定 tmeet.cmd 或包内 JS 入口）");
    }

    private Resolution fromShim(Path shim) {
        Path pkg = findPackageDir(shim);
        if (pkg == null) {
            throw new UnresolvableException(
                    "tmeet shim 旁边找不到 @tencentcloud/tmeet 包（" + shim + "），"
                            + "请重装 npm 包或在 tmeet.cli.path 里直接配置包内 JS 入口");
        }
        Path js = resolveBinEntry(pkg);
        Path node = findNodeExe(shim.getParent());
        return new Resolution(List.of(node.toString(), js.toString()), shim.toString());
    }

    private Path findPackageDir(Path shim) {
        Path shimDir = shim.toAbsolutePath().normalize().getParent();
        if (shimDir == null) return null;
        // npm 全局：<prefix>\tmeet.cmd 与 <prefix>\node_modules\@tencentcloud\tmeet 并排
        // 项目安装：<root>\node_modules\.bin\tmeet.cmd → 包在 <root>\node_modules\@tencentcloud\tmeet
        List<Path> candidates = new ArrayList<>();
        candidates.add(shimDir.resolve("node_modules").resolve(PKG_SCOPE_DIR).resolve(PKG_NAME));
        if (shimDir.getParent() != null) {
            candidates.add(shimDir.getParent().resolve(PKG_SCOPE_DIR).resolve(PKG_NAME));
        }
        for (Path c : candidates) {
            if (Files.isRegularFile(c.resolve("package.json"))) {
                return c.normalize();
            }
        }
        return null;
    }

    private Path resolveBinEntry(Path pkg) {
        Path manifest = pkg.resolve("package.json");
        String binValue = readBinValue(manifest);
        if (binValue == null || binValue.isBlank()) {
            throw new UnresolvableException("tmeet 包 package.json 缺少 bin 入口: " + manifest);
        }
        Path js = pkg.resolve(binValue).normalize();
        if (!js.startsWith(pkg) || !Files.isRegularFile(js)) {
            throw new UnresolvableException(
                    "tmeet bin 入口越出包目录或不存在（" + binValue + "），拒绝执行: " + js);
        }
        try {
            if (!js.toRealPath().startsWith(pkg.toRealPath())) {
                throw new UnresolvableException("tmeet 入口链接指向包目录外，请重新安装腾讯会议 CLI");
            }
            return js.toAbsolutePath();
        } catch (IOException e) {
            throw new UnresolvableException("tmeet 入口无法读取，请重新安装腾讯会议 CLI");
        }
    }

    private String readBinValue(Path manifest) {
        try {
            var pkg = new ObjectMapper().readTree(Files.readString(manifest));
            var bin = pkg.path("bin");
            var entry = bin.isTextual() ? bin : bin.path("tmeet");
            return entry.isTextual() ? entry.asText() : null;
        } catch (IOException e) {
            throw new UnresolvableException("无法读取 tmeet 安装清单，请修复或重新安装腾讯会议 CLI");
        }
    }

    private Path findNodeExe(Path shimDir) {
        String configured = value("TMEET_NODE_PATH");
        if (configured != null && !configured.isBlank()) {
            Path p = Path.of(configured.trim());
            if (Files.isRegularFile(p)) return p.toAbsolutePath().normalize();
        }
        if (shimDir != null) {
            Path alongside = shimDir.resolve("node.exe");
            if (Files.isRegularFile(alongside)) return alongside.toAbsolutePath().normalize();
        }
        for (String dir : pathDirs()) {
            Path p = Path.of(dir, "node.exe");
            if (Files.isRegularFile(p)) return p.toAbsolutePath().normalize();
        }
        for (String programFiles : new String[]{value("ProgramFiles"), value("ProgramFiles(x86)")}) {
            if (programFiles != null && !programFiles.isBlank()) {
                Path p = Path.of(programFiles, "nodejs", "node.exe");
                if (Files.isRegularFile(p)) return p.toAbsolutePath().normalize();
            }
        }
        throw new UnresolvableException(
                "未找到 node.exe（请安装 Node.js，或用 TMEET_NODE_PATH 指定 node.exe 路径）");
    }

    // ==================== 通用 ====================

    private List<String> pathDirs() {
        String path = value("PATH");
        if (path == null && windows) path = value("Path");
        if (path == null || path.isBlank()) return List.of();
        List<String> dirs = new ArrayList<>();
        for (String dir : path.split(windows ? ";" : ":")) {
            if (!dir.isBlank()) dirs.add(dir.replaceAll("^\"|\"$", ""));
        }
        return dirs;
    }

    private List<String> windowsCandidateDirs() {
        List<String> dirs = new ArrayList<>(pathDirs());
        String appData = value("APPDATA");
        if (appData != null && !appData.isBlank()) {
            dirs.add(Path.of(appData, "npm").toString());
        }
        return dirs;
    }

    private Path firstRegularFile(String... candidates) {
        for (String c : candidates) {
            if (c != null && !c.isBlank() && Files.isRegularFile(Path.of(c.trim()))) {
                return Path.of(c.trim());
            }
        }
        return null;
    }

    private boolean isExecutableFile(Path p) {
        return Files.isRegularFile(p) && Files.isExecutable(p);
    }

    private String value(String key) {
        String v = env.apply(key);
        return v == null || v.isBlank() ? null : v;
    }
}
