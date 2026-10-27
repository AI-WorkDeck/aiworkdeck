// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.controller;

import com.checkba.config.GlobalExceptionHandler;
import com.checkba.model.entity.ProjectFile;
import com.checkba.repository.ProjectFileRepository;
import com.checkba.service.FileTagService;
import com.checkba.service.ProjectFileAccessService;
import com.checkba.service.ProjectFileService;
import com.checkba.service.ProjectMemberService;
import jakarta.persistence.EntityManager;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.MockedStatic;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.util.Collections;
import java.util.List;

import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/** HTTP 参数、现有权限闸与真实 H2 查询一并验证，避免 mock 掩盖跨项目或回收站泄漏。 */
@DataJpaTest(showSql = false)
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@TestPropertySource(properties = {
        "spring.datasource.url=jdbc:h2:mem:project-file-ids-test;MODE=PostgreSQL;NON_KEYWORDS=VALUE;DB_CLOSE_DELAY=-1",
        "spring.datasource.driver-class-name=org.h2.Driver",
        "spring.datasource.username=sa",
        "spring.datasource.password=",
        "spring.jpa.database-platform=org.hibernate.dialect.H2Dialect",
        "spring.jpa.hibernate.ddl-auto=create-drop"
})
class ProjectFileControllerIdsTest {
    @Autowired ProjectFileRepository repository;
    @Autowired EntityManager entityManager;
    @Autowired org.springframework.jdbc.core.JdbcTemplate jdbc;
    private final ProjectMemberService members = mock(ProjectMemberService.class);
    private final ProjectFileAccessService access = mock(ProjectFileAccessService.class);
    private final FileTagService tags = mock(FileTagService.class);
    private MockedStatic<AuthController> auth;
    private MockMvc mvc;
    private ProjectFileService service;

    @BeforeEach
    void setup() {
        service = spy(new ProjectFileService(repository, null, null, null, null, null, null, null));
        var controller = new ProjectFileController(service, members, access, tags, null, null, null);
        mvc = MockMvcBuilders.standaloneSetup(controller).setControllerAdvice(new GlobalExceptionHandler()).build();
        auth = mockStatic(AuthController.class);
        auth.when(() -> AuthController.getUserIdFromSession("session")).thenReturn(7L);
        auth.when(() -> AuthController.getUserIdFromSession(null)).thenReturn(null);
        when(members.hasReadPermission(10L, 7L)).thenReturn(true);
    }

    @AfterEach
    void closeAuth() {
        auth.close();
    }

    private ProjectFile row(long projectId, Long parentId, boolean folder, boolean deleted) {
        var file = new ProjectFile();
        file.setProjectId(projectId);
        file.setParentId(parentId);
        file.setName(folder ? "资料" : "合同.docx");
        file.setIsFolder(folder);
        file.setFileType(folder ? null : "docx");
        file.setSortOrder(0);
        file.setUserId(7L);
        file.setIsDeleted(deleted);
        return repository.saveAndFlush(file);
    }

    @Test
    void selectedIdsUseProjectAndDeletionFiltersWithoutLoadingTreeOrTags() throws Exception {
        var folder = row(10L, null, true, false);
        var file = row(10L, folder.getId(), false, false);
        var deleted = row(10L, null, false, true);
        var otherProject = row(20L, null, false, false);
        row(10L, null, false, false);
        entityManager.clear();

        mvc.perform(get("/api/projects/10/files").header("X-Session-Id", "session")
                        .param("ids", folder.getId() + "," + file.getId() + "," + deleted.getId() + "," + otherProject.getId())
                        .param("tree", "true").param("parentId", "999999"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.length()").value(2))
                .andExpect(jsonPath("$[*].id", org.hamcrest.Matchers.containsInAnyOrder(folder.getId().intValue(), file.getId().intValue())))
                .andExpect(jsonPath("$[*].projectId", org.hamcrest.Matchers.everyItem(org.hamcrest.Matchers.is(10))));
        verify(service, never()).getFileTree(any());
        verify(service, never()).getFilesByParent(any(), any());
        verifyNoInteractions(tags);
    }

    @ParameterizedTest
    @ValueSource(strings = {"", " "})
    void emptyIdsNeverFallBackToTheFullTree(String ids) throws Exception {
        row(10L, null, false, false);
        mvc.perform(get("/api/projects/10/files").header("X-Session-Id", "session")
                        .param("ids", ids).param("tree", "true"))
                .andExpect(status().isOk()).andExpect(content().json("[]"));
        verifyNoInteractions(service, tags);
    }

    @ParameterizedTest
    @ValueSource(strings = {"abc", "0", "-1", "1,,2", "1,", "1.5", "9223372036854775808"})
    void invalidIdsReturnHttp400(String ids) throws Exception {
        mvc.perform(get("/api/projects/10/files").header("X-Session-Id", "session").param("ids", ids))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value(400));
        verifyNoInteractions(service, tags);
    }

    @Test
    void moreThanTwoHundredIdsIsRejectedBeforeQuerying() throws Exception {
        mvc.perform(get("/api/projects/10/files").header("X-Session-Id", "session")
                        .param("ids", String.join(",", Collections.nCopies(201, "1"))))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value(400));
        verifyNoInteractions(service, tags);
    }

