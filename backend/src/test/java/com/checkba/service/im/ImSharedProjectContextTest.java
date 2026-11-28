// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.im;

import com.checkba.model.entity.*;
import com.checkba.repository.*;
import com.checkba.service.*;
import com.checkba.service.file.ProjectFileTextExtractor;
import com.checkba.version.cloud.ProjectObjectSyncService;
import org.junit.jupiter.api.*;
import org.springframework.test.util.ReflectionTestUtils;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * C15 (dev-board#1874, spec readiness/specs/C15-group-assistant-files.md, CEO 11-28): the project group assistant
 * reads the case files that EVERY reader in the group may read (lowest common visibility), built on the server.
 * A lawyers-only group sees internal files and the profile; with a client in the group only what that client may
 * read, and no profile. Local-only files are listed, never read. Clients added later never see earlier replies
 * (ImService.limitClientHistory), so this does not leak to "future clients".
 */
class ImSharedProjectContextTest {
    ProjectRepository projects = mock(ProjectRepository.class);
    ProjectFileRepository files = mock(ProjectFileRepository.class);
    ProjectMemberService members = mock(ProjectMemberService.class);
    ProjectFileAccessService access = mock(ProjectFileAccessService.class);
    ProjectFileTextExtractor extractor = mock(ProjectFileTextExtractor.class);
    ProjectProfileService profiles = mock(ProjectProfileService.class);
    ImSharedProjectContext context = new ImSharedProjectContext(projects, files, members, access, extractor);
    @BeforeEach void setup() {
        Project project = new Project(); project.setId(2L); project.setName("合成项目");
        when(projects.findById(2L)).thenReturn(Optional.of(project));
        when(members.hasReadPermission(eq(2L), anyLong())).thenReturn(true);
        when(profiles.getProfile(2L)).thenReturn(List.of(Map.of("label", "案由", "fieldValue", "买卖合同纠纷（虚构）")));
        ReflectionTestUtils.setField(context, "profiles", profiles);
    }
    ProjectFile file(long id, long projectId, boolean visible) {
        ProjectFile file = new ProjectFile(); file.setId(id); file.setProjectId(projectId); file.setName("材料" + id + ".txt");
        file.setIsFolder(false); file.setIsDeleted(false); file.setClientVisible(visible); file.setFileSize(100L);
        file.setFilePath("projects/" + projectId + "/材料" + id + ".txt");
        when(files.findById(id)).thenReturn(Optional.of(file)); when(access.canRead(eq(file), anyLong())).thenReturn(true);
        return file;
    }

    @Test void lawyersOnlyGroupReadsInternalFilesAndTheProfile() throws Exception {
        var internal = file(1, 2, false);
        when(files.findByProjectIdAndIsDeletedFalseOrderBySortOrderAsc(2L)).thenReturn(List.of(internal));
        when(extractor.extract(internal)).thenReturn("内部备忘：先谈违约金（虚构）。");
        var prepared = context.prepare(2L, List.of(7L, 8L), "");
        assertTrue(prepared.text().contains("先谈违约金"), "every reader is a lawyer who can read it");
        assertTrue(prepared.text().contains("买卖合同纠纷"), "profile only when no client is in the group");
        assertEquals(List.of("材料1.txt"), prepared.readNames());
    }

    @Test void withAClientOnlyWhatTheClientMayReadAndNoProfile() throws Exception {
        var shared = file(1, 2, true); var internal = file(2, 2, false); var other = file(4, 9, true);
        when(files.findByProjectIdAndIsDeletedFalseOrderBySortOrderAsc(2L)).thenReturn(List.of(internal, shared, other));
        when(access.isClient(2L, 8L)).thenReturn(true);
        when(access.canRead(internal, 8L)).thenReturn(false);           // the client may not read internal files
        when(extractor.extract(shared)).thenReturn("起诉状记载：李某为原告。");
        var prepared = context.prepare(2L, List.of(7L, 8L), "");
        assertTrue(prepared.text().contains("李某为原告")); assertEquals(List.of(1L), prepared.fileIds());
        verify(extractor, never()).extract(internal); verify(extractor, never()).extract(other);
        assertFalse(prepared.text().contains("材料2")); assertFalse(prepared.text().contains("买卖合同纠纷"), "no profile with a client");
    }

    @Test void localOnlyFilesAreListedWithTheirSharerAndNeverRead() throws Exception {
        var video = file(1, 2, false); video.setName("庭审录像.mp4"); video.setFilePath("projects/2/证据/庭审录像.mp4");
        when(files.findByProjectIdAndIsDeletedFalseOrderBySortOrderAsc(2L)).thenReturn(List.of(video));
        ProjectObjectSyncService sync = mock(ProjectObjectSyncService.class);
        when(sync.localOnlyEntries(2L)).thenReturn(List.of(Map.of("path", "证据/庭审录像.mp4", "name", "庭审录像.mp4", "mine", false, "sharedBy", "沈砚")));
        ReflectionTestUtils.setField(context, "objectSync", sync);
        var prepared = context.prepare(2L, List.of(7L), "");
        assertTrue(prepared.text().contains("庭审录像.mp4") && prepared.text().contains("沈砚"), prepared.text());
        verify(extractor, never()).extract(video);
        assertTrue(prepared.readNames().isEmpty());
    }

    @Test void revokingAccessOrMembershipBeforeDeliveryRejectsContext() throws Exception {
        var shared = file(1, 2, false); when(files.findByProjectIdAndIsDeletedFalseOrderBySortOrderAsc(2L)).thenReturn(List.of(shared));
        when(extractor.extract(shared)).thenReturn("共同材料");
        var prepared = context.prepare(2L, List.of(7L, 8L), "");
        when(access.canRead(shared, 8L)).thenReturn(false);
        assertThrows(IllegalArgumentException.class, () -> context.recheck(prepared));
        when(access.canRead(shared, 8L)).thenReturn(true); when(members.hasReadPermission(2L, 8L)).thenReturn(false);
        assertThrows(IllegalArgumentException.class, () -> context.recheck(prepared));
    }

    @Test void readsAtMostThreeMostRelevantAndCountsWhatWasNotRead() throws Exception {
        List<ProjectFile> documents = new ArrayList<>();
        for (int i = 1; i <= 7; i++) documents.add(file(i, 2, true));
        ProjectFile target = documents.get(6); target.setName("1_李时俊民事起诉状.docx");
        when(files.findByProjectIdAndIsDeletedFalseOrderBySortOrderAsc(2L)).thenReturn(documents);
        when(extractor.extract(any())).thenReturn("正文");
        when(extractor.extract(target)).thenReturn("李时俊是原告。");
        var prepared = context.prepare(2L, List.of(7L), "这份起诉状的原告是谁？");
        assertTrue(prepared.text().contains("李时俊是原告"));
        assertTrue(prepared.text().contains("目录不代表已读取正文"));
        verify(extractor, times(3)).extract(any()); verify(extractor).extract(target);
        assertEquals(3, prepared.readNames().size()); assertEquals("1_李时俊民事起诉状.docx", prepared.readNames().get(0));
        assertEquals(4, prepared.unreadCount(), "7 readable files, 3 read");
    }

    @Test void theMaterialNeverExceedsTheCap() throws Exception {
        List<ProjectFile> documents = new ArrayList<>();
        for (int i = 1; i <= 3; i++) documents.add(file(i, 2, true));
        when(files.findByProjectIdAndIsDeletedFalseOrderBySortOrderAsc(2L)).thenReturn(documents);
        when(extractor.extract(any())).thenReturn("长".repeat(20000));
        assertTrue(context.prepare(2L, List.of(7L), "").text().length() <= ImSharedProjectContext.MAX_CHARS);
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
        when(members.hasReadPermission(2L, 7L)).thenReturn(false);
        var error = assertThrows(IllegalArgumentException.class, () -> AppLanguageScope.call("en-US", () -> context.prepare(2L, List.of(7L), "")));
        assertEquals("Project audience access changed", error.getMessage());
        assertNull(AppLanguageScope.current());
    }

    @Test void footerNamesWhatWasReadAndSaysWhatWasNot() {
        var p = new ImSharedProjectContext.Prepared(2L, List.of(7L), List.of(1L, 2L), "", List.of("买卖合同.docx", "补充协议.docx"), 5);
        assertEquals("\n\n已读取：买卖合同.docx、补充协议.docx；另有 5 个文件未读取", ImSharedProjectContext.footer(p));
        assertEquals("\n\nRead: 买卖合同.docx, 补充协议.docx; 5 more files were not read",
                AppLanguageScope.call("en-US", () -> ImSharedProjectContext.footer(p)));
        assertEquals("", ImSharedProjectContext.footer(new ImSharedProjectContext.Prepared(2L, List.of(7L), List.of(), "")));
    }
}
