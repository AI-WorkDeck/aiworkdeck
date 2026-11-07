// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.revision;

import com.checkba.model.entity.PendingRevision;
import com.checkba.model.entity.ProjectFile;
import com.checkba.repository.PendingRevisionRepository;
import com.checkba.repository.ProjectFileRepository;
import com.checkba.service.ProjectMemberService;
import com.checkba.service.ai.EditorBridgeService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

class PendingRevisionServiceTest {

    private static final long USER = 7L;
    private PendingRevisionRepository repo;
    private ProjectFileRepository files;
    private ProjectMemberService members;
    private EditorBridgeService bridge;
    private PendingRevisionService service;
    private ProjectFile file;
    private final List<PendingRevision> store = new ArrayList<>();

    @BeforeEach
    void setUp() {
        repo = mock(PendingRevisionRepository.class);
        files = mock(ProjectFileRepository.class);
        members = mock(ProjectMemberService.class);
        bridge = mock(EditorBridgeService.class);
        service = new PendingRevisionService(repo, files, members, bridge, new ObjectMapper());
        file = new ProjectFile();
        file.setId(3L);
        file.setProjectId(1L);
        file.setName("contract.docx");
        file.setFileType("docx");
        file.setIsFolder(false);
        file.setIsDeleted(false);
        file.setFileSize(100L);
        file.setUpdatedAt(LocalDateTime.of(2026, 11, 7, 10, 0));
        when(files.findById(3L)).thenReturn(Optional.of(file));
        when(members.hasWritePermission(1L, USER)).thenReturn(true);
        when(repo.save(any())).thenAnswer(i -> {
            PendingRevision r = i.getArgument(0);
            if (r.getId() == null) { r.setId(11L); store.add(r); }
            return r;
        });
        when(repo.findById(11L)).thenAnswer(i -> store.stream().findFirst());
        when(repo.findByProjectIdOrderByCreatedAtAsc(1L)).thenAnswer(i -> List.copyOf(store));
        when(bridge.executeEditorCommand(any(), any())).thenReturn("{\"success\":true}");
    }

    private PendingRevision propose() {
        return service.propose(USER, 3L, PendingRevisionService.fileVersion(file), List.of(
                new PendingRevisionService.Edit("甲方", "买方", "统一称谓"),
                new PendingRevisionService.Edit("乙方", "卖方", null)), "mcp:claude-code");
    }

    @Test
    void proposeListAcceptWithMatchingBaseSendsFindReplaceInTrackedMode() {
        PendingRevision r = propose();
        assertEquals("PENDING", r.getStatus());
        assertEquals(1, service.listByProject(USER, 1L).size());

        Map<String, Object> out = service.accept(USER, 11L, "conv-1");
        assertEquals(2, out.get("applied"));

        ArgumentCaptor<Map<String, Object>> params = ArgumentCaptor.forClass(Map.class);
        ArgumentCaptor<String> actions = ArgumentCaptor.forClass(String.class);
        verify(bridge, times(3)).executeEditorCommand(actions.capture(), params.capture());
        assertEquals(List.of("doc_open_file_sync", "find_replace", "find_replace"), actions.getAllValues());
        assertEquals(true, params.getAllValues().get(0).get("trackRevisions"));
        assertEquals("甲方", params.getAllValues().get(1).get("findText"));
        assertEquals("卖方", params.getAllValues().get(2).get("replaceText"));
        verify(repo).delete(r);
        verify(bridge).setCurrentConversationId("conv-1");
        verify(bridge).clearCurrentConversationId();
    }

    @Test
    void baseVersionMismatchMarksStaleAndDoesNotTouchEditor() {
        PendingRevision r = propose();
        file.setFileSize(101L);
        assertThrows(PendingRevisionService.StaleRevisionException.class, () -> service.accept(USER, 11L, "conv-1"));
        assertEquals("STALE", r.getStatus());
        verify(bridge, never()).executeEditorCommand(any(), any());
        verify(repo, never()).delete(any(PendingRevision.class));
    }

    @Test
    void editorFailureKeepsProposal() {
        propose();
        when(bridge.executeEditorCommand(eq("find_replace"), any())).thenReturn("{\"error\":\"x\"}");
        assertThrows(PendingRevisionService.RevisionException.class, () -> service.accept(USER, 11L, "conv-1"));
        verify(repo, never()).delete(any(PendingRevision.class));
    }

    @Test
    void rejectDeletes() {
        PendingRevision r = propose();
        service.reject(USER, 11L);
        verify(repo).delete(r);
    }

    @Test
    void nonMemberCannotProposeListAcceptOrReject() {
        PendingRevision r = propose();
        long outsider = 99L;
        assertThrows(PendingRevisionService.RevisionException.class, () -> service.propose(outsider, 3L, "v",
                List.of(new PendingRevisionService.Edit("a", "b", null)), "mcp:x"));
        assertThrows(PendingRevisionService.RevisionException.class, () -> service.listByProject(outsider, 1L));
        assertThrows(PendingRevisionService.RevisionException.class, () -> service.accept(outsider, 11L, "c"));
        assertThrows(PendingRevisionService.RevisionException.class, () -> service.reject(outsider, 11L));
        verify(bridge, never()).executeEditorCommand(any(), any());
        verify(repo, never()).delete(r);
    }

    @Test
    void validatesInputsAndWordOnly() {
        String v = PendingRevisionService.fileVersion(file);
        assertThrows(PendingRevisionService.RevisionException.class, () -> service.propose(USER, 3L, v, List.of(), "s"));
        assertThrows(PendingRevisionService.RevisionException.class, () -> service.propose(USER, 3L, v,
                List.of(new PendingRevisionService.Edit("", "b", null)), "s"));
        assertThrows(PendingRevisionService.RevisionException.class, () -> service.propose(USER, 3L, v,
                List.of(new PendingRevisionService.Edit("a".repeat(PendingRevisionService.MAX_FIND_CHARS + 1), "b", null)), "s"));
        List<PendingRevisionService.Edit> many = new ArrayList<>();
        for (int i = 0; i <= PendingRevisionService.MAX_EDITS; i++) many.add(new PendingRevisionService.Edit("a" + i, "b", null));
        assertThrows(PendingRevisionService.RevisionException.class, () -> service.propose(USER, 3L, v, many, "s"));
        file.setName("sheet.xlsx");
        assertThrows(PendingRevisionService.RevisionException.class, () -> service.propose(USER, 3L, v,
                List.of(new PendingRevisionService.Edit("a", "b", null)), "s"));
    }
}
