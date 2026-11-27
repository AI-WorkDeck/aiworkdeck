// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.version;

import com.checkba.model.entity.ProjectFile;
import com.checkba.model.entity.User;
import com.checkba.repository.ProjectFileRepository;
import com.checkba.repository.UserRepository;
import com.checkba.service.UserService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDateTime;

import static org.junit.jupiter.api.Assertions.*;

/**
 * C27 (lane C, escalated): a freshly pulled case sat in an open work session that changed only the manifest
 * (「整理了文件结构」), and the next 取回最新稿 was refused until the lawyer discarded "all changes". A session
 * with no lawyer change must not block a pull; a session with real work still must.
 */
@SpringBootTest(properties = {"security.local-mode=false"})
@ActiveProfiles("desktop")
class ManifestOnlySessionTest {
    static Path root;
    private static final String DB_URL = "jdbc:h2:mem:manifest-only-" + System.nanoTime()
            + ";MODE=PostgreSQL;DB_CLOSE_DELAY=-1;DATABASE_TO_LOWER=TRUE;DEFAULT_NULL_ORDERING=HIGH;NON_KEYWORDS=VALUE";

    @DynamicPropertySource
    static void storage(DynamicPropertyRegistry registry) throws Exception {
        root = Files.createTempDirectory("manifest-only");
        registry.add("storage.local.root-path", () -> root.toAbsolutePath().toString());
        registry.add("spring.datasource.url", () -> DB_URL);
    }

    @Autowired WorkSessionService sessions;
    @Autowired ProjectRepoService repos;
    @Autowired ProjectFileRepository files;
    @Autowired UserRepository users;
    @Autowired JdbcTemplate jdbc;

    long seed(long id) throws Exception {
        User u = new User(); u.setUsername("c27_" + id); u.setDisplayName("陆知微"); u.setPassword(UserService.encodePassword("x"));
        u = users.save(u);
        jdbc.update("insert into project (id, name, project_type, listed_company_name, target_company_name, user_id) values (?, ?, ?, ?, ?, ?)",
                id, "c27-" + id, "BLANK", "", "", u.getId());
        Files.createDirectories(root.resolve("projects/" + id));
        Files.writeString(root.resolve("projects/" + id + "/合同.txt"), "初稿");
        ProjectFile f = new ProjectFile();
        f.setProjectId(id); f.setIsFolder(false); f.setName("合同.txt"); f.setSortOrder(0);
        f.setFilePath("projects/" + id + "/合同.txt"); f.setUserId(u.getId()); f.setIsDeleted(false); f.setCreatedAt(LocalDateTime.now());
        files.save(f);
        sessions.enableVersionRecording(id, "陆知微", "a@example.test");
        return u.getId();
    }

    @Test
    void aSessionThatOnlyTouchedTheManifestIsDiscardedBeforeAPull() throws Exception {
        long project = 27001L;
        long user = seed(project);
        // The app's own hidden folder appears (as after opening a freshly pulled case) and an autosave runs.
        ProjectFile stage = new ProjectFile();
        stage.setProjectId(project); stage.setIsFolder(true); stage.setName(".stagezone"); stage.setSortOrder(0);
        stage.setUserId(user); stage.setIsDeleted(false); stage.setCreatedAt(LocalDateTime.now());
        files.save(stage);
        sessions.onChangeSignal(project, user, "陆知微");
        sessions.commitNow(project, user, "陆知微", null);
        assertTrue(sessions.activeSession(project).isPresent(), "the open session that used to block 取回");

        assertTrue(sessions.discardIfManifestOnly(project, user));
        assertTrue(sessions.activeSession(project).isEmpty(), "the pull can go ahead");
        assertEquals("初稿", Files.readString(root.resolve("projects/" + project + "/合同.txt")), "nothing of the lawyer's is touched");
    }

    @Test
    void aSessionWithRealWorkStillBlocks() throws Exception {
        long project = 27002L;
        long user = seed(project);
        Files.writeString(root.resolve("projects/" + project + "/合同.txt"), "律师改过的");
        sessions.onChangeSignal(project, user, "陆知微");
        sessions.commitNow(project, user, "陆知微", null);
        assertFalse(sessions.discardIfManifestOnly(project, user));
        assertTrue(sessions.activeSession(project).isPresent(), "real work is never discarded");
        assertEquals("律师改过的", Files.readString(root.resolve("projects/" + project + "/合同.txt")));
    }
}
