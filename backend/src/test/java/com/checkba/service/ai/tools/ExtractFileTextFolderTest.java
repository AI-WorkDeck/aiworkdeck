// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ai.tools;

import com.checkba.model.entity.ProjectFile;
import com.checkba.repository.ProjectFileRepository;
import com.checkba.service.ai.context.ProjectContextHolder;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;

import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;

/**
 * 传进来一个文件夹时 extract_file_text 的行为。
 *
 * <p>背景：以前撞上文件夹只返回 {@code Error: File is a folder}，模型无路可走——
 * 用户在诉讼可视化里把卷宗文件夹当材料范围交进来，表现就是「给它文件夹它不认识」。
 * 现在直接把文件夹内容答出来。这组用例钉住那条出路不许再退回死错误。
 */
class ExtractFileTextFolderTest {

    @AfterEach
    void clearContext() {
        ProjectContextHolder.clear();
    }

    private static ProjectFile folder(long id, long projectId, String name) {
        ProjectFile f = new ProjectFile();
        f.setId(id);
        f.setProjectId(projectId);
        f.setName(name);
        f.setFileType("folder");
        f.setIsFolder(true);
        return f;
    }

    private static ProjectFile file(long id, long projectId, String name, String type) {
        ProjectFile f = new ProjectFile();
        f.setId(id);
        f.setProjectId(projectId);
        f.setName(name);
        f.setFileType(type);
        f.setIsFolder(false);
        return f;
    }

    /** 只接线本用例需要的两个依赖，其余传 null——这条分支在碰到它们之前就返回了。 */
    private static FileTools toolsWith(ProjectFileRepository repo) {
        return new FileTools(null, repo, null, null, null, null, null, null, null);
    }

    @Test
    @DisplayName("文件夹返回子项清单，而不是死错误")
    void listsChildrenInsteadOfDeadEnd() {
        ProjectContextHolder.setProjectId("7");
        ProjectFileRepository repo = Mockito.mock(ProjectFileRepository.class);
        ProjectFile dir = folder(100L, 7L, "一审卷宗");
        Mockito.when(repo.findById(100L)).thenReturn(Optional.of(dir));
        Mockito.when(repo.findByProjectIdAndParentIdAndIsDeletedFalseOrderBySortOrderAsc(7L, 100L))
                .thenReturn(List.of(
                        file(101L, 7L, "起诉状.docx", "docx"),
                        file(102L, 7L, "证据目录.pdf", "pdf"),
                        folder(103L, 7L, "补充证据")));

        String out = toolsWith(repo).extract_file_text(100L);

        assertFalse(out.startsWith("Error"), "文件夹不该再是错误出口：" + out);
        assertTrue(out.contains("起诉状.docx"), "要列出子文件");
        assertTrue(out.contains("证据目录.pdf"), "非 Office 文件同样要列（旧的指路方案会漏掉 PDF）");
        assertTrue(out.contains("id=101"), "必须给出 id，否则模型没法接着读");
        assertTrue(out.contains("[文件夹]"), "子文件夹要标出来，模型才知道可以再往下一层");
    }

    @Test
    @DisplayName("空文件夹说清楚是空的，不报错")
    void emptyFolderIsNotAnError() {
        ProjectContextHolder.setProjectId("7");
        ProjectFileRepository repo = Mockito.mock(ProjectFileRepository.class);
        Mockito.when(repo.findById(200L)).thenReturn(Optional.of(folder(200L, 7L, "空目录")));
        Mockito.when(repo.findByProjectIdAndParentIdAndIsDeletedFalseOrderBySortOrderAsc(7L, 200L))
                .thenReturn(List.of());

        String out = toolsWith(repo).extract_file_text(200L);

        assertFalse(out.startsWith("Error"));
        assertTrue(out.contains("空"), "要说清楚里面没东西：" + out);
    }

