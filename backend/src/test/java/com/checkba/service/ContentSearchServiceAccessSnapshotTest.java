// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service;

import com.checkba.model.dto.SearchRequest;
import com.checkba.model.dto.SearchResult;
import com.checkba.model.entity.*;
import com.checkba.repository.*;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Optional;
import java.util.stream.IntStream;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class ContentSearchServiceAccessSnapshotTest {
    private final ProjectFileRepository files = mock(ProjectFileRepository.class);
    private final ProjectRepository projects = mock(ProjectRepository.class);
    private final ProjectMemberRepository memberships = mock(ProjectMemberRepository.class);
    private final UserRepository users = mock(UserRepository.class);
    private final FileTagRepository fileTags = mock(FileTagRepository.class);
    private final DocumentTextService text = mock(DocumentTextService.class);
    private ContentSearchService service;
    private User user;

    @BeforeEach
    void setUp() {
        Project project = new Project(); project.setId(10L); project.setUserId(2L);
        ProjectMember member = new ProjectMember(); member.setRole("PARTICIPANT");
        user = new User(); user.setId(7L); user.setRole("USER");
        when(projects.findById(10L)).thenReturn(Optional.of(project));
        when(memberships.findByProjectIdAndUserId(10L, 7L)).thenReturn(Optional.of(member));
        when(users.findById(7L)).thenReturn(Optional.of(user));
        ProjectMemberService members = new ProjectMemberService(memberships, users, projects,
                mock(ProjectInvitationRepository.class));
        service = new ContentSearchService(files, fileTags, mock(TagRepository.class), text, null,
                new ProjectFileAccessService(members, users, files));
    }

    @AfterEach
    void tearDown() { service.shutdown(); }

    private ProjectFile file(long id) {
        ProjectFile file = new ProjectFile();
        file.setId(id); file.setProjectId(10L); file.setUserId(2L);
        file.setName("锦江-" + id + ".txt"); file.setFileType("txt");
        file.setIsDeleted(false); file.setIsFolder(false); file.setSortOrder((int) id);
        file.setFilePath("projects/10/" + id + ".txt");
        return file;
    }

    private SearchRequest query(boolean filenameOnly) {
        SearchRequest request = new SearchRequest(); request.setQuery("锦江");
        request.setFilenameOnly(filenameOnly);
        return request;
    }

    private SearchResult search(SearchRequest request, ProjectFile... candidates) {
        when(files.findByProjectIdAndIsDeletedFalseOrderBySortOrderAsc(10L)).thenReturn(List.of(candidates));
        return service.searchContent(10L, request, 7L);
    }

    @Test
    void thousandsOfFilesResolveMembershipAndRoleOnlyOncePerSearch() {
        List<ProjectFile> candidates = IntStream.rangeClosed(1, 6687).mapToObj(i -> file(i)).toList();
        when(files.findByProjectIdAndIsDeletedFalseOrderBySortOrderAsc(10L)).thenReturn(candidates);

        assertEquals(6687, service.searchContent(10L, query(true), 7L).getTotalFiles());

        // Both the membership service and account-level client guard are real; only repositories are mocked.
        verify(projects, times(2)).findById(10L);
        verify(memberships, times(2)).findByProjectIdAndUserId(10L, 7L);
        verify(users, times(2)).findById(7L);
        verifyNoInteractions(text);
    }

    @Test
    void filenameOnlyDoesNotReadContentOrWaitForTheContentPool() {
        service.shutdown(); // A filename search must still work when no content task can be submitted.
        SearchResult result = search(query(true), file(1L));
        assertEquals(1, result.getTotalFiles());
        assertEquals(0, result.getTotalMatches());
        verifyNoInteractions(text);
    }

    @Test
    void filenameOnlyDoesNotReturnContentOnlyMatches() throws Exception {
        ProjectFile file = file(1L); file.setName("普通文件.txt");
        when(text.extractPlainText(file)).thenReturn("锦江");
        assertTrue(search(query(true), file).getResults().isEmpty());
        verifyNoInteractions(text);
    }

    @Test
    void membershipRevocationAndRoleChangesApplyToTheNextSearch() {
        ProjectFile file = file(1L);
        assertEquals(1, search(query(true), file).getTotalFiles());
        when(memberships.findByProjectIdAndUserId(10L, 7L)).thenReturn(Optional.empty());
        assertEquals(0, search(query(true), file).getTotalFiles());
        ProjectMember member = new ProjectMember(); member.setRole("CLIENT");
        when(memberships.findByProjectIdAndUserId(10L, 7L)).thenReturn(Optional.of(member));
        assertEquals(0, search(query(true), file).getTotalFiles());
        file.setClientVisible(true);
        assertEquals(1, search(query(true), file).getTotalFiles());
    }

    @Test
    void clientSnapshotStillChecksOwnerGrantDeletionAndProjectOnEveryFile() {
        user.setRole("CLIENT");
        ProjectFile hidden = file(1L);
        ProjectFile own = file(2L); own.setUserId(7L);
        ProjectFile visible = file(3L); visible.setClientVisible(true);
        ProjectFile deleted = file(4L); deleted.setUserId(7L); deleted.setIsDeleted(true);
        ProjectFile foreign = file(5L); foreign.setProjectId(11L); foreign.setClientVisible(true);
        Project other = new Project(); other.setId(11L); other.setUserId(7L);
        when(projects.findById(11L)).thenReturn(Optional.of(other));

        assertEquals(List.of(2L, 3L), search(query(true), hidden, own, visible, deleted, foreign)
                .getResults().stream().map(SearchResult.FileSearchResult::getFileId).toList());
        verify(fileTags).findByFileIdIn(List.of(2L, 3L));
        verify(projects, never()).findById(11L);
        verifyNoInteractions(text);
    }

    @Test
    void filenameOnlyKeepsTagAndTypeFilters() {
        ProjectFile txt = file(1L);
        ProjectFile pdf = file(2L); pdf.setFileType("pdf"); pdf.setName("锦江.pdf");
        ProjectFile untagged = file(3L);
        FileTag first = new FileTag(); first.setFileId(1L); first.setTagId(90L);
        FileTag second = new FileTag(); second.setFileId(2L); second.setTagId(90L);
        when(fileTags.findByTagIdIn(List.of(90L))).thenReturn(List.of(first, second));
        SearchRequest request = query(true); request.setTagIds(List.of(90L)); request.setFileTypes(List.of("txt"));
        assertEquals(List.of(1L), search(request, txt, pdf, untagged).getResults().stream()
                .map(SearchResult.FileSearchResult::getFileId).toList());
        verifyNoInteractions(text);
    }

    @Test
    void parserErrorCannotDiscardAnExistingFilenameMatch() throws Exception {
        ProjectFile file = file(1L);
        when(text.extractPlainText(file)).thenThrow(new NoSuchMethodError("synthetic parser linkage failure"));
        SearchResult result = search(query(false), file);
        assertEquals(1, result.getTotalFiles());
        assertEquals("锦江-1.txt", result.getResults().get(0).getFileName());
        assertEquals(0, result.getTotalMatches());
    }
}
