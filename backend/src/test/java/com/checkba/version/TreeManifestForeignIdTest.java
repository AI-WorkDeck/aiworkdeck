// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.version;

import com.checkba.model.entity.ProjectFile;
import com.checkba.repository.ProjectFileRepository;
import com.checkba.repository.ProjectRepository;
import com.checkba.repository.UserRepository;
import com.checkba.storage.ProjectStorageResolver;
import com.checkba.storage.StorageProperties;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.persistence.EntityManager;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;

import java.nio.file.Path;
import java.time.LocalDateTime;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.Mockito.mock;

/**
 * 清单节点 id 不在本项目、却恰好是别的项目的行时，新建节点必须插入新行，
 * 不能借 merge 把那一行改写到本项目名下（真实 JPA/H2，Hibernate 6.6）。
 */
@DataJpaTest
class TreeManifestForeignIdTest {

    @Autowired private ProjectFileRepository repo;
    @Autowired private EntityManager em;

    @Test
    void manifestIdOwnedByAnotherProjectCreatesANewRow(@TempDir Path root) {
        ProjectFile victim = new ProjectFile();
        victim.setProjectId(1L); victim.setName("别人的合同.docx"); victim.setUserId(1L);
        victim.setIsFolder(false); victim.setIsDeleted(false); victim.setSortOrder(0);
        victim.setFilePath("projects/1/别人的合同.docx"); victim.setCreatedAt(LocalDateTime.now());
        long victimId = repo.saveAndFlush(victim).getId();
        em.clear();

        StorageProperties props = new StorageProperties();
        props.getLocal().setRootPath(root.toAbsolutePath().toString());
        var svc = new ProjectTreeManifestService(repo,
                new ProjectRepoService(new ProjectStorageResolver(props, null)), new ObjectMapper(),
                mock(UserRepository.class), mock(ProjectRepository.class));
        var report = svc.applyToDatabase(2L, new TreeManifest(1, List.of(new TreeManifest.Node(
                victimId, null, "新文件.docx", false, "docx", 0, "projects/2/新文件.docx", false, 2L,
                null, null, null, null))));
        repo.flush();
        em.clear();

        assertEquals(1, report.created());
        ProjectFile untouched = repo.findById(victimId).orElseThrow();
        assertEquals(1L, untouched.getProjectId(), "别的项目的行不许被改到本项目名下");
        assertEquals("别人的合同.docx", untouched.getName());
        assertEquals(List.of("新文件.docx"), repo.findByProjectId(2L).stream().map(ProjectFile::getName).toList());
    }
}
