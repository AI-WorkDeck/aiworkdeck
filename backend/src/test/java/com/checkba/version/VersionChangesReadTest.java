// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.version;

import com.checkba.service.ProjectMemberService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class VersionChangesReadTest {
    final ProjectRepoService repos = mock(ProjectRepoService.class);
    final WorkSessionService sessions = mock(WorkSessionService.class);
    final ProjectMemberService members = mock(ProjectMemberService.class);
    final VersionController controller = new VersionController(repos, sessions, members, null, null, null, null);
    @BeforeEach void setup() {
        when(members.hasReadPermission(1L, 7L)).thenReturn(true);
        when(repos.isInitialized(1L)).thenReturn(true);
    }
    @SuppressWarnings("unchecked") Map<String,Object> changes(String from, String to) {
        return (Map<String,Object>)controller.changesForUser(1L, from, to, 7L).getBody().get("data");
    }
    @Test void workingPathsAreFilteredAndCappedWithHonestTotal() {
        List<FileChange> paths = new ArrayList<>();
        paths.add(new FileChange(".awd/tree.json", FileChange.Type.MODIFY));
        for(int i=0; i<503; i++) paths.add(new FileChange("file-" + i + ".txt", FileChange.Type.MODIFY));
        when(sessions.pendingChangesLocked(1L)).thenReturn(paths);
        Map<String,Object> result = changes(null, null);
        assertEquals("working", result.get("scope")); assertEquals(503, result.get("total"));
        assertEquals(true, result.get("truncated")); assertEquals(false, result.get("includesUnsavedEditorBuffers"));
        List<?> visible = (List<?>) result.get("changes");
        assertEquals(500, visible.size()); assertFalse(visible.toString().contains(".awd/"));
        verify(sessions).pendingChangesLocked(1L); verifyNoMoreInteractions(sessions);
        verify(members, never()).hasWritePermission(anyLong(), anyLong());
    }
    @Test void oneCommitAndTwoVersionsUseExistingDiffSemantics() {
        String a="a".repeat(40), b="b".repeat(40);
        when(repos.commitExists(1L, a)).thenReturn(true); when(repos.commitExists(1L, b)).thenReturn(true);
        List<FileChange> paths = List.of(new FileChange("add.txt", FileChange.Type.ADD), new FileChange("gone.txt", FileChange.Type.DELETE));
        when(repos.diffNameStatus(1L, b+"^", b)).thenReturn(paths);
        when(repos.diffNameStatus(1L, a, b)).thenReturn(paths);
        assertEquals(paths, changes(null,b).get("changes")); assertEquals("commit", changes(null,b).get("scope"));
        Map<String,Object> comparison=changes(a,b);
        assertEquals("compare", comparison.get("scope")); assertEquals(a, comparison.get("from")); assertEquals(b, comparison.get("to"));
        assertEquals(paths, comparison.get("changes")); assertEquals(false, comparison.get("truncated"));
        verifyNoInteractions(sessions);
    }
    @Test void disabledMissingVersionAndDeniedActorsAreNotEmptySuccesses() {
        assertThrows(VersionException.class, () -> changes(null,"a".repeat(40)));
        when(repos.isInitialized(1L)).thenReturn(false);
        Map<String,Object> result=changes(null,null);
        assertEquals(false,result.get("enabled")); assertEquals(0,result.get("total")); verifyNoInteractions(sessions);
        when(members.hasReadPermission(1L,7L)).thenReturn(false);
        assertThrows(IllegalArgumentException.class, () -> changes(null,null));
        when(members.hasReadPermission(1L,7L)).thenReturn(true); when(members.isClient(1L,7L)).thenReturn(true);
        assertThrows(IllegalArgumentException.class, () -> changes(null,null));
    }
}
