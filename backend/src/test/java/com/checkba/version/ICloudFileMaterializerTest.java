// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.version;

import org.junit.jupiter.api.Test;

import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.*;

class ICloudFileMaterializerTest {

    @Test
    void nonMacDoesNotInspectTheWorkTree() {
        AtomicInteger calls = new AtomicInteger();
        var materializer = new ICloudFileMaterializer(false, (command, timeoutSeconds) -> {
            calls.incrementAndGet();
            throw new AssertionError("unexpected command");
        });

        materializer.requireLocalBytes(Path.of("/tmp/project"));

        assertEquals(0, calls.get());
    }

    @Test
    void warmWorkTreeProceedsWithoutStartingDownloads() {
        List<List<String>> commands = new ArrayList<>();
        var materializer = new ICloudFileMaterializer(true, (command, timeoutSeconds) -> {
            commands.add(command);
            return new com.checkba.service.optimizer.ProcessRunner.Result(0, "", "");
        });

        materializer.requireLocalBytes(Path.of("/tmp/project"));

        assertEquals(1, commands.size());
        assertEquals(List.of("/usr/bin/find", "/tmp/project", "-flags", "+dataless", "-print", "-quit"), commands.get(0));
    }

    @Test
    void datalessFilesTriggerDownloadsAndRejectStagingBeforeJgitReadsThem() {
        List<List<String>> commands = new ArrayList<>();
        var materializer = new ICloudFileMaterializer(true, (command, timeoutSeconds) -> {
            commands.add(command);
            if (commands.size() == 1) {
                return new com.checkba.service.optimizer.ProcessRunner.Result(0, "/tmp/project/contract.docx\n", "");
            }
            return new com.checkba.service.optimizer.ProcessRunner.Result(0, "", "");
        });

        VersionException error = assertThrows(VersionException.class,
                () -> materializer.requireLocalBytes(Path.of("/tmp/project")));

        assertTrue(error.isUserFacing());
        assertEquals(2, commands.size());
        assertEquals(List.of("/usr/bin/find", "/tmp/project", "-flags", "+dataless", "-exec",
                "/usr/bin/brctl", "download", "{}", "+"), commands.get(1));
    }

    @Test
    void metadataFailureAlsoStopsBeforeJgit() {
        var materializer = new ICloudFileMaterializer(true, (command, timeoutSeconds) ->
                new com.checkba.service.optimizer.ProcessRunner.Result(-1, "", "timed out"));

        assertThrows(VersionException.class, () -> materializer.requireLocalBytes(Path.of("/tmp/project")));
    }
}
