// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.im;

import com.checkba.model.entity.*;
import com.checkba.repository.*;
import com.checkba.service.*;
import com.checkba.service.file.ProjectFileTextExtractor;
import org.junit.jupiter.api.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class ImSharedProjectContextTest {
    ProjectRepository projects = mock(ProjectRepository.class);
    ProjectFileRepository files = mock(ProjectFileRepository.class);
    ProjectMemberService members = mock(ProjectMemberService.class);
    ProjectFileAccessService access = mock(ProjectFileAccessService.class);
    ProjectFileTextExtractor extractor = mock(ProjectFileTextExtractor.class);
    ImSharedProjectContext context = new ImSharedProjectContext(projects, files, members, access, extractor);
    @BeforeEach void setup() {
        Project project = new Project(); project.setId(2L); project.setName("合成项目");
        when(projects.findById(2L)).thenReturn(Optional.of(project));
        when(members.hasReadPermission(eq(2L), anyLong())).thenReturn(true);
    }
    ProjectFile file(long id, long projectId, boolean visible) {
        ProjectFile file = new ProjectFile(); file.setId(id); file.setProjectId(projectId); file.setName("材料" + id + ".txt");
        file.setIsFolder(false); file.setIsDeleted(false); file.setClientVisible(visible); file.setFileSize(100L);
        when(files.findById(id)).thenReturn(Optional.of(file)); when(access.canRead(eq(file), anyLong())).thenReturn(true);
        return file;
    }
    @Test void onlyPublicFilesReadableByEntireAudienceEnterPrompt() throws Exception {
        var shared = file(1, 2, true); var internal = file(2, 2, false); var denied = file(3, 2, true); var other = file(4, 9, true);
        when(files.findByProjectIdAndIsDeletedFalseOrderBySortOrderAsc(2L)).thenReturn(List.of(internal, shared, denied, other));
        when(access.canRead(denied, 8L)).thenReturn(false);
        when(extractor.extract(shared)).thenReturn("起诉状记载：李某为原告。");
        var prepared = context.prepare(2L, List.of(7L, 8L), "");
        assertTrue(prepared.text().contains("李某为原告")); assertEquals(List.of(1L), prepared.fileIds());
        verify(extractor, never()).extract(internal); verify(extractor, never()).extract(denied); verify(extractor, never()).extract(other);
        assertFalse(prepared.text().contains("材料2")); assertFalse(prepared.text().contains("材料3"));
    }
    @Test void internalFilesStayOutEvenInSingleMemberGroup() {
        var internal = file(1, 2, false);
        when(files.findByProjectIdAndIsDeletedFalseOrderBySortOrderAsc(2L)).thenReturn(List.of(internal));
        assertTrue(context.prepare(2L, List.of(7L), "").fileIds().isEmpty()); verifyNoInteractions(extractor);
    }
    @Test void revokingVisibilityOrMembershipBeforeDeliveryRejectsContext() throws Exception {
        var shared = file(1, 2, true); when(files.findByProjectIdAndIsDeletedFalseOrderBySortOrderAsc(2L)).thenReturn(List.of(shared));
        when(extractor.extract(shared)).thenReturn("共同材料");
        var prepared = context.prepare(2L, List.of(7L, 8L), ""); shared.setClientVisible(false);
        assertThrows(IllegalArgumentException.class, () -> context.recheck(prepared));
        shared.setClientVisible(true); when(members.hasReadPermission(2L, 8L)).thenReturn(false);
        assertThrows(IllegalArgumentException.class, () -> context.recheck(prepared));
    }
    @Test void namedMaterialBeyondFirstFourIsPrioritizedAndUnreadDirectoryIsExplicit() throws Exception {
        List<ProjectFile> documents = new ArrayList<>();
        for (int i = 1; i <= 7; i++) documents.add(file(i, 2, true));
        ProjectFile target = documents.get(6); target.setName("1_李时俊民事起诉状.docx");
        when(files.findByProjectIdAndIsDeletedFalseOrderBySortOrderAsc(2L)).thenReturn(documents);
        when(extractor.extract(target)).thenReturn("李时俊是原告。");
        var prepared = context.prepare(2L, List.of(7L), "这份起诉状的原告是谁？");
        assertTrue(prepared.text().contains("李时俊是原告"));
        assertTrue(prepared.text().contains("材料6.txt"));
        assertTrue(prepared.text().contains("目录不代表已读取正文"));
        verify(extractor, times(4)).extract(any()); verify(extractor).extract(target);
        verify(extractor, never()).extract(documents.get(5));
    }
    @Test void unboundLocalGroupDoesNotGainCloudProjectAccess() {
        assertEquals("", context.prepare(null, List.of(7L), "").text()); verifyNoInteractions(projects, files, extractor);
    }
    @Test void localizedLabelsPreserveSourceTextAndPermissionErrorsUseRequestLanguage() throws Exception {
        var file = file(1, 2, true);
        when(files.findByProjectIdAndIsDeletedFalseOrderBySortOrderAsc(2L)).thenReturn(List.of(file));
        when(extractor.extract(file)).thenReturn("客户原文保持不变".repeat(1000));
        String english = AppLanguageScope.call("en-US", () -> context.prepare(2L, List.of(7L), "").text());
        assertTrue(english.contains("Current cloud project: 合成项目"));
        assertTrue(english.contains("Readable file directory")); assertTrue(english.contains("[Text truncated]"));
        assertTrue(english.contains("客户原文保持不变")); assertFalse(english.contains("当前云端项目"));
        String traditional = AppLanguageScope.call("zh-TW", () -> context.prepare(2L, List.of(7L), "").text());
        assertTrue(traditional.contains("雲端項目")); assertTrue(traditional.contains("客户原文保持不变"));
        when(members.hasReadPermission(2L, 7L)).thenReturn(false);
        var error = assertThrows(IllegalArgumentException.class, () -> AppLanguageScope.call("en-US", () -> context.prepare(2L, List.of(7L), "")));
        assertEquals("Project audience access changed", error.getMessage());
        assertNull(AppLanguageScope.current());
    }

}
