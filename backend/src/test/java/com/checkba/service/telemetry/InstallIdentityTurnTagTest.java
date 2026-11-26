// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.telemetry;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.*;

/** Q24：本轮计费标记稳定、32 位小写十六进制、不含原文，换轮次或换安装就不同。 */
class InstallIdentityTurnTagTest {

    @Test
    void tagIsStablePerTurnAndUnlinkableAcrossInstalls(@TempDir Path a, @TempDir Path b) {
        InstallIdentityService one = new InstallIdentityService(a.toString());
        InstallIdentityService two = new InstallIdentityService(b.toString());
        String tag = one.turnTag("conv-1", "run-1");
        assertNotNull(tag);
        assertTrue(tag.matches("^[0-9a-f]{32}$"), tag);
        assertEquals(tag, one.turnTag("conv-1", "run-1"));
        assertNotEquals(tag, one.turnTag("conv-1", "run-2"));
        assertNotEquals(tag, two.turnTag("conv-1", "run-1"));
        assertFalse(tag.contains("conv") || tag.contains("run"));
        assertNull(one.turnTag("conv-1", null));
        assertNotEquals(one.projectKey(1L), tag.substring(0, 16));
    }
}
