// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.version;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

/** C12b retest: a refusal shown as 「只读成员」 must leave its real cause in the log. */
class CloudSyncRefusalReasonTest {
    @Test
    void reasonListsTheWholeCauseChain() {
        var root = new org.eclipse.jgit.errors.TransportException("https://case.example/git/p1.git: git-receive-pack not permitted");
        var e = new VersionException("上传到云端失败: project=1", new org.eclipse.jgit.api.errors.TransportException(root.getMessage(), root));
        String reason = CloudSyncService.refusalReason(e);
        assertTrue(CloudSyncService.isAccessRefused(e));
        assertTrue(reason.startsWith("VersionException: 上传到云端失败"), reason);
        assertTrue(reason.contains("git-receive-pack not permitted"), reason);
        assertEquals(3, reason.split(" <- ").length, reason);
    }
}
