// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.version.cloud;

import com.checkba.model.entity.User;
import com.checkba.repository.UserRepository;
import com.checkba.service.UserService;
import com.checkba.storage.ProjectStorageResolver;
import com.checkba.storage.StorageProperties;
import com.checkba.version.ProjectRepoService;
import com.checkba.version.WorkSessionService;
import org.eclipse.jgit.api.Git;
import org.eclipse.jgit.lib.ObjectId;
import org.eclipse.jgit.transport.RefSpec;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.*;

/**
 * C12 + lane W review: the case server's own working copy with a local-only object. Ingest, restore and merge
 * share one rule (declared objects are skipped, not missing); the missing file is never read as a deletion (so
 * no autosave drops it from history and no empty autosave rejects the next push, cf. #1761); a stale older copy
 * is removed; when the object arrives later, the server materializes it.
 */
@SpringBootTest(properties = {"security.local-mode=false"})
@ActiveProfiles("desktop")
class LocalOnlyServerCopyTest {
    static Path root;
    private static final String DB_URL = "jdbc:h2:mem:local-only-server-" + System.nanoTime()
            + ";MODE=PostgreSQL;DB_CLOSE_DELAY=-1;DATABASE_TO_LOWER=TRUE;DEFAULT_NULL_ORDERING=HIGH;NON_KEYWORDS=VALUE";

    @DynamicPropertySource
    static void storage(DynamicPropertyRegistry registry) throws Exception {
        root = Files.createTempDirectory("local-only-server");
        registry.add("storage.local.root-path", () -> root.toAbsolutePath().toString());
        registry.add("spring.datasource.url", () -> DB_URL);
    }

    @Autowired ProjectRepoService repos;
    @Autowired WorkSessionService sessions;
    @Autowired ProjectObjectPlanService plans;
    @Autowired UserRepository users;
    @Autowired JdbcTemplate jdbc;

    long seedServer(long id) {
        User u = new User(); u.setUsername("srv_" + id); u.setDisplayName("srv"); u.setPassword(UserService.encodePassword("x"));
        u = users.save(u);
        jdbc.update("insert into project (id, name, project_type, listed_company_name, target_company_name, user_id) values (?, ?, ?, ?, ?, ?)",
                id, "c12-" + id, "BLANK", "", "", u.getId());
        repos.initEmptyForReceive(id);
        return u.getId();
    }

    static void writeMedia(Path file, int seed) throws Exception {
        try (var out = Files.newOutputStream(file)) {
            byte[] block = new byte[64 * 1024];
            new java.util.Random(seed).nextBytes(block);
            for (int i = 0; i < 40; i++) out.write(block);
        }
    }

    String receive(ProjectRepoService sender, long server, boolean withObjects) throws Exception {
        if (withObjects)
            for (var ref : sender.objects().list(1))
                try (InputStream in = sender.objects().open(1, ref.sha256())) { repos.objects().put(server, in); }
        try (var repo = repos.open(server); Git git = new Git(repo)) {
            git.fetch().setRemote(sender.gitDir(1).toUri().toString())
                    .setRefSpecs(new RefSpec("+refs/heads/master:refs/heads/master")).call();
            return repo.resolve("refs/heads/master").name();
        }
    }

