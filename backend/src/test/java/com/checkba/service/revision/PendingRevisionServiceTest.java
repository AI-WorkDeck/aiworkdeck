// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.revision;

import com.checkba.model.entity.PendingRevision;
import com.checkba.model.entity.ProjectFile;
import com.checkba.repository.PendingRevisionRepository;
import com.checkba.repository.ProjectFileRepository;
import com.checkba.service.ProjectMemberService;
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
    private PendingRevisionService service;
    private ProjectFile file;
    private final List<PendingRevision> store = new ArrayList<>();

    @BeforeEach
    void setUp() {
        repo = mock(PendingRevisionRepository.class);
        files = mock(ProjectFileRepository.class);
        members = mock(ProjectMemberService.class);
        service = new PendingRevisionService(repo, files, members, new ObjectMapper());
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
    }

    private PendingRevision propose() {
        return service.propose(USER, 3L, PendingRevisionService.fileVersion(file), List.of(
                new PendingRevisionService.Edit("甲方", "买方", "统一称谓"),
                new PendingRevisionService.Edit("乙方", "卖方", null)), "mcp:claude-code");
    }

    @Test
    void acceptWithMatchingBaseReturnsEditsAndKeepsRecordUntilApplied() {
        PendingRevision r = propose();
        assertEquals(1, service.listByProject(USER, 1L).size());

        Map<String, Object> out = service.accept(USER, 11L);
        List<?> edits = (List<?>) out.get("edits");
        assertEquals(2, edits.size());
        assertEquals("甲方", ((PendingRevisionService.Edit) edits.get(0)).find());
        assertEquals("PENDING", r.getStatus());
        verify(repo, never()).delete(any(PendingRevision.class));

        service.markApplied(USER, 11L);
        verify(repo).delete(r);
    }

    @Test
    void baseVersionMismatchMarksStaleAndReturnsNoEdits() {
        PendingRevision r = propose();
        file.setFileSize(101L);
        assertThrows(PendingRevisionService.StaleRevisionException.class, () -> service.accept(USER, 11L));
        assertEquals("STALE", r.getStatus());
        verify(repo, never()).delete(any(PendingRevision.class));
        // 过期后再次接受仍拒绝，即使文件“恢复”到原版本
        file.setFileSize(100L);
        assertThrows(PendingRevisionService.StaleRevisionException.class, () -> service.accept(USER, 11L));
    }

    @Test
    void progressIsRecordedAndResumeSkipsBaseVersionCheck() {
        PendingRevision r = propose();
        service.recordProgress(USER, 11L, 1);
        service.recordProgress(USER, 11L, 0); // 只增不减
        assertEquals(1, r.getAppliedCount());
        file.setFileSize(555L); // 文档已被自己的第一条修订改过
        Map<String, Object> out = service.accept(USER, 11L);
        assertEquals(1, out.get("appliedCount"));
        assertEquals("PENDING", r.getStatus());
        assertThrows(PendingRevisionService.RevisionException.class, () -> service.recordProgress(USER, 11L, 3));
        assertThrows(PendingRevisionService.RevisionException.class, () -> service.recordProgress(99L, 11L, 1));
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
        assertThrows(PendingRevisionService.RevisionException.class, () -> service.accept(outsider, 11L));
        assertThrows(PendingRevisionService.RevisionException.class, () -> service.reject(outsider, 11L));
        assertThrows(PendingRevisionService.RevisionException.class, () -> service.markApplied(outsider, 11L));
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
