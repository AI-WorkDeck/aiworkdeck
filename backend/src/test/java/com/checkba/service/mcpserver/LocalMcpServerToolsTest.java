// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.mcpserver;

import com.checkba.model.dto.SearchResult;
import com.checkba.model.entity.Project;
import com.checkba.model.entity.ProjectFile;
import com.checkba.repository.ProjectFileRepository;
import com.checkba.service.ContentSearchService;
import com.checkba.service.ProjectMemberService;
import com.checkba.service.ProjectService;
import com.checkba.service.file.ProjectFileTextExtractor;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class LocalMcpServerToolsTest {

    private static final long USER = 7L;

    private ProjectService projectService;
    private ProjectMemberService members;
    private ProjectFileRepository files;
    private ProjectFileTextExtractor extractor;
    private ContentSearchService search;
    private com.checkba.service.revision.PendingRevisionService revisions;
    private com.checkba.service.UserActivityLogService activityLog;
    private LocalMcpServerTools tools;

    @BeforeEach
    void setUp() {
        projectService = mock(ProjectService.class);
        members = mock(ProjectMemberService.class);
        files = mock(ProjectFileRepository.class);
        extractor = mock(ProjectFileTextExtractor.class);
        search = mock(ContentSearchService.class);
        revisions = mock(com.checkba.service.revision.PendingRevisionService.class);
        activityLog = mock(com.checkba.service.UserActivityLogService.class);
        tools = new LocalMcpServerTools(projectService, members, files, extractor, search, revisions, activityLog);
        when(members.hasReadPermission(1L, USER)).thenReturn(true);
        when(members.hasReadPermission(2L, USER)).thenReturn(false);
    }

    private static ProjectFile file(long id, long projectId, String name) {
        ProjectFile f = new ProjectFile();
        f.setId(id);
        f.setProjectId(projectId);
        f.setName(name);
        return f;
    }

    @Test
    void listsOnlyTheUsersProjects() {
        Project p = new Project();
        p.setId(1L);
        p.setName("A 诉 B");
        when(projectService.getUserProjects(USER)).thenReturn(List.of(p));
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> out = (List<Map<String, Object>>) tools.call("list_projects", Map.of(), USER);
        assertEquals(1, out.size());
        assertEquals("A 诉 B", out.get(0).get("name"));
    }

    @Test
    void readFilePagesWithoutOcrAndHidesOtherProjects() throws Exception {
        when(files.findById(10L)).thenReturn(Optional.of(file(10, 1, "合同.docx")));
        when(extractor.extract(any())).thenReturn("0123456789");
        @SuppressWarnings("unchecked")
        Map<String, Object> page = (Map<String, Object>) tools.call("read_file",
                Map.of("fileId", 10, "offset", 2, "maxChars", 5), USER);
        assertEquals("23456", page.get("text"));
        assertEquals(7, page.get("nextOffset"));
        @SuppressWarnings("unchecked")
        Map<String, Object> last = (Map<String, Object>) tools.call("read_file",
                Map.of("fileId", "10", "offset", 7), USER);
        assertNull(last.get("nextOffset"));
        verify(extractor, never()).extractText(any());

        when(files.findById(20L)).thenReturn(Optional.of(file(20, 2, "别人的.docx")));
        var denied = assertThrows(LocalMcpServerTools.ToolError.class,
                () -> tools.call("read_file", Map.of("fileId", 20), USER));
        assertEquals(assertThrows(LocalMcpServerTools.ToolError.class,
                () -> tools.call("read_file", Map.of("fileId", 99), USER)).getMessage().replace("99", "20"),
                denied.getMessage(), "无权与不存在回同一句话");
    }

    @Test
    void projectScopedToolsCheckReadPermission() {
        assertThrows(LocalMcpServerTools.ToolError.class,
                () -> tools.call("list_project_files", Map.of("projectId", 2), USER));
        assertThrows(LocalMcpServerTools.ToolError.class,
                () -> tools.call("search_project", Map.of("projectId", 2, "query", "违约金"), USER));
        verify(search, never()).searchContent(any(), any(), any());
        assertThrows(LocalMcpServerTools.ToolError.class,
                () -> tools.call("list_project_files", Map.of("projectId", "1; drop"), USER));
        assertThrows(LocalMcpServerTools.ToolError.class, () -> tools.call("write_file", Map.of(), USER));
    }

    @Test
    void searchFlattensHits() {
        SearchResult.MatchInfo m = new SearchResult.MatchInfo();
        m.setLineNumber(3);
        m.setContent("违约金为合同总价的 20%");
        SearchResult.FileSearchResult f = new SearchResult.FileSearchResult();
        f.setFileId(10L);
        f.setFileName("合同.docx");
        f.setMatches(List.of(m));
        SearchResult r = new SearchResult();
        r.setTotalMatches(1);
        r.setResults(List.of(f));
        when(search.searchContent(any(), any(), any())).thenReturn(r);
        @SuppressWarnings("unchecked")
        Map<String, Object> out = (Map<String, Object>) tools.call("search_project",
                Map.of("projectId", 1, "query", " 违约金 "), USER);
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> hits = (List<Map<String, Object>>) out.get("hits");
        assertEquals(1, hits.size());
        assertEquals(10L, hits.get(0).get("fileId"));
        assertEquals(3, hits.get(0).get("line"));
        assertEquals("违约金", out.get("query"));
    }

    @Test
    void proposeRevisionQueuesWithSanitizedClientSourceAndNeverTouchesFiles() {
        com.checkba.model.entity.PendingRevision saved = new com.checkba.model.entity.PendingRevision();
        saved.setId(5L);
        saved.setStatus("PENDING");
        when(revisions.propose(any(), any(), any(), any(), any())).thenReturn(saved);
        Object out = tools.call("propose_revision", Map.of("fileId", 3, "baseVersion", "1-2",
                "edits", List.of(Map.of("find", "a", "replace", "b", "reason", "r"))), USER, "claude<code>/1.0");
        assertEquals(5L, ((Map<?, ?>) out).get("proposalId"));
        org.mockito.ArgumentCaptor<String> src = org.mockito.ArgumentCaptor.forClass(String.class);
        verify(revisions).propose(org.mockito.ArgumentMatchers.eq(USER), org.mockito.ArgumentMatchers.eq(3L),
                org.mockito.ArgumentMatchers.eq("1-2"), any(), src.capture());
        assertEquals("mcp:claudecode1.0", src.getValue());
    }

    @Test
    void proposeRevisionRejectsMalformedArguments() {
        assertThrows(LocalMcpServerTools.ToolError.class, () -> tools.call("propose_revision",
                Map.of("fileId", 3, "edits", List.of()), USER));
        assertThrows(LocalMcpServerTools.ToolError.class, () -> tools.call("propose_revision",
                Map.of("fileId", 3, "baseVersion", "v", "edits", List.of(Map.of("find", "a"))), USER));
        when(revisions.propose(any(), any(), any(), any(), any()))
                .thenThrow(new com.checkba.service.revision.PendingRevisionService.RevisionException("bad"));
        assertThrows(LocalMcpServerTools.ToolError.class, () -> tools.call("propose_revision",
                Map.of("fileId", 3, "baseVersion", "v", "edits", List.of(Map.of("find", "a", "replace", "b"))), USER));
    }

    @Test
    void readFileReturnsVersionForBaseVersion() throws Exception {
        ProjectFile f = file(9, 1, "a.docx");
        f.setFileSize(10L);
        when(files.findById(9L)).thenReturn(Optional.of(f));
        when(members.hasReadPermission(1L, USER)).thenReturn(true);
        when(extractor.extract(f)).thenReturn("hello");
        Map<?, ?> out = (Map<?, ?>) tools.call("read_file", Map.of("fileId", 9), USER);
        assertEquals(com.checkba.service.revision.PendingRevisionService.fileVersion(f), out.get("version"));
    }

    @Test
    void curatedCallsWriteAiToolAuditWithoutArgValuesOrOutput() {
        org.mockito.ArgumentCaptor<String> meta = org.mockito.ArgumentCaptor.forClass(String.class);
        tools.call("list_projects", java.util.Map.of(), USER);
        org.mockito.Mockito.verify(activityLog).logActivity(org.mockito.ArgumentMatchers.eq(USER),
                org.mockito.ArgumentMatchers.eq("ai_tool"), org.mockito.ArgumentMatchers.isNull(),
                org.mockito.ArgumentMatchers.eq("list_projects"), org.mockito.ArgumentMatchers.anyLong(),
                meta.capture(), org.mockito.ArgumentMatchers.isNull());
        org.junit.jupiter.api.Assertions.assertTrue(meta.getValue().contains("\"source\":\"mcp\""), meta.getValue());
        org.junit.jupiter.api.Assertions.assertTrue(meta.getValue().contains("\"ok\":true"), meta.getValue());
        org.junit.jupiter.api.Assertions.assertTrue(meta.getValue().contains("argsDigest"), meta.getValue());

        // 失败调用也留痕，ok=false，且不泄露参数值
        org.junit.jupiter.api.Assertions.assertThrows(LocalMcpServerTools.ToolError.class,
                () -> tools.call("read_file", java.util.Map.of("fileId", 987654321L), USER));
        org.mockito.ArgumentCaptor<String> failed = org.mockito.ArgumentCaptor.forClass(String.class);
        org.mockito.Mockito.verify(activityLog).logActivity(org.mockito.ArgumentMatchers.eq(USER),
                org.mockito.ArgumentMatchers.eq("ai_tool"), org.mockito.ArgumentMatchers.isNull(),
                org.mockito.ArgumentMatchers.eq("read_file"), org.mockito.ArgumentMatchers.anyLong(),
                failed.capture(), org.mockito.ArgumentMatchers.isNull());
        org.junit.jupiter.api.Assertions.assertTrue(failed.getValue().contains("\"ok\":false"), failed.getValue());
        org.junit.jupiter.api.Assertions.assertFalse(failed.getValue().contains("987654321"), failed.getValue());
    }
}