    @Test
    @DisplayName("跨项目的文件夹仍被项目边界挡住")
    void stillRejectsFolderFromAnotherProject() {
        // 列目录是新出路，但不能顺手绕开项目边界——fileId 是 LLM 自由填的参数
        ProjectContextHolder.setProjectId("1");
        ProjectFileRepository repo = Mockito.mock(ProjectFileRepository.class);
        Mockito.when(repo.findById(300L)).thenReturn(Optional.of(folder(300L, 999L, "别人的卷宗")));

        String out = toolsWith(repo).extract_file_text(300L);

        assertTrue(out.startsWith("Error"), "跨项目必须拒绝：" + out);
        assertFalse(out.contains("别人的卷宗"), "拒绝时不该回显他人项目的文件夹名");
    }
    @Test
    void everyChildAfterTwoHundredRemainsReachableInStableOrder() {
        ProjectContextHolder.setProjectId("7");
        ProjectFileRepository repo = Mockito.mock(ProjectFileRepository.class);
        Mockito.when(repo.findById(100L)).thenReturn(Optional.of(folder(100L, 7L, "商标证")));
        java.util.ArrayList<ProjectFile> children = new java.util.ArrayList<>();
        for (long id = 1_000; id < 1_451; id++) {
            ProjectFile child = file(id, 7L, "证书-" + id + ".pdf", "pdf");
            child.setSortOrder((int) (id % 3));
            children.add(child);
        }
        java.util.Collections.reverse(children);
        Mockito.when(repo.findByProjectIdAndParentIdAndIsDeletedFalseOrderBySortOrderAsc(7L, 100L))
                .thenReturn(children);
        FileTools tools = toolsWith(repo);
        java.util.List<Long> listed = new java.util.ArrayList<>();
        int offset = 0;
        int calls = 0;
        while (true) {
            String page = tools.extract_file_text(100L, offset, 80_000);
            assertTrue(page.length() <= 80_000);
            assertTrue(page.contains("total=451"));
            java.util.regex.Matcher rows = java.util.regex.Pattern.compile("(?m)^- .*?id=(\\d+)").matcher(page);
            int count = 0;
            while (rows.find()) { listed.add(Long.valueOf(rows.group(1))); count++; }
            assertTrue(count > 0 && count <= 200);
            calls++;
            java.util.regex.Matcher next = java.util.regex.Pattern.compile("nextOffset=(\\d+)").matcher(page);
            if (!next.find()) break;
            int nextOffset = Integer.parseInt(next.group(1));
            assertTrue(nextOffset > offset);
            assertTrue(page.contains("extract_file_text(fileId=100, offset=" + nextOffset + ", maxChars=80000)"));
            offset = nextOffset;
            assertTrue(calls < 5);
        }
        java.util.List<Long> expected = children.stream()
                .sorted(java.util.Comparator.comparing(ProjectFile::getSortOrder).thenComparing(ProjectFile::getId))
                .map(ProjectFile::getId).toList();
        assertEquals(expected, listed, "逐页清单必须覆盖每个ID，不能漏项或重复");
        assertEquals(3, calls);
    }

    @Test
    void characterBudgetBoundsLongNamesWithoutLosingTheirIds() {
        ProjectContextHolder.setProjectId("7");
        ProjectFileRepository repo = Mockito.mock(ProjectFileRepository.class);
        Mockito.when(repo.findById(100L)).thenReturn(Optional.of(folder(100L, 7L, "长".repeat(4_000))));
        java.util.List<ProjectFile> children = java.util.stream.LongStream.range(201, 221)
                .mapToObj(id -> file(id, 7L, "证📄".repeat(4_000), "t".repeat(400))).toList();
        Mockito.when(repo.findByProjectIdAndParentIdAndIsDeletedFalseOrderBySortOrderAsc(7L, 100L))
                .thenReturn(children);
        FileTools tools = toolsWith(repo);
        for (String language : List.of("zh-CN", "en-US")) {
            int offset = 0;
            java.util.Set<Long> seen = new java.util.HashSet<>();
            while (offset < children.size()) {
                final int current = offset;
                String page = com.checkba.service.AppLanguageScope.call(language,
                        () -> tools.extract_file_text(100L, current, 1024));
                assertTrue(page.length() <= 1024, "full response exceeds maxChars: " + page.length());
                java.util.regex.Matcher rows = java.util.regex.Pattern.compile("(?m)^- .*?id=(\\d+)").matcher(page);
                int count = 0;
                while (rows.find()) { assertTrue(seen.add(Long.valueOf(rows.group(1)))); count++; }
                assertTrue(count > 0, "每页至少必须给出一个可读取ID");
                offset += count;
                if (offset < children.size()) assertTrue(page.contains("nextOffset=" + offset));
                if (language.equals("en-US")) assertTrue(page.contains("contents have not been read"));
                for (int j = 0; j < page.length(); j++) {
                    if (Character.isHighSurrogate(page.charAt(j))) {
                        assertTrue(j + 1 < page.length() && Character.isLowSurrogate(page.charAt(++j)));
                    } else assertFalse(Character.isLowSurrogate(page.charAt(j)));
                }
            }
            assertEquals(20, seen.size());
        }
    }