    @Test
    void twoHundredIdsAreAllowedAndDuplicateRowsAppearOnlyOnce() throws Exception {
        var file = row(10L, null, false, false);
        entityManager.clear();
        mvc.perform(get("/api/projects/10/files").header("X-Session-Id", "session")
                        .param("ids", String.join(",", Collections.nCopies(200, file.getId().toString()))))
                .andExpect(status().isOk()).andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].id").value(file.getId()));
        verifyNoInteractions(tags);
    }

    @Test
    void nonexistentIdsReturnEmptyList() throws Exception {
        row(10L, null, false, false);
        mvc.perform(get("/api/projects/10/files").header("X-Session-Id", "session").param("ids", "999999"))
                .andExpect(status().isOk()).andExpect(content().json("[]"));
        verifyNoInteractions(tags);
    }

    @Test
    void loginIsRequiredBeforeParsingIds() throws Exception {
        mvc.perform(get("/api/projects/10/files").param("ids", "invalid"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.code").value(4010));
        verifyNoInteractions(service, members, access, tags);
    }

    @Test
    void inaccessibleProjectIsRejectedBeforeParsingIds() throws Exception {
        when(members.hasReadPermission(10L, 7L)).thenReturn(false);
        mvc.perform(get("/api/projects/10/files").header("X-Session-Id", "session").param("ids", "invalid"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.code").value(1));
        verifyNoInteractions(service, access, tags);
    }

    @Test
    void clientCannotUseIdsToBypassTreeAccess() throws Exception {
        when(access.isClient(10L, 7L)).thenReturn(true);
        mvc.perform(get("/api/projects/10/files").header("X-Session-Id", "session").param("ids", "invalid"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.code").value(1));
        verifyNoInteractions(service, tags);
    }

    @Test
    void omittingIdsPreservesTreeParentAndTagLoading() throws Exception {
        var folder = row(10L, null, true, false);
        var file = row(10L, folder.getId(), false, false);
        row(10L, null, false, true);
        row(20L, null, false, false);
        mvc.perform(get("/api/projects/10/files").header("X-Session-Id", "session").param("tree", "true"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.length()").value(2));
        verify(tags).getTagsByFileIds(List.of(folder.getId(), file.getId()));
        clearInvocations(tags);
        mvc.perform(get("/api/projects/10/files").header("X-Session-Id", "session").param("parentId", folder.getId().toString()))
                .andExpect(status().isOk()).andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].id").value(file.getId()));
        verify(tags).getTagsByFileIds(List.of(file.getId()));
    }

    /** 可选合成负载测量；不以受机器负载影响的耗时作为 CI 断言。 */
    @Test
    @org.junit.jupiter.api.condition.EnabledIfSystemProperty(named = "awd.fileLookupBenchmark", matches = "true")
    void benchmarkTenThousandFiles() throws Exception {
        var selected = row(10L, null, false, false);
        jdbc.batchUpdate("INSERT INTO project_file (project_id, is_folder, name, sort_order, user_id, is_deleted) VALUES (10, false, ?, 0, 7, false)",
                java.util.stream.IntStream.range(1, 10000).boxed().toList(), 500,
                (statement, index) -> statement.setString(1, "合同-" + index + ".docx"));
        double[] treeMs = new double[5];
        double[] idsMs = new double[5];
        int treeBytes = 0;
        int idsBytes = 0;
        for (int run = -1; run < 5; run++) {
            entityManager.clear();
            long started = System.nanoTime();
            var treeResponse = mvc.perform(get("/api/projects/10/files").header("X-Session-Id", "session")
                            .param("tree", "true")).andExpect(status().isOk()).andReturn().getResponse();
            if (run >= 0) treeMs[run] = (System.nanoTime() - started) / 1_000_000.0;
            treeBytes = treeResponse.getContentAsByteArray().length;
            entityManager.clear();
            started = System.nanoTime();
            var idsResponse = mvc.perform(get("/api/projects/10/files").header("X-Session-Id", "session")
                            .param("ids", selected.getId().toString())).andExpect(status().isOk()).andReturn().getResponse();
            if (run >= 0) idsMs[run] = (System.nanoTime() - started) / 1_000_000.0;
            idsBytes = idsResponse.getContentAsByteArray().length;
        }
        java.util.Arrays.sort(treeMs);
        java.util.Arrays.sort(idsMs);
        System.out.printf("FILE_LOOKUP_BENCHMARK rows=10000 requested=1 treeMedianMs=%.3f idsMedianMs=%.3f treeBytes=%d idsBytes=%d%n",
                treeMs[2], idsMs[2], treeBytes, idsBytes);
    }
}
