// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.aiworkdeck.plugins.tmeet;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import java.nio.file.*;
import java.time.Duration;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class TmeetCliDiscoveryTest {
    @TempDir Path root;
    Path file(Path path, String content) throws Exception {
        Files.createDirectories(path.getParent()); Files.writeString(path, content); return path;
    }
    Path pkg(Path prefix, String bin) throws Exception {
        Path pkg = prefix.resolve("node_modules/@tencentcloud/tmeet");
        file(pkg.resolve("package.json"), "{\"description\":\"unrelated scripts/tmeet.js\",\"bin\":" + bin + "}");
        return pkg;
    }
    List<String> resolve(boolean windows, Map<String, String> env) { return TmeetCliDiscovery.resolve(windows, env, root.resolve("home").toString()); }
    @Test void windowsCustomPathNpmPrefixReadsActualBinWithoutRunningCmd() throws Exception {
        Path prefix = root.resolve("custom prefix & tools");
        file(prefix.resolve("tmeet.cmd"), "must never run");
        Path pkg = pkg(prefix, "{\"tmeet\":\"dist/cli.cjs\"}");
        Path script = file(pkg.resolve("dist/cli.cjs"), "synthetic");
        Path node = file(prefix.resolve("node.exe"), "synthetic");
        assertEquals(List.of(node.toString(), script.toRealPath().toString()), resolve(true, Map.of("Path", "\"" + prefix + "\"")));
    }
    @Test void windowsAppDataAndProgramFilesAreDetected() throws Exception {
        Path appData = root.resolve("AppData/Roaming");
        Path prefix = appData.resolve("npm");
        Path pkg = pkg(prefix, "\"bin/entry.mjs\"");
        Path script = file(pkg.resolve("bin/entry.mjs"), "synthetic");
        Path programFiles = root.resolve("Program Files");
        Path node = file(programFiles.resolve("nodejs/node.exe"), "synthetic");
        assertEquals(List.of(node.toString(), script.toRealPath().toString()), resolve(true, Map.of("APPDATA", appData.toString(), "ProgramFiles", programFiles.toString())));
    }
    @Test void windowsProjectBinAndExplicitNodePathAreSupported() throws Exception {
        Path prefix = root.resolve("project");
        Path shim = file(prefix.resolve("node_modules/.bin/tmeet.cmd"), "not executed");
        Path pkg = pkg(prefix, "\"entry.js\"");
        Path script = file(pkg.resolve("entry.js"), "synthetic");
        Path node = file(root.resolve("node custom.exe"), "synthetic");
        assertEquals(List.of(node.toString(), script.toRealPath().toString()), resolve(true, Map.of("TMEET_PATH", shim.toString(), "TMEET_NODE_PATH", node.toString())));
    }
    @Test void windowsNativeExeDoesNotRequireNode() throws Exception {
        Path exe = file(root.resolve("tmeet.exe"), "synthetic");
        assertEquals(List.of(exe.toRealPath().toString()), resolve(true, Map.of("PATH", root.toString())));
    }
    @Test void missingNodeHasActionableDistinctMessage() throws Exception {
        Path pkg = pkg(root, "\"entry.js\""); file(pkg.resolve("entry.js"), "synthetic");
        var error = assertThrows(TmeetCli.Failure.class, () -> resolve(true, Map.of("PATH", root.toString())));
        assertEquals(TmeetCliDiscovery.NODE_MISSING, error.getMessage());
    }
    @Test void invalidAndEscapingBinNeverRunsArbitraryFile() throws Exception {
        Path shim = file(root.resolve("tmeet.cmd"), "not executed");
        Path pkg = pkg(root, "\"../../outside.js\"");
        file(root.resolve("outside.js"), "synthetic");
        Map<String, String> env = Map.of("TMEET_PATH", shim.toString());
        assertEquals(TmeetCliDiscovery.PACKAGE_INVALID, assertThrows(TmeetCli.Failure.class, () -> resolve(true, env)).getMessage());
        for (String content : List.of("", "{", "null", "{\"bin\":4}", "{\"bin\":\"\\u0000\"}")) {
            Files.writeString(pkg.resolve("package.json"), content);
            assertEquals(TmeetCliDiscovery.PACKAGE_INVALID, assertThrows(TmeetCli.Failure.class, () -> resolve(true, env)).getMessage());
        }
    }
    @org.junit.jupiter.api.condition.DisabledOnOs(org.junit.jupiter.api.condition.OS.WINDOWS)
    @Test void symlinkCannotEscapePackageButUnixNpmSymlinkUsesNodeDirectly() throws Exception {
        Path pkg = pkg(root, "\"entry.js\"");
        Path outside = file(root.resolve("outside.js"), "synthetic");
        Files.createSymbolicLink(pkg.resolve("entry.js"), outside);
        file(root.resolve("tmeet.cmd"), "never run");
        assertThrows(TmeetCli.Failure.class, () -> resolve(true, Map.of("PATH", root.toString())));
        Path realScript = file(pkg.resolve("actual.cjs"), "synthetic");
        Path bin = root.resolve("home/.local/bin"); Files.createDirectories(bin);
        Files.createSymbolicLink(bin.resolve("tmeet"), realScript);
        Path node = file(bin.resolve("node"), "synthetic"); assertTrue(node.toFile().setExecutable(true));
        assertEquals(List.of(node.toString(), realScript.toRealPath().toString()), resolve(false, Map.of()));
    }
    @org.junit.jupiter.api.condition.DisabledOnOs(org.junit.jupiter.api.condition.OS.WINDOWS)
    @Test void sameRunnerRecoversAfterInstallationAndKeepsArgumentBoundaries() throws Exception {
        Map<String, String> env = Map.of("TMEET_PATH", root.resolve("tmeet").toString());
        var runner = new TmeetCli.NativeRunner(() -> resolve(false, env));
        assertThrows(TmeetCli.Failure.class, () -> runner.run(List.of("--version"), Duration.ofSeconds(1)));
        Path executable = file(root.resolve("tmeet"), "#!/bin/sh\nprintf '%s\\n' \"$#\" \"$1\"\n");
        assertTrue(executable.toFile().setExecutable(true));
        assertEquals("1\na b & % literal\n", runner.run(List.of("a b & % literal"), Duration.ofSeconds(1)).output());
    }
    @org.junit.jupiter.api.condition.DisabledOnOs(org.junit.jupiter.api.condition.OS.WINDOWS)
    @Test void versionProbeTimeoutCleansUpChildProcess() throws Exception {
        Path pid = root.resolve("child.pid");
        Path executable = file(root.resolve("probe"), "#!/bin/sh\nsleep 30 &\necho $! > \"$1\"\nwait\n");
        assertTrue(executable.toFile().setExecutable(true));
        var runner = new TmeetCli.NativeRunner(executable.toString());
        assertThrows(TmeetCli.Failure.class, () -> runner.run(List.of(pid.toString()), Duration.ofSeconds(3)));
        long child = Long.parseLong(Files.readString(pid).strip());
        for (int i = 0; i < 30 && ProcessHandle.of(child).map(ProcessHandle::isAlive).orElse(false); i++) Thread.sleep(20);
        assertFalse(ProcessHandle.of(child).map(ProcessHandle::isAlive).orElse(false));
    }
}
