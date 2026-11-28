// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.version;

import com.checkba.model.entity.Project;
import com.checkba.model.entity.ProjectFile;
import com.checkba.repository.ProjectFileRepository;
import com.checkba.repository.ProjectRepository;
import com.checkba.repository.UserRepository;
import com.checkba.storage.StorageProperties;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

/**
 * C33（dev-board#1866）：文件在提交里、却不在 .awd/tree.json（库里没有行）时，托管项目的
 * 克隆 / 取回照清单建树，这份文件在新设备的文件树里永远看不见。取回后按 HEAD 里实际跟踪的
 * 文件补行：只补缺的、不复活回收站里的、不碰 .awd/ 等内部文件、本机文件夹项目不管（对账会补）。
 */
class TrackedFilesIndexTest {

    private static final long PID = 7L;
    private Map<Long, ProjectFile> db;
    private long nextId;
    private ProjectRepoService repoService;
    private ProjectRepository projects;
    private ProjectTreeManifestService svc;
    private Project project;

    @BeforeEach
    void setUp(@TempDir Path root) throws Exception {
        db = new HashMap<>();
        nextId = 100L;
        ProjectFileRepository repo = mock(ProjectFileRepository.class);
        when(repo.findByProjectId(PID)).thenAnswer(i -> new ArrayList<>(db.values()));
        when(repo.save(any(ProjectFile.class))).thenAnswer(i -> {
            ProjectFile p = i.getArgument(0);
            if (p.getId() == null) p.setId(nextId++);
            db.put(p.getId(), p);
            return p;
        });
        StorageProperties props = new StorageProperties();
        props.getLocal().setRootPath(root.toAbsolutePath().toString());
        repoService = new ProjectRepoService(new com.checkba.storage.ProjectStorageResolver(props, null));
        projects = mock(ProjectRepository.class);
        project = new Project();
        project.setId(PID);
        project.setUserId(1L);
        when(projects.findById(PID)).thenAnswer(i -> Optional.of(project));
        svc = new ProjectTreeManifestService(repo, repoService, new ObjectMapper(), mock(UserRepository.class), projects);

        repoService.init(PID, "陆知微", "assoc@example.test");
        Path work = repoService.workTree(PID);
        write(work.resolve("已登记.txt"), "a");
        write(work.resolve("证据/送货单.txt"), "b");          // 在提交里、库里没有行（C33 的形态）
        write(work.resolve("回收站里的.txt"), "c");            // 库里有行但已软删：不能被复活
        write(work.resolve(".awd/tree.json"), "{}");           // 内部文件：永不进文件树
        repoService.commitAll(PID, "测试", "auto", null, "陆知微", "assoc@example.test");

        row(null, "已登记.txt", false, "projects/7/已登记.txt", false);
        row(null, "回收站里的.txt", false, "projects/7/回收站里的.txt", true);
    }

    private static void write(Path p, String s) throws Exception {
        Files.createDirectories(p.getParent());
        Files.writeString(p, s, StandardCharsets.UTF_8);
    }

    private ProjectFile row(Long parentId, String name, boolean folder, String path, boolean deleted) {
        ProjectFile p = new ProjectFile();
        p.setProjectId(PID); p.setParentId(parentId); p.setName(name); p.setIsFolder(folder);
        p.setFilePath(path); p.setIsDeleted(deleted); p.setUserId(1L); p.setSortOrder(0);
        p.setId(nextId++);
        db.put(p.getId(), p);
        return p;
    }

    private List<ProjectFile> named(String name) {
        return db.values().stream().filter(p -> name.equals(p.getName())).toList();
    }

    @Test
    void aTrackedFileWithNoRowGetsOneAfterPull() {
        assertEquals(1, svc.indexTrackedFilesMissingFromTree(PID, "HEAD"));

        ProjectFile folder = named("证据").get(0);
        assertTrue(folder.getIsFolder());
        assertNull(folder.getParentId());
        ProjectFile file = named("送货单.txt").get(0);
        assertFalse(file.getIsFolder());
        assertEquals(folder.getId(), file.getParentId());
        assertEquals("projects/7/证据/送货单.txt", file.getFilePath());
        assertEquals("txt", file.getFileType());
        assertEquals(1L, file.getUserId(), "the owner, never someone else");
        assertFalse(Boolean.TRUE.equals(file.getIsDeleted()));
    }

    @Test
    void trashedRowsAreNotRevivedAndInternalFilesNeverIndexed() {
        svc.indexTrackedFilesMissingFromTree(PID, "HEAD");
        assertEquals(1, named("回收站里的.txt").size());
        assertTrue(named("回收站里的.txt").get(0).getIsDeleted(), "the lawyer's delete stands");
        assertTrue(named("tree.json").isEmpty());
        assertTrue(named(".awd").isEmpty());
    }

    @Test
    void runningItTwiceAddsNothing() {
        svc.indexTrackedFilesMissingFromTree(PID, "HEAD");
        int rows = db.size();
        assertEquals(0, svc.indexTrackedFilesMissingFromTree(PID, "HEAD"));
        assertEquals(rows, db.size());
    }

    @Test
    void aLocalFolderProjectIsLeftToItsOwnReconcile() {
        project.setLocalRoot("/Users/lawyer/案卷");
        assertEquals(0, svc.indexTrackedFilesMissingFromTree(PID, "HEAD"));
        assertTrue(named("送货单.txt").isEmpty());
    }
}
