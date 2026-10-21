// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.tmeet;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * 纯文件系统夹具 + 假环境变量：不安装全局 npm 包、不触碰真实 Node 或登录凭证。
 */
class TmeetCliLocatorTest {

    @TempDir
    Path root;

    @Test
    void invalidPackageBinReturnsRepairGuidance() throws IOException {
        Path pkg = root.resolve("node_modules/@tencentcloud/tmeet");
        Files.createDirectories(pkg);
        Files.writeString(pkg.resolve("package.json"), "{\"bin\":\"bad\\u0000.js\"}");
        Path shim = root.resolve("tmeet.cmd");
        Files.writeString(shim, "");
        var error = assertThrows(TmeetCliLocator.UnresolvableException.class,
                () -> TmeetCliLocator.resolve(shim.toString(), true, key -> null, root.toString()));
        assertTrue(error.getMessage().contains("重新安装"));
    }

    private static final class FunctionRef implements java.util.function.Function<String, String> {
        final Map<String, String> env = new HashMap<>();

        @Override
        public String apply(String key) {
            return env.get(key);
        }
    }

    /** 每个测试独立环境，避免顺序耦合。 */
    private FunctionRef env() {
        return new FunctionRef();
    }

    // ==================== Windows：标准 npm 布局 ====================

    @Test
    void windowsGlobalNpmShimResolvesNodePlusJsEntry() throws IOException {
        Path npmDir = root.resolve("App Data %weird%/npm");
        Path pkg = npmDir.resolve("node_modules").resolve("@tencentcloud").resolve("tmeet");
        Path js = writePackage(pkg, "\"bin\": { \"tmeet\": \"./dist/cli & main.js\" }");
        Path node = root.resolve("Program Files & [x86]/nodejs/node.exe");
        Files.createDirectories(node.getParent());
        Files.writeString(node, "");
        Files.writeString(npmDir.resolve("tmeet.cmd"), "");

        FunctionRef e = env();
        e.env.put("APPDATA", npmDir.getParent().toString());
        e.env.put("PATH", npmDir.getParent().toString());
        e.env.put("ProgramFiles", root.resolve("Program Files & [x86]").toString());

        TmeetCliLocator.Resolution r = TmeetCliLocator.resolve("", true, e, root.toString());
        assertEquals(List.of(node.toAbsolutePath().normalize().toString(),
                js.toAbsolutePath().normalize().toString()), r.command());
        assertEquals(npmDir.resolve("tmeet.cmd").toString(), r.displayPath());
        // 绝不经 cmd.exe/bat 转发
        assertFalse(String.join(" ", r.command()).toLowerCase().contains(".cmd"));
        assertEquals(2, r.command().size());
    }

    @Test
    void windowsProjectLocalBinShimResolvesSiblingPackage() throws IOException {
        Path bin = root.resolve("proj & dir/node_modules/.bin");
        Files.createDirectories(bin);
        Files.writeString(bin.resolve("tmeet.cmd"), "");
        Path pkg = root.resolve("proj & dir/node_modules").resolve("@tencentcloud").resolve("tmeet");
        Path js = writePackage(pkg, "\"bin\": \"./dist/cli.js\"");
        Path node = bin.resolve("node.exe"); // Node 与 shim 同目录
        Files.writeString(node, "");

        TmeetCliLocator.Resolution r = TmeetCliLocator.resolve(
                bin.resolve("tmeet.cmd").toString(), true, k -> null, root.toString());
        assertEquals(List.of(node.toAbsolutePath().normalize().toString(),
                js.toAbsolutePath().normalize().toString()), r.command());
    }

    @Test
    void windowsStringBinEntryIsUsedVerbatim() throws IOException {
        Path npmDir = root.resolve("npm");
        Path pkg = npmDir.resolve("node_modules").resolve("@tencentcloud").resolve("tmeet");
        Path js = writePackage(pkg, "\"bin\": \"./bin/entry with % and &.js\"");
        Path node = npmDir.resolve("node.exe");
        Files.writeString(node, "");
        Files.writeString(npmDir.resolve("tmeet.cmd"), "");

        TmeetCliLocator.Resolution r = TmeetCliLocator.resolve(
                npmDir.resolve("tmeet.cmd").toString(), true, k -> null, root.toString());
        assertEquals(List.of(node.toAbsolutePath().normalize().toString(),
                js.toAbsolutePath().normalize().toString()), r.command());
    }

