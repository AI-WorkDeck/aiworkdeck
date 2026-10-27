// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service;

import com.checkba.model.dto.SearchRequest;
import com.checkba.model.dto.SearchResult;
import com.checkba.model.entity.FileTag;
import com.checkba.model.entity.ProjectFile;
import com.checkba.model.entity.Tag;
import com.checkba.repository.FileTagRepository;
import com.checkba.repository.ProjectFileRepository;
import com.checkba.repository.TagRepository;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.Arrays;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class ContentSearchServiceTagFilterTest {
    private static final long PROJECT_ID = 1L;
    private static final long USER_ID = 9L;
    private static final long FIRST_TAG_ID = 101L;
    private static final long SECOND_TAG_ID = 102L;

    private ProjectFileRepository files;
    private FileTagRepository fileTags;
    private TagRepository tags;
    private DocumentTextService text;
    private ProjectFileAccessService access;
    private ContentSearchService service;
    private Tag firstTag;

    @BeforeEach
    void setUp() {
        files = mock(ProjectFileRepository.class);
        fileTags = mock(FileTagRepository.class);
        tags = mock(TagRepository.class);
        text = mock(DocumentTextService.class);
        access = mock(ProjectFileAccessService.class);
        when(access.readFilterForProject(PROJECT_ID, USER_ID)).thenReturn(file -> true);
        firstTag = tag(FIRST_TAG_ID, "证据");
        when(tags.findAllById(any())).thenReturn(List.of(firstTag, tag(SECOND_TAG_ID, "待核对")));
        service = new ContentSearchService(files, fileTags, tags, text, null, access);
    }

    @AfterEach
    void tearDown() {
        service.shutdown();
    }

    @Test
    void tagOnlyIncludesEveryFileFormatAndReturnsTagDetailsWithoutReadingContent() {
        ProjectFile folder = file(7L, "文件夹", "folder");
        ProjectFile folderWithoutType = file(8L, "另一文件夹", null);
        folderWithoutType.setIsFolder(true);
        givenFiles(file(1L, "合同.docx", "docx"), file(2L, "照片.png", "png"),
                file(3L, "录音.mp3", "mp3"), file(4L, "视频.mp4", "mp4"),
                file(5L, "未知格式", null), file(6L, "未打标签.txt", "txt"), folder, folderWithoutType);
        givenLinks(link(1L, FIRST_TAG_ID), link(2L, FIRST_TAG_ID), link(3L, FIRST_TAG_ID),
                link(4L, FIRST_TAG_ID), link(5L, FIRST_TAG_ID), link(7L, FIRST_TAG_ID), link(8L, FIRST_TAG_ID));

        SearchResult result = service.searchContent(PROJECT_ID, request("  ", FIRST_TAG_ID), USER_ID);

        assertEquals(List.of(1L, 2L, 3L, 4L, 5L), ids(result));
        assertEquals(5, result.getTotalFiles());
        assertEquals(0, result.getTotalMatches());
        var image = result.getResults().get(1);
        assertEquals("照片.png", image.getFileName());
        assertEquals("projects/1/材料/照片.png", image.getFilePath());
        assertEquals("png", image.getFileType());
        assertEquals(List.of(firstTag), image.getTags());
        assertTrue(image.getMatches().isEmpty());
        verifyNoInteractions(text);
    }

    @Test
    void tagOnlyRespectsExplicitFileTypes() {
        givenFiles(file(1L, "合同.docx", "docx"), file(2L, "照片.png", "png"),
                file(3L, "录音.mp3", "mp3"));
        givenLinks(link(1L, FIRST_TAG_ID), link(2L, FIRST_TAG_ID), link(3L, FIRST_TAG_ID));
        SearchRequest request = request("", FIRST_TAG_ID);
        request.setFileTypes(List.of("PNG"));

        assertEquals(List.of(2L), ids(service.searchContent(PROJECT_ID, request, USER_ID)));
        verifyNoInteractions(text);
    }

    @Test
    void duplicateTagIdsStillRequireEveryDistinctTag() {
        givenFiles(file(1L, "同时包含.pdf", "pdf"), file(2L, "只有证据.pdf", "pdf"),
                file(3L, "只有待核对.pdf", "pdf"));
        givenLinks(link(1L, FIRST_TAG_ID), link(1L, SECOND_TAG_ID),
                link(2L, FIRST_TAG_ID), link(3L, SECOND_TAG_ID));

        SearchResult result = service.searchContent(PROJECT_ID,
                request("", FIRST_TAG_ID, FIRST_TAG_ID, SECOND_TAG_ID), USER_ID);

        assertEquals(List.of(1L), ids(result));
        verify(fileTags).findByTagIdIn(List.of(FIRST_TAG_ID, SECOND_TAG_ID));
        verifyNoInteractions(text);
    }

    @Test
    void taggedImageAudioAndVideoMatchNamesWithoutAttemptingContentExtraction() {
        givenFiles(file(1L, "证据照片.png", "png"), file(2L, "证据录音.mp3", "mp3"),
                file(3L, "证据视频.mp4", "mp4"), file(4L, "无关照片.png", "png"));
        givenLinks(link(1L, FIRST_TAG_ID), link(2L, FIRST_TAG_ID),
                link(3L, FIRST_TAG_ID), link(4L, FIRST_TAG_ID));

        SearchResult result = service.searchContent(PROJECT_ID, request("证据", FIRST_TAG_ID), USER_ID);

        assertEquals(List.of(1L, 2L, 3L), ids(result));
        assertEquals(0, result.getTotalMatches());
        verifyNoInteractions(text);
    }

    @Test
    void taggedDocumentStillMatchesContentAlongsideMediaNames() throws Exception {
        ProjectFile document = file(1L, "说明.txt", "txt");
        givenFiles(document, file(2L, "证据照片.png", "png"));
        givenLinks(link(1L, FIRST_TAG_ID), link(2L, FIRST_TAG_ID));
        when(text.extractPlainText(document)).thenReturn("证据材料需要核对");

        SearchResult result = service.searchContent(PROJECT_ID, request("证据", FIRST_TAG_ID), USER_ID);

        assertEquals(List.of(1L, 2L), ids(result));
        assertEquals(1, result.getTotalMatches());
        assertEquals(1, result.getResults().get(0).getMatchCount());
        verify(text).extractPlainText(document);
        verifyNoMoreInteractions(text);
    }

    @Test
    void tagFilterKeepsUnreadableFilesOutOfResultsAndTagPrefetch() {
        ProjectFile hidden = file(1L, "隐藏.png", "png");
        ProjectFile visible = file(2L, "公开.png", "png");
        givenFiles(hidden, visible);
        givenLinks(link(1L, FIRST_TAG_ID), link(2L, FIRST_TAG_ID));
        when(access.readFilterForProject(PROJECT_ID, USER_ID)).thenReturn(file -> file != hidden);

        assertEquals(List.of(2L), ids(service.searchContent(PROJECT_ID, request("", FIRST_TAG_ID), USER_ID)));
        verify(fileTags).findByFileIdIn(List.of(2L));
        verifyNoInteractions(text);
    }

    @Test
    void emptyQueryWithoutTagsDoesNotListAllProjectFiles() {
        SearchResult result = service.searchContent(PROJECT_ID, request(""), USER_ID);

        assertTrue(result.getResults().isEmpty());
        verifyNoInteractions(files, fileTags, text);
    }

    private void givenFiles(ProjectFile... projectFiles) {
        when(files.findByProjectIdAndIsDeletedFalseOrderBySortOrderAsc(PROJECT_ID))
                .thenReturn(Arrays.asList(projectFiles));
    }

    private void givenLinks(FileTag... links) {
        when(fileTags.findByTagIdIn(anyList())).thenReturn(Arrays.asList(links));
        when(fileTags.findByFileIdIn(anyList())).thenReturn(Arrays.asList(links));
    }

    private static List<Long> ids(SearchResult result) {
        return result.getResults().stream().map(SearchResult.FileSearchResult::getFileId).toList();
    }

    private static SearchRequest request(String query, Long... tagIds) {
        SearchRequest request = new SearchRequest();
        request.setQuery(query);
        request.setTagIds(Arrays.asList(tagIds));
        return request;
    }

    private static ProjectFile file(Long id, String name, String type) {
        ProjectFile file = new ProjectFile();
        file.setId(id);
        file.setProjectId(PROJECT_ID);
        file.setName(name);
        file.setFileType(type);
        file.setFilePath("projects/1/材料/" + name);
        file.setIsFolder(false);
        file.setIsDeleted(false);
        return file;
    }

    private static FileTag link(Long fileId, Long tagId) {
        FileTag link = new FileTag();
        link.setFileId(fileId);
        link.setTagId(tagId);
        return link;
    }

    private static Tag tag(Long id, String name) {
        Tag tag = new Tag();
        tag.setId(id);
        tag.setProjectId(PROJECT_ID);
        tag.setName(name);
        return tag;
    }
}
