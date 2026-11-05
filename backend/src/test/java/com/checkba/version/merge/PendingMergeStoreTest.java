// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.version.merge;

import com.checkba.version.ProjectRepoService;
import com.checkba.version.VersionException;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/** 待决合并记录走「临时文件 + 原子替换」：写失败时此前的记录必须完好。 */
class PendingMergeStoreTest {

    @TempDir Path gitDir;

    private PendingMergeStore store() {
        ProjectRepoService repo = mock(ProjectRepoService.class);
        when(repo.gitDir(1L)).thenReturn(gitDir);
        return new PendingMergeStore(repo);
    }

    @Test
    void failedWriteKeepsEarlierRecords() throws Exception {
        PendingMergeStore store = store();
        store.put(1L, new MergeRecord("a.docx", "DOCX", List.of(), 1, 1));
        // 在临时文件路径上放一个目录，让下一次写入必然失败
        Files.createDirectory(gitDir.resolve(PendingMergeStore.FILE_NAME + ".tmp"));
        assertThrows(VersionException.class,
                () -> store.put(1L, new MergeRecord("b.docx", "DOCX", List.of(), 1, 1)));
        assertTrue(store.get(1L, "a.docx").isPresent());
        assertEquals(1, store.all(1L).size());
    }
}