    @Test
    void configuredRealExePathIsRespectedWithoutShimResolution() throws IOException {
        Path exe = root.resolve("tools dir/real tmeet.exe");
        Files.createDirectories(exe.getParent());
        Files.writeString(exe, "");

        TmeetCliLocator.Resolution r = TmeetCliLocator.resolve(
                exe.toString(), true, k -> null, root.toString());
        assertEquals(List.of(exe.toAbsolutePath().normalize().toString()), r.command());
        assertEquals(exe.toAbsolutePath().normalize().toString(), r.displayPath());
    }

    @Test
    void configuredJsEntryFindsNodeFromEnvOverride() throws IOException {
        Path pkg = root.resolve("pkg/node_modules").resolve("@tencentcloud").resolve("tmeet");
        Path js = writePackage(pkg, "\"bin\": \"./dist/cli.js\"");
        Path node = root.resolve("custom node dir/node.exe");
        Files.createDirectories(node.getParent());
        Files.writeString(node, "");

        FunctionRef e = env();
        e.env.put("TMEET_NODE_PATH", node.toString());
        TmeetCliLocator.Resolution r = TmeetCliLocator.resolve(
                js.toString(), true, e, root.toString());
        assertEquals(List.of(node.toAbsolutePath().normalize().toString(),
                js.toAbsolutePath().normalize().toString()), r.command());
    }

    // ==================== Windows：失败路径必须可操作且拒绝执行 ====================

    @Test
    void binEntryEscapingPackageDirIsRejected() throws IOException {
        Path npmDir = root.resolve("npm");
        Path pkg = npmDir.resolve("node_modules").resolve("@tencentcloud").resolve("tmeet");
        writePackage(pkg, "\"bin\": \"../../evil.js\"");
        Files.writeString(npmDir.resolve("tmeet.cmd"), "");
        Files.writeString(npmDir.resolve("node.exe"), "");
        Files.writeString(root.resolve("evil.js"), "");

        TmeetCliLocator.UnresolvableException e = assertThrows(
                TmeetCliLocator.UnresolvableException.class,
                () -> TmeetCliLocator.resolve(npmDir.resolve("tmeet.cmd").toString(), true,
                        k -> null, root.toString()));
        assertTrue(e.getMessage().contains("越出包目录"));
    }

    @Test
    void shimWithoutAdjacentPackageFailsActionably() throws IOException {
        Path npmDir = root.resolve("npm");
        Files.createDirectories(npmDir);
        Files.writeString(npmDir.resolve("tmeet.cmd"), "");

        TmeetCliLocator.UnresolvableException e = assertThrows(
                TmeetCliLocator.UnresolvableException.class,
                () -> TmeetCliLocator.resolve(npmDir.resolve("tmeet.cmd").toString(), true,
                        k -> null, root.toString()));
        assertTrue(e.getMessage().contains("找不到 @tencentcloud/tmeet 包"));
    }

    @Test
    void missingNodeFailsActionably() throws IOException {
        Path npmDir = root.resolve("npm");
        Path pkg = npmDir.resolve("node_modules").resolve("@tencentcloud").resolve("tmeet");
        writePackage(pkg, "\"bin\": \"./dist/cli.js\"");
        Files.writeString(npmDir.resolve("tmeet.cmd"), "");

        TmeetCliLocator.UnresolvableException e = assertThrows(
                TmeetCliLocator.UnresolvableException.class,
                () -> TmeetCliLocator.resolve(npmDir.resolve("tmeet.cmd").toString(), true,
                        k -> null, root.toString()));
        assertTrue(e.getMessage().contains("node.exe"));
    }

    @Test
    void missingCliOnWindowsFailsActionably() {
        TmeetCliLocator.UnresolvableException e = assertThrows(
                TmeetCliLocator.UnresolvableException.class,
                () -> TmeetCliLocator.resolve("", true, k -> null, root.toString()));
        assertTrue(e.getMessage().contains("未找到 tmeet CLI"));
    }

    // ==================== macOS / Linux ====================

    @Test
    void unixConfiguredExecutableWins() throws IOException {
        Path exe = root.resolve("bin dir/my tmeet");
        Files.createDirectories(exe.getParent());
        Files.writeString(exe, "");
        exe.toFile().setExecutable(true);

        TmeetCliLocator.Resolution r = TmeetCliLocator.resolve(
                exe.toString(), false, k -> null, root.toString());
        assertEquals(List.of(exe.toAbsolutePath().normalize().toString()), r.command());
    }

