// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.aiworkdeck.plugins.tmeet;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.nio.file.*;
import java.util.*;

/** Resolve npm launchers without executing a shell or trusting wrapper source code. */
final class TmeetCliDiscovery {
    static final String NODE_MISSING = "已找到腾讯会议 CLI，但未找到 Node.js。请安装 Node.js 后重新检查连接；自定义安装可设置 TMEET_NODE_PATH";
    static final String PACKAGE_INVALID = "腾讯会议 CLI 安装不完整或入口无效，请重新安装 @tencentcloud/tmeet 后检查连接";
    static List<String> resolve(boolean windows, Map<String, String> env, String home) {
        try {
            List<Path> dirs = directories(windows, env, home);
            String configured = env.get("TMEET_PATH");
            if (configured != null && !configured.isBlank()) return command(Path.of(configured), windows, env, dirs);
            for (Path dir : dirs) {
                for (String name : windows ? List.of("tmeet.exe", "tmeet.cmd", "tmeet.bat") : List.of("tmeet")) {
                    Path candidate = dir.resolve(name);
                    if (Files.isRegularFile(candidate)) return command(candidate, windows, env, dirs);
                }
                Path pkg = dir.resolve("node_modules/@tencentcloud/tmeet");
                if (Files.isRegularFile(pkg.resolve("package.json"))) return script(bin(pkg), windows, env, dirs, dir);
            }
            throw new TmeetCli.Failure(TmeetCli.MISSING);
        } catch (InvalidPathException | IOException error) {
            throw new TmeetCli.Failure(PACKAGE_INVALID);
        }
    }
    private static List<Path> directories(boolean windows, Map<String, String> env, String home) {
        LinkedHashSet<Path> dirs = new LinkedHashSet<>();
        String path = env.getOrDefault("PATH", env.getOrDefault("Path", ""));
        for (String entry : path.split(windows ? ";" : ":")) {
            String trimmed = entry.trim();
            if (trimmed.startsWith("\"") && trimmed.endsWith("\"") && trimmed.length() > 1) trimmed = trimmed.substring(1, trimmed.length() - 1);
            if (!trimmed.isBlank()) dirs.add(Path.of(trimmed));
        }
        if (windows) {
            if (env.get("APPDATA") != null) dirs.add(Path.of(env.get("APPDATA"), "npm"));
            for (String name : List.of("ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"))
                if (env.get(name) != null) dirs.add(Path.of(env.get(name), "nodejs"));
        } else {
            dirs.add(Path.of(home, ".local/bin")); dirs.add(Path.of(home, ".npm-global/bin"));
            dirs.add(Path.of("/opt/homebrew/bin")); dirs.add(Path.of("/usr/local/bin")); dirs.add(Path.of("/usr/bin"));
        }
        return List.copyOf(dirs);
    }
    private static List<String> command(Path entry, boolean windows, Map<String, String> env, List<Path> dirs) throws IOException {
        if (!Files.isRegularFile(entry)) throw new TmeetCli.Failure(TmeetCli.MISSING);
        String name = entry.getFileName().toString().toLowerCase(Locale.ROOT);
        if (name.endsWith(".cmd") || name.endsWith(".bat")) {
            Path dir = entry.toAbsolutePath().getParent();
            Path pkg = dir.resolve("node_modules/@tencentcloud/tmeet");
            if (dir.getFileName().toString().equals(".bin") && dir.getParent() != null)
                pkg = dir.getParent().resolve("@tencentcloud/tmeet");
            return script(bin(pkg), windows, env, dirs, dir);
        }
        Path real = entry.toRealPath();
        String realName = real.getFileName().toString().toLowerCase(Locale.ROOT);
        boolean nodeScript = realName.endsWith(".js") || realName.endsWith(".cjs") || realName.endsWith(".mjs");
        if (!windows && !nodeScript) {
            try (var in = Files.newInputStream(real)) {
                String header = new String(in.readNBytes(160), java.nio.charset.StandardCharsets.UTF_8).split("\\R", 2)[0];
                nodeScript = header.startsWith("#!") && header.matches(".*(?:/|\\s)node(?:\\s.*)?");
            }
        }
        if (nodeScript) return script(real, windows, env, dirs, entry.toAbsolutePath().getParent());
        if (!windows && !Files.isExecutable(real)) throw new TmeetCli.Failure(TmeetCli.MISSING);
        return List.of(real.toString());
    }
    private static Path bin(Path pkg) throws IOException {
        Path manifest = pkg.resolve("package.json");
        if (!Files.isRegularFile(manifest) || Files.size(manifest) > 1024 * 1024) throw new TmeetCli.Failure(PACKAGE_INVALID);
        var root = new ObjectMapper().readTree(manifest.toFile());
        var value = root == null ? null : root.get("bin");
        if (value != null && value.isObject()) value = value.get("tmeet");
        if (value == null || !value.isTextual() || value.asText().isBlank()) throw new TmeetCli.Failure(PACKAGE_INVALID);
        Path relative = Path.of(value.asText());
        Path realPackage = pkg.toRealPath();
        Path candidate = realPackage.resolve(relative).normalize();
        if (relative.isAbsolute() || !candidate.startsWith(realPackage) || !Files.isRegularFile(candidate)) throw new TmeetCli.Failure(PACKAGE_INVALID);
        Path real = candidate.toRealPath();
        if (!real.startsWith(realPackage)) throw new TmeetCli.Failure(PACKAGE_INVALID);
        return real;
    }
    private static List<String> script(Path script, boolean windows, Map<String, String> env, List<Path> dirs, Path adjacent) {
        String configured = env.get("TMEET_NODE_PATH");
        if (configured != null && !configured.isBlank()) {
            Path node = Path.of(configured);
            if (usableNode(node, windows)) return List.of(node.toString(), script.toString());
            throw new TmeetCli.Failure(NODE_MISSING);
        }
        List<Path> candidates = new ArrayList<>(); candidates.add(adjacent); candidates.addAll(dirs);
        for (Path dir : candidates) {
            Path node = dir.resolve(windows ? "node.exe" : "node");
            if (usableNode(node, windows)) return List.of(node.toString(), script.toString());
        }
        throw new TmeetCli.Failure(NODE_MISSING);
    }
    private static boolean usableNode(Path node, boolean windows) {
        return Files.isRegularFile(node) && (windows || Files.isExecutable(node));
    }
}