    @Test
    void filteringDoesNotExposeDeletedRecoveryOrForeignChildren() {
        ProjectContextHolder.setProjectId("7");
        ProjectFileRepository repo = Mockito.mock(ProjectFileRepository.class);
        Mockito.when(repo.findById(100L)).thenReturn(Optional.of(folder(100L, 7L, "材料")));
        ProjectFile deleted = file(202L, 7L, "deleted.pdf", "pdf"); deleted.setIsDeleted(true);
        ProjectFile recoveryPath = file(203L, 7L, "masked.pdf", "pdf");
        recoveryPath.setFilePath("safe.awd-recovery");
        Mockito.when(repo.findByProjectIdAndParentIdAndIsDeletedFalseOrderBySortOrderAsc(7L, 100L))
                .thenReturn(List.of(file(201L, 7L, "visible.pdf", "pdf"), deleted, recoveryPath,
                        file(204L, 7L, "secret.awd-recovery", "awd-recovery"),
                        file(205L, 999L, "foreign.pdf", "pdf"), folder(206L, 7L, "子目录")));
        String page = toolsWith(repo).extract_file_text(100L, 0, 1024);
        assertTrue(page.contains("total=2"));
        assertTrue(page.contains("id=201"));
        assertTrue(page.contains("[文件夹] id=206"));
        for (long id = 202; id < 206; id++) assertFalse(page.contains("id=" + id));
    }

    @Test
    void crossProjectReadPermissionIsCheckedAgainForContinuation() {
        ProjectContextHolder.setProjectId("1");
        ProjectContextHolder.setUserId(9L);
        ProjectFileRepository repo = Mockito.mock(ProjectFileRepository.class);
        Mockito.when(repo.findById(100L)).thenReturn(Optional.of(folder(100L, 7L, "材料")));
        Mockito.when(repo.findByProjectIdAndParentIdAndIsDeletedFalseOrderBySortOrderAsc(7L, 100L))
                .thenReturn(List.of(file(201L, 7L, "certificate.pdf", "pdf")));
        com.checkba.service.ProjectMemberService members = Mockito.mock(com.checkba.service.ProjectMemberService.class);
        Mockito.when(members.hasReadPermission(7L, 9L)).thenReturn(true, false);
        FileTools tools = toolsWith(repo); tools.setProjectMemberService(members);
        assertTrue(tools.extract_file_text(100L, 0, null).contains("certificate.pdf"));
        assertTrue(tools.extract_file_text(100L, 0, null).startsWith("Error:"));
        Mockito.verify(repo, Mockito.times(1))
                .findByProjectIdAndParentIdAndIsDeletedFalseOrderBySortOrderAsc(7L, 100L);
    }

    @Test
    void offsetBeyondDirectoryGivesAnExecutableRestart() {
        ProjectContextHolder.setProjectId("7");
        ProjectFileRepository repo = Mockito.mock(ProjectFileRepository.class);
        Mockito.when(repo.findById(100L)).thenReturn(Optional.of(folder(100L, 7L, "材料")));
        Mockito.when(repo.findByProjectIdAndParentIdAndIsDeletedFalseOrderBySortOrderAsc(7L, 100L))
                .thenReturn(List.of(file(201L, 7L, "certificate.pdf", "pdf")));
        String page = toolsWith(repo).extract_file_text(100L, Integer.MAX_VALUE, null);
        assertTrue(page.startsWith("Error:"));
        assertTrue(page.contains("offset=0"));
    }

    @Test
    void cancelledListingDoesNotStartTheChildQuery() {
        ProjectContextHolder.setProjectId("7");
        ProjectFileRepository repo = Mockito.mock(ProjectFileRepository.class);
        Mockito.when(repo.findById(100L)).thenReturn(Optional.of(folder(100L, 7L, "材料")));
        Thread.currentThread().interrupt();
        try {
            assertTrue(toolsWith(repo).extract_file_text(100L).startsWith("Error:"));
            Mockito.verify(repo, Mockito.never())
                    .findByProjectIdAndParentIdAndIsDeletedFalseOrderBySortOrderAsc(Mockito.anyLong(), Mockito.anyLong());
        } finally {
            Thread.interrupted();
        }
    }

    @Test
    void deletedFolderDoesNotExposeChildren() {
        ProjectContextHolder.setProjectId("7");
        ProjectFileRepository repo = Mockito.mock(ProjectFileRepository.class);
        ProjectFile deleted = folder(100L, 7L, "deleted"); deleted.setIsDeleted(true);
        Mockito.when(repo.findById(100L)).thenReturn(Optional.of(deleted));
        assertTrue(toolsWith(repo).extract_file_text(100L).startsWith("Error:"));
        Mockito.verify(repo, Mockito.never())
                .findByProjectIdAndParentIdAndIsDeletedFalseOrderBySortOrderAsc(Mockito.anyLong(), Mockito.anyLong());
    }

}