    @Test
    void unixFallsBackToEnvThenPathThenHomeLocalBin() throws IOException {
        Path homeBin = root.resolve("home/.local/bin");
        Files.createDirectories(homeBin);
        Files.writeString(homeBin.resolve("tmeet"), "");
        homeBin.resolve("tmeet").toFile().setExecutable(true);

        FunctionRef e = env();
        // PATH 里找不到 → home/.local/bin
        e.env.put("PATH", root.resolve("no such dir").toString());
        TmeetCliLocator.Resolution r = TmeetCliLocator.resolve("", false, e, root.resolve("home").toString());
        assertEquals(homeBin.resolve("tmeet").toAbsolutePath().toString(), r.command().get(0));

        // TMEET_PATH 优先于以上
        Path envExe = root.resolve("env dir/tmeet");
        Files.createDirectories(envExe.getParent());
        Files.writeString(envExe, "");
        envExe.toFile().setExecutable(true);
        e.env.put("TMEET_PATH", envExe.toString());
        r = TmeetCliLocator.resolve("", false, e, root.resolve("home").toString());
        assertEquals(envExe.toAbsolutePath().normalize().toString(), r.command().get(0));

        // PATH 目录命中优先于 home/.local/bin
        Path pathDir = root.resolve("path dir with % and spaces");
        Files.createDirectories(pathDir);
        Files.writeString(pathDir.resolve("tmeet"), "");
        pathDir.resolve("tmeet").toFile().setExecutable(true);
        e.env.put("PATH", pathDir.toString());
        e.env.remove("TMEET_PATH");
        r = TmeetCliLocator.resolve("", false, e, root.resolve("home").toString());
        assertEquals(pathDir.resolve("tmeet").toAbsolutePath().normalize().toString(), r.command().get(0));
    }

    @Test
    void unixFallbackKeepsBareTmeetCommand() {
        TmeetCliLocator.Resolution r = TmeetCliLocator.resolve("", false, k -> null, root.toString());
        assertEquals(List.of("tmeet"), r.command());
    }

    @Test
    void windowsPathUsesSemicolonsAndFindsNativeExecutable() throws Exception {
        Path dir = Files.createDirectories(root.resolve("second dir"));
        Path exe = Files.writeString(dir.resolve("tmeet.exe"), "synthetic");
        var result = TmeetCliLocator.resolve("", true, key -> "Path".equals(key)
                ? root.resolve("missing") + ";\"" + dir + "\"" : null, root.toString());
        assertEquals(List.of(exe.toString()), result.command());
    }

    @Test
    void binParsingUsesTheBinObjectAndRejectsSymlinkEscape() throws Exception {
        Path npm = Files.createDirectories(root.resolve("npm"));
        Path pkg = npm.resolve("node_modules/@tencentcloud/tmeet");
        Files.createDirectories(pkg);
        Files.writeString(npm.resolve("tmeet.cmd"), "");
        Files.writeString(npm.resolve("node.exe"), "");
        Files.writeString(pkg.resolve("package.json"), "{\"description\":\"tmeet\",\"other\":{\"tmeet\":\"wrong.js\"},\"bin\":{\"tmeet\":\"real.js\"}}");
        Path real = Files.writeString(pkg.resolve("real.js"), "");
        assertEquals(real.toString(), TmeetCliLocator.resolve(npm.resolve("tmeet.cmd").toString(), true, key -> null, root.toString()).command().get(1));
        Files.delete(real);
        Files.createSymbolicLink(real, Files.writeString(root.resolve("outside.js"), ""));
        assertThrows(TmeetCliLocator.UnresolvableException.class, () -> TmeetCliLocator.resolve(npm.resolve("tmeet.cmd").toString(), true, key -> null, root.toString()));
    }

    // ==================== 夹具 ====================

    private Path writePackage(Path pkg, String binJson) throws IOException {
        Files.createDirectories(pkg);
        Files.writeString(pkg.resolve("package.json"),
                "{ \"name\": \"@tencentcloud/tmeet\", " + binJson + " }");
        String rel = extractEntry(binJson);
        Path js = pkg.resolve(rel).normalize();
        Files.createDirectories(js.getParent() == null ? pkg : js.getParent());
        Files.writeString(js, "");
        return js;
    }

    private static String extractEntry(String binJson) {
        if (binJson.contains("{")) {
            java.util.regex.Matcher m = java.util.regex.Pattern
                    .compile(":\\s*\"([^\"]*)\"").matcher(binJson.split("\\{", 2)[1]);
            return m.find() ? m.group(1) : null;
        }
        java.util.regex.Matcher m = java.util.regex.Pattern
                .compile("\"([^\"]*)\"").matcher(binJson.split(":", 2)[1]);
        return m.find() ? m.group(1) : null;
    }
}
