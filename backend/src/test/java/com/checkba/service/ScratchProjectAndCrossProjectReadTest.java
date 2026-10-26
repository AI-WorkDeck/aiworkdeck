// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service;

import com.checkba.model.entity.Project;
import com.checkba.model.entity.ProjectFile;
import com.checkba.model.entity.ProjectMember;
import com.checkba.repository.ProjectFileRepository;
import com.checkba.repository.ProjectMemberRepository;
import com.checkba.repository.ProjectRepository;
import com.checkba.service.ai.context.ProjectContextHolder;
import com.checkba.service.ai.tools.FileTools;
import com.checkba.service.ai.tools.LegalTools;
import com.checkba.service.ai.tools.ToolFileGuard;
import com.checkba.service.file.ProjectFileTextExtractor;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.TestPropertySource;

import java.time.LocalDateTime;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

@DataJpaTest(showSql = false)
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@TestPropertySource(properties = {
        "spring.datasource.url=jdbc:h2:mem:scratch-cross-test;MODE=PostgreSQL;NON_KEYWORDS=VALUE;DB_CLOSE_DELAY=-1",
        "spring.datasource.driver-class-name=org.h2.Driver", "spring.datasource.username=sa", "spring.datasource.password=",
        "spring.jpa.database-platform=org.hibernate.dialect.H2Dialect", "spring.jpa.hibernate.ddl-auto=create-drop"
})
class ScratchProjectAndCrossProjectReadTest {

    @Autowired ProjectRepository projects;
    @Autowired ProjectFileRepository files;
    @Autowired ProjectMemberRepository members;

    ProjectService projectService;
    ProjectMemberService memberServiceAllow;
    ProjectMemberService memberServiceDeny;

    @BeforeEach
    void setup() {
        projectService = new ProjectService(projects, members, null, files, null, null, null, null,
                null, null, null, null, null, mock(org.springframework.context.ApplicationEventPublisher.class));
        memberServiceAllow = mock(ProjectMemberService.class);
        when(memberServiceAllow.hasReadPermission(anyLong(), anyLong())).thenReturn(true);
        memberServiceDeny = mock(ProjectMemberService.class);
        when(memberServiceDeny.hasReadPermission(anyLong(), anyLong())).thenReturn(false);
    }

    @AfterEach
    void clearContext() {
        ProjectContextHolder.clear();
    }

    private Project persistProject(Long userId, String type, String name) {
        Project p = new Project();
        p.setName(name);
        p.setProjectType(type);
        p.setListedCompanyName("");
        p.setTargetCompanyName("");
        p.setUserId(userId);
        p.setCreatedAt(LocalDateTime.now());
        p.setUpdatedAt(p.getCreatedAt());
        return projects.save(p);
    }

    private ProjectFile persistFile(Long projectId, String name) {
        ProjectFile f = new ProjectFile();
        f.setProjectId(projectId);
        f.setUserId(1L);
        f.setName(name);
        f.setFileType("txt");
        f.setIsFolder(false);
        f.setIsDeleted(false);
        f.setSortOrder(0);
        f.setFilePath(name);
        f.setCreatedAt(LocalDateTime.now());
        return files.save(f);
    }

    @Test
    void scratchProjectIsIdempotentHiddenAndAdminBacked() {
        Project first = projectService.getOrCreateScratchProject(7L);
        assertTrue(first.isScratchWorkspace());
        assertTrue(first.getVersionOptOut());
        assertEquals("ADMIN", members.findByProjectId(first.getId()).get(0).getRole());

        Project second = projectService.getOrCreateScratchProject(7L);
        assertEquals(first.getId(), second.getId());

        persistProject(7L, "BLANK", "visible");
        assertTrue(projectService.getUserProjects(7L).stream().noneMatch(Project::isScratchWorkspace));
        assertTrue(projectService.getUserProjects(7L).stream().noneMatch(Project::isLooseFileWorkspace));
    }

    @Test
    void promoteConvertsScratchInPlaceAndFreshScratchIsRecreated() {
        Project scratch = projectService.getOrCreateScratchProject(8L);
        Project promoted = projectService.promoteScratchProject(scratch.getId(), "转正项目", "BLANK", 8L);
        assertEquals("BLANK", promoted.getProjectType());
        assertEquals("转正项目", promoted.getName());
        assertFalse(promoted.getVersionOptOut());
        assertEquals(promoted.getId(), scratch.getId());
        assertTrue(projectService.getUserProjects(8L).stream().anyMatch(p -> p.getId().equals(promoted.getId())));

        Project fresh = projectService.getOrCreateScratchProject(8L);
        assertNotEquals(promoted.getId(), fresh.getId());
        assertTrue(fresh.isScratchWorkspace());

        assertThrows(IllegalArgumentException.class,
                () -> projectService.promoteScratchProject(promoted.getId(), "再次转正", "BLANK", 8L));
        assertThrows(IllegalArgumentException.class,
                () -> projectService.promoteScratchProject(fresh.getId(), "x", "BLANK", 999L));
    }

