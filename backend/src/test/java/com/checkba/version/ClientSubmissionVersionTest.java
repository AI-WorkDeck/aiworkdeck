// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.version;

import com.checkba.model.entity.ProjectFile;
import com.checkba.model.entity.User;
import com.checkba.repository.ProjectFileRepository;
import com.checkba.repository.UserRepository;
import com.checkba.service.UserService;
import org.eclipse.jgit.api.Git;
import org.eclipse.jgit.diff.DiffEntry;
import org.eclipse.jgit.revwalk.RevCommit;
import org.eclipse.jgit.treewalk.CanonicalTreeParser;
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
import java.util.ArrayList;
import java.util.List;
import java.util.stream.StreamSupport;

import static org.junit.jupiter.api.Assertions.*;

/**
 * C23 (lane C 2026-11-26, plan approved by the CEO): a client's portal upload became part of a work session
 * in the client's name, which swept in other pending server state; lawyers then saw 「星禾科技 王经理改了 1 处」
 * on 第四条 of their contract. The CEO's required test: the client's version never absorbs unrelated pending
 * server state, is its own commit labelled as a client submission, and opens no work session.
 */
@SpringBootTest(properties = {"security.local-mode=false"})
@ActiveProfiles("desktop")
class ClientSubmissionVersionTest {
    static Path root;
    private static final String DB_URL = "jdbc:h2:mem:client-submission-test-" + System.nanoTime()
            + ";MODE=PostgreSQL;DB_CLOSE_DELAY=-1;DATABASE_TO_LOWER=TRUE;DEFAULT_NULL_ORDERING=HIGH;NON_KEYWORDS=VALUE";

    @DynamicPropertySource
    static void storageRoot(DynamicPropertyRegistry registry) throws Exception {
        root = Files.createTempDirectory("client-submission-test");
        registry.add("storage.local.root-path", () -> root.toAbsolutePath().toString());
        registry.add("spring.datasource.url", () -> DB_URL);
    }

    @Autowired WorkSessionService sessions;
    @Autowired ProjectRepoService repos;
    @Autowired ProjectFileRepository files;
    @Autowired UserRepository users;
    @Autowired JdbcTemplate jdbc;

    private void seed(long projectId) throws Exception {
        User owner = new User();
        owner.setUsername("partner_" + projectId);
        owner.setDisplayName("沈砚");
        owner.setPassword(UserService.encodePassword("x"));
        owner = users.save(owner);
        jdbc.update("insert into project (id, name, project_type, listed_company_name, target_company_name, user_id) values (?, ?, ?, ?, ?, ?)",
                projectId, "C23-" + projectId, "BLANK", "", "", owner.getId());
        Files.createDirectories(root.resolve("projects/" + projectId));
        Files.writeString(root.resolve("projects/" + projectId + "/买卖合同.txt"), "第四条 原文");
        ProjectFile f = new ProjectFile();
        f.setProjectId(projectId); f.setIsFolder(false); f.setName("买卖合同.txt"); f.setSortOrder(0);
        f.setFilePath("projects/" + projectId + "/买卖合同.txt"); f.setUserId(owner.getId()); f.setIsDeleted(false);
        f.setCreatedAt(LocalDateTime.now());
        files.save(f);
        sessions.enableVersionRecording(projectId, "沈砚", "partner@example.test");
    }

    private static List<String> changedPaths(Git git, RevCommit commit) throws Exception {
        var reader = git.getRepository().newObjectReader();
        CanonicalTreeParser now = new CanonicalTreeParser(); now.reset(reader, commit.getTree());
        CanonicalTreeParser before = new CanonicalTreeParser(); before.reset(reader, commit.getParent(0).getTree());
        List<String> paths = new ArrayList<>();
        for (DiffEntry e : git.diff().setOldTree(before).setNewTree(now).call())
            paths.add(e.getChangeType() == DiffEntry.ChangeType.DELETE ? e.getOldPath() : e.getNewPath());
        return paths;
    }

    @Test
    void clientVersionNeverAbsorbsPendingServerStateAndOpensNoSession() throws Exception {
        long project = 23001L;
        seed(project);
        // A lawyer change is pending on the server (not yet a version).
        Files.writeString(root.resolve("projects/" + project + "/买卖合同.txt"), "第四条 律师改过的");
        // The client's file is already written where the tree shows it.
        Path upload = root.resolve("projects/" + project + "/客户提供的文件/尽职调查资料清单/证据1-送货单.pdf");
        Files.createDirectories(upload.getParent());
        Files.write(upload, new byte[]{1, 2, 3});

        sessions.recordClientSubmission(project, List.of("客户提供的文件/尽职调查资料清单/证据1-送货单.pdf"),
                "星禾科技 王经理", "送货单原件扫描件");

        assertTrue(sessions.activeSession(project).isEmpty(), "a client upload never opens a work session");
        try (var repo = repos.open(project); Git git = new Git(repo)) {
            List<RevCommit> log = StreamSupport.stream(git.log().setMaxCount(3).call().spliterator(), false).toList();
            RevCommit client = log.get(0), docked = log.get(1);

            assertEquals("星禾科技 王经理", client.getAuthorIdent().getName());
            assertTrue(client.getShortMessage().contains("证据1-送货单.pdf"), client.getFullMessage());
            assertTrue(client.getShortMessage().startsWith("客户提交了材料"), client.getFullMessage());
            assertTrue(client.getFullMessage().contains("X-AWD-Kind: client-submission"), client.getFullMessage());
            List<String> clientPaths = changedPaths(git, client);
            assertTrue(clientPaths.contains("客户提供的文件/尽职调查资料清单/证据1-送货单.pdf"), clientPaths.toString());
            assertTrue(clientPaths.stream().allMatch(p -> p.startsWith("客户提供的文件/") || p.startsWith(".awd/")),
                    "the client's version touches only its own files and the manifest: " + clientPaths);

            assertNotEquals("星禾科技 王经理", docked.getAuthorIdent().getName(), "the lawyer's pending change is never the client's");
            assertTrue(changedPaths(git, docked).contains("买卖合同.txt"), "the pending lawyer change was docked separately first");
        }
        assertTrue(repos.pendingChanges(project).isEmpty(), "nothing left behind");
    }
}
