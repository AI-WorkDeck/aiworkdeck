// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.im;

import com.checkba.model.entity.*;
import com.checkba.repository.ProjectFileRepository;
import com.checkba.service.*;
import com.checkba.service.ai.memory.document.*;
import com.checkba.service.file.ProjectFileTextExtractor;
import org.junit.jupiter.api.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class ImPrivateProjectContextTest {
    ProjectMemberService members = mock(ProjectMemberService.class);
    ProjectFileAccessService access = mock(ProjectFileAccessService.class);
    ProjectProfileService profiles = mock(ProjectProfileService.class);
    ProjectFileRepository files = mock(ProjectFileRepository.class);
    ProjectFileTextExtractor extractor = mock(ProjectFileTextExtractor.class);
    MemoryDocumentService memories = mock(MemoryDocumentService.class);
    ImPrivateProjectContext context = new ImPrivateProjectContext(members, access, profiles, files, extractor, memories);
    Project project;
    @BeforeEach void setup() {
        project = new Project(); project.setId(2L); project.setName("合成案件");
        when(members.hasReadPermission(2L, 7L)).thenReturn(true);
        when(profiles.getProfile(2L)).thenReturn(List.of(Map.of("label", "客户", "fieldValue", "合成公司")));
        when(files.findByProjectIdAndIsDeletedFalseOrderBySortOrderAsc(2L)).thenReturn(List.of());
        when(memories.listSpaces(7L, 2L)).thenReturn(List.of());
    }
    ProjectFile file(long id, long pid, String name) {
        ProjectFile file = new ProjectFile(); file.setId(id); file.setProjectId(pid); file.setName(name);
        file.setIsFolder(false); file.setIsDeleted(false); file.setFileSize(100L);
        when(files.findById(id)).thenReturn(Optional.of(file)); return file;
    }
    @Test void includesActualProfileAndOnlyProjectMemory() {
        when(memories.listSpaces(7L, 2L)).thenReturn(List.of(
                new MemorySpaceView("u1", "user", "个人", true, true, true, null),
                new MemorySpaceView("p2", "project", "案件", true, true, true, null),
                new MemorySpaceView("team:x", "team", "团队", true, true, true, null)));
        when(memories.read(7L, "p2", "remember.md")).thenReturn(new MemoryFileView("remember.md", "索引", "已确认项目事项", 1L, null, true));
        String result = context.build(7L, project);
        assertTrue(result.contains("客户：合成公司")); assertTrue(result.contains("已确认项目事项"));
        verify(memories).read(7L, "p2", "remember.md");
        verify(memories, never()).read(eq(7L), eq("u1"), anyString());
        verify(memories, never()).read(eq(7L), eq("team:x"), anyString());
    }
    @Test void inaccessibleAndSiblingProjectFilesNeverEnterPromptOrExtractor() throws Exception {
        var allowed = file(1, 2, "可读合同.txt"); var denied = file(2, 2, "内部秘密.txt"); var sibling = file(3, 3, "别的项目.txt");
        when(files.findByProjectIdAndIsDeletedFalseOrderBySortOrderAsc(2L)).thenReturn(List.of(allowed, denied, sibling));
        when(access.canRead(allowed, 7L)).thenReturn(true); when(access.canRead(sibling, 7L)).thenReturn(true);
        when(extractor.extract(allowed)).thenReturn("明确合同内容");
        String result = context.build(7L, project);
        assertTrue(result.contains("明确合同内容"));
        assertFalse(result.contains("内部秘密")); assertFalse(result.contains("别的项目"));
        verify(extractor, never()).extract(denied); verify(extractor, never()).extract(sibling);
        verify(extractor, never()).extractText(any());
    }
    @Test void clientDoesNotReceiveStaffProfileOrProjectMemory() {
        when(access.isClient(2L, 7L)).thenReturn(true);
        assertFalse(context.build(7L, project).contains("合成公司"));
        verifyNoInteractions(memories, profiles);
    }
    @Test void limitedExtractionDoesNotClaimUnreadMaterialWasRead() throws Exception {
        List<ProjectFile> rows = new ArrayList<>();
        for (int i = 1; i <= 6; i++) {
            var file = file(i, 2, "材料" + i + ".txt"); rows.add(file);
            when(access.canRead(file, 7L)).thenReturn(true); when(extractor.extract(file)).thenReturn("x".repeat(7000));
        }
        when(files.findByProjectIdAndIsDeletedFalseOrderBySortOrderAsc(2L)).thenReturn(rows);
        String result = context.build(7L, project);
        verify(extractor, times(4)).extract(any());
        assertTrue(result.contains("成功读取4份材料")); assertTrue(result.contains("内容已截断"));
        assertTrue(result.contains("未列正文的文件尚未读取"));
    }
    @Test void revokedPermissionAtFinalCheckStopsDelivery() {
        when(members.hasReadPermission(2L, 7L)).thenReturn(true, false);
        assertThrows(IllegalArgumentException.class, () -> context.build(7L, project));
    }
    @Test void staffDowngradedToClientCannotSendPreviouslyReadProfileEvenWithoutFiles() {
        when(access.isClient(2L, 7L)).thenReturn(false, true);
        assertThrows(IllegalArgumentException.class, () -> context.build(7L, project));
    }
}
