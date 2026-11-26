// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.version.cloud;

import org.junit.jupiter.api.Test;

import java.net.http.HttpRequest;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Lane C / lane Q 2026-11-26: a 30 MB part was aborted at exactly 90 s on a ~330 KB/s link, so on hotel
 * Wi-Fi, 4G tethering or a VPN a recording could never be submitted (or pulled). A part's time limit now
 * scales with its size; small JSON calls keep 90 s.
 */
class ProjectObjectPartTimeoutTest {
    private static final long MIB = 1024 * 1024;

    @Test
    void smallPartsKeepNinetySecondsAndFullPartsGetTimeForSlowLinks() {
        assertEquals(Duration.ofSeconds(90), ProjectObjectSyncService.partTimeout(0));
        assertEquals(Duration.ofSeconds(90), ProjectObjectSyncService.partTimeout(1024));
        Duration full = ProjectObjectSyncService.partTimeout(ProjectObjectTransferService.PART_BYTES);
        // 32 MiB at 32 KiB/s (~260 kbit/s) must fit; still bounded so a dead link releases the lock.
        assertTrue(full.compareTo(Duration.ofSeconds(1024)) >= 0, full.toString());
        assertTrue(full.compareTo(Duration.ofMinutes(30)) <= 0, full.toString());
        assertTrue(ProjectObjectSyncService.partTimeout(5 * MIB).compareTo(Duration.ofSeconds(90)) > 0);
        assertTrue(ProjectObjectSyncService.partTimeout(5 * MIB).compareTo(full) < 0, "monotonic in bytes");
    }

    @Test
    void partUploadRequestCarriesTheScaledTimeout() {
        long length = ProjectObjectTransferService.PART_BYTES;
        HttpRequest request = ProjectObjectSyncService.partUploadRequest("https://case.invalid/git/5.git/awd-objects/"
                        + "a".repeat(64) + "/parts/0?size=" + length, "u", "t", Map.of("X-AWD-Epoch", "1"),
                "b".repeat(64), length, HttpRequest.BodyPublishers.noBody());
        assertEquals(ProjectObjectSyncService.partTimeout(length), request.timeout().orElseThrow());
        assertEquals("PUT", request.method());
        assertEquals("1", request.headers().firstValue("X-AWD-Epoch").orElseThrow());
        assertEquals("b".repeat(64), request.headers().firstValue("X-AWD-Part-Sha256").orElseThrow());
    }

    @Test
    void partDownloadBodyUsesTheScaledDeadlineNotNinetySeconds() throws Exception {
        String source = Files.readString(Path.of("src/main/java/com/checkba/version/cloud/ProjectObjectSyncService.java"));
        assertTrue(source.contains("new DeadlineInputStream(response.body(), partTimeout(expected))"),
                "the part body deadline must scale with the part's bytes");
    }
}