    @Test
    void localOnlyObjectIsSkippedNeverReadAsDeletedAndMaterializedOnArrival(@TempDir Path machines) throws Exception {
        long server = 12101L;
        long sharer = seedServer(server);
        var props = new StorageProperties(); props.getLocal().setRootPath(machines.resolve("sender").toString());
        ProjectRepoService sender = new ProjectRepoService(new ProjectStorageResolver(props, null));
        Files.createDirectories(sender.workTree(1));
        Path media = sender.workTree(1).resolve("庭审录像.mp4");
        writeMedia(media, 7);
        Files.writeString(sender.workTree(1).resolve("说明.txt"), "第一版");
        sender.init(1, "Synthetic", "s@example.test");
        var video = sender.objects().list(1).get(0);

        // The sharer declares the recording local-only; its bytes never reach the library.
        plans.declareLocalOnly(server, video, sharer, "庭审录像.mp4");
        String first = receive(sender, server, false);
        sessions.ingestPushedMainline(server, ObjectId.zeroId().name(), first);
        Path serverWork = root.resolve("projects/" + server);
        assertEquals("第一版", Files.readString(serverWork.resolve("说明.txt")), "the rest of the version materializes");
        assertFalse(Files.exists(serverWork.resolve("庭审录像.mp4")), "no file for a local-only object");
        assertEquals(java.util.List.of(), repos.pendingChanges(server), "a local-only file is not a deletion");
        String before = repos.resolveRef(server, "master");
        sessions.dockDirtyMainlineForReceive(server);
        assertEquals(before, repos.resolveRef(server, "master"), "no autosave, so the next push is not rejected");
        repos.requireObjectsAt(server, first); // restore/merge share the rule: declared is not missing

        // A later edit to another file still ingests cleanly, and committing keeps the pointer in history.
        Files.writeString(sender.workTree(1).resolve("说明.txt"), "第二版");
        sender.commitAll(1, "edit", "auto", null, "Synthetic", "s@example.test");
        String second = receive(sender, server, false);
        sessions.ingestPushedMainline(server, first, second);
        assertEquals("第二版", Files.readString(serverWork.resolve("说明.txt")));
        assertEquals(java.util.List.of(), repos.pendingChanges(server));
        Files.writeString(serverWork.resolve("备注.txt"), "服务端的另一处改动");
        assertNotNull(repos.commitAll(server, "server edit", "auto", null, "AI WorkDeck", "system@aiworkdeck.local"));
        assertTrue(repos.objectPointersAt(server, "HEAD", false).contains(video), "the server's commit kept the local-only pointer");

        // The sharer turns on backup later: the object arrives and the server copy gets the file.
        try (InputStream in = sender.objects().open(1, video.sha256())) { repos.objects().put(server, in); }
        plans.markComplete(server, video);
        repos.materializeArrivedObject(server, video);
        assertEquals(-1, Files.mismatch(media, serverWork.resolve("庭审录像.mp4")));
        assertFalse(plans.isDeclaredLocalOnly(server, video));
        assertEquals(java.util.List.of(), repos.pendingChanges(server));
    }

    @Test
    void aLocalOnlyReplacementRemovesTheStaleServerCopy(@TempDir Path machines) throws Exception {
        long server = 12102L;
        long sharer = seedServer(server);
        var props = new StorageProperties(); props.getLocal().setRootPath(machines.resolve("sender").toString());
        ProjectRepoService sender = new ProjectRepoService(new ProjectStorageResolver(props, null));
        Files.createDirectories(sender.workTree(1));
        Path media = sender.workTree(1).resolve("录像.mp4");
        writeMedia(media, 1);
        sender.init(1, "Synthetic", "s@example.test");
        String first = receive(sender, server, true); // v1 was shared normally
        sessions.ingestPushedMainline(server, ObjectId.zeroId().name(), first);
        Path serverCopy = root.resolve("projects/" + server + "/录像.mp4");
        assertTrue(Files.exists(serverCopy));

        writeMedia(media, 2); // re-exported recording, kept local-only this time
        sender.commitAll(1, "re-export", "auto", null, "Synthetic", "s@example.test");
        var v2 = sender.objectPointersAt(1, "HEAD", false).get(0);
        plans.declareLocalOnly(server, v2, sharer, "录像.mp4");
        String second = receive(sender, server, false);
        sessions.ingestPushedMainline(server, first, second);
        assertFalse(Files.exists(serverCopy), "old bytes are never shown as the current version");
        assertEquals(java.util.List.of(), repos.pendingChanges(server));
    }
}