    @Test
    void readGuardAllowsCrossProjectWithPermissionWhileWriteGuardStillRejects() {
        ProjectFile cross = new ProjectFile();
        cross.setId(555L);
        cross.setProjectId(2L);

        ProjectContextHolder.setProjectId("1");
        ProjectContextHolder.setUserId(9L);

        assertNull(ToolFileGuard.rejectIfCannotRead(cross, memberServiceAllow));
        assertNotNull(ToolFileGuard.rejectIfCannotRead(cross, memberServiceDeny));
        assertNotNull(ToolFileGuard.rejectIfCannotRead(cross, null));
        assertNotNull(ToolFileGuard.rejectIfOutsideProject(cross));

        ProjectFile own = new ProjectFile();
        own.setId(556L);
        own.setProjectId(1L);
        assertNull(ToolFileGuard.rejectIfOutsideProject(own));
        assertNull(ToolFileGuard.rejectIfCannotRead(own, null));
    }

    @Test
    void extractFileTextAndReadDocumentHonorReadPermission() throws Exception {
        Long currentProjectId = persistProject(9L, "BLANK", "当前项目").getId();
        Long otherProjectId = persistProject(9L, "BLANK", "另一项目").getId();
        ProjectFile crossFile = persistFile(otherProjectId, "跨项目合同.txt");

        ProjectContextHolder.setProjectId(String.valueOf(currentProjectId));
        ProjectContextHolder.setUserId(9L);

        ProjectFileTextExtractor extractor = mock(ProjectFileTextExtractor.class);
        when(extractor.extractText(any(ProjectFile.class))).thenReturn("正文内容");

        FileTools fileTools = new FileTools(mock(ProjectFileService.class), files, null, null,
                null, null, null, null, extractor);
        LegalTools legalTools = new LegalTools(mock(ProjectFileService.class), null, extractor);
        legalTools.setProjectMemberService(memberServiceAllow);

        ProjectFileService fileServiceAllow = mock(ProjectFileService.class);
        when(fileServiceAllow.getFile(crossFile.getId())).thenReturn(crossFile);
        FileTools fileToolsAllow = new FileTools(fileServiceAllow, files, null, null,
                null, null, null, null, extractor);
        fileToolsAllow.setProjectMemberService(memberServiceAllow);

        ProjectFileService fileServiceDeny = mock(ProjectFileService.class);
        when(fileServiceDeny.getFile(crossFile.getId())).thenReturn(crossFile);
        FileTools fileToolsDeny = new FileTools(fileServiceDeny, files, null, null,
                null, null, null, null, extractor);
        fileToolsDeny.setProjectMemberService(memberServiceDeny);

        LegalTools legalAllow = new LegalTools(fileServiceAllow, null, extractor);
        legalAllow.setProjectMemberService(memberServiceAllow);
        LegalTools legalDeny = new LegalTools(fileServiceDeny, null, extractor);
        legalDeny.setProjectMemberService(memberServiceDeny);

        String allowed = fileToolsAllow.extract_file_text(crossFile.getId());
        assertTrue(allowed.contains("正文内容"), allowed);

        String denied = fileToolsDeny.extract_file_text(crossFile.getId());
        assertTrue(denied.startsWith("Error"), denied);

        String legalOk = legalAllow.read_document(String.valueOf(crossFile.getId()));
        assertTrue(legalOk.contains("正文内容"), legalOk);

        String legalNo = legalDeny.read_document(String.valueOf(crossFile.getId()));
        assertTrue(legalNo.startsWith("Error"), legalNo);
    }

    @Test
    void searchAcrossProjectsFindsMatchingFilesInReadableProjects() {
        Long projectId = persistProject(11L, "BLANK", "检索项目").getId();
        ProjectFile hit = persistFile(projectId, "股权代持协议.txt");
        persistFile(projectId, "无关文件.txt");

        ProjectContextHolder.setUserId(11L);

        ProjectFileTextExtractor extractor = mock(ProjectFileTextExtractor.class);
        FileTools fileTools = new FileTools(mock(ProjectFileService.class), files, null, null,
                null, null, null, null, extractor);
        fileTools.setProjectService(projectService);

        String result = fileTools.search_across_projects("代持");
        assertTrue(result.contains("[项目: 检索项目 (projectId=" + projectId + ")]"), result);
        assertTrue(result.contains("(fileId=" + hit.getId() + ", type=txt)"), result);
        assertFalse(result.contains("无关文件"));

        assertEquals("Error: keyword is required.", fileTools.search_across_projects(" "));
        assertTrue(fileTools.search_across_projects("绝不存在的关键字")
                .startsWith("No files matching "));
    }
}
