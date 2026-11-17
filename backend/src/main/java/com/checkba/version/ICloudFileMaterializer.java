// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.version;

import com.checkba.service.LangText;
import com.checkba.service.optimizer.ProcessRunner;

import java.nio.file.Path;
import java.util.List;
import java.util.Locale;

final class ICloudFileMaterializer {
    private static final org.slf4j.Logger log = org.slf4j.LoggerFactory.getLogger(ICloudFileMaterializer.class);
    private static final int COMMAND_TIMEOUT_SECONDS = 5;

    @FunctionalInterface
    interface CommandRunner {
        ProcessRunner.Result run(List<String> command, int timeoutSeconds);
    }

    private final boolean macOs;
    private final CommandRunner runner;

    ICloudFileMaterializer() {
        this(System.getProperty("os.name", "").toLowerCase(Locale.ROOT).contains("mac"),
                (command, timeoutSeconds) -> new ProcessRunner.Default().run(command, null, timeoutSeconds));
    }

    ICloudFileMaterializer(boolean macOs, CommandRunner runner) {
        this.macOs = macOs;
        this.runner = runner;
    }

    void requireLocalBytes(Path root) {
        if (!macOs) return;
        ProcessRunner.Result scan = runner.run(List.of(
                "/usr/bin/find", root.toString(), "-flags", "+dataless", "-print", "-quit"), COMMAND_TIMEOUT_SECONDS);
        if (scan.exitCode() != 0) {
            throw new VersionException("iCloud 文件状态检测失败: " + scan.tail(200));
        }
        if (scan.stdout().isBlank()) return;

        log.info("检测到 iCloud 占位文件，请求下载并暂缓版本暂存: root={}", root);
        ProcessRunner.Result download = runner.run(List.of(
                "/usr/bin/find", root.toString(), "-flags", "+dataless", "-exec",
                "/usr/bin/brctl", "download", "{}", "+"), COMMAND_TIMEOUT_SECONDS);
        if (download.exitCode() != 0) {
            log.warn("iCloud 占位文件下载请求未完成: root={}, detail={}", root, download.tail(200));
        }
        throw VersionException.userFacing(LangText.of(
                "部分文件尚未下载到本机，已请求 iCloud 下载；请下载完成后再试",
                "Some files are not downloaded locally. iCloud download has been requested; try again when it finishes."));
    }
}
