// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.version;

import com.checkba.service.LocalProjectService;
import com.checkba.storage.ProjectStorageResolver;
import org.junit.jupiter.api.BeforeAll;
import org.eclipse.jgit.lib.Constants;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

/**
 * 教程问题 16（dev-board#1713）：「打开文件夹」导入的项目，第一次退出时弹「N 个文件待提交」。
 * 修法：导入完成后在仓库锁内同步建基线，初始版本 = 导入后的全量；超过护栏时不开，沿用现有提示。
 * 本地字节齐全时断言紧跟在 openLocalFolder 返回之后、不等待异步触发点；
 * iCloud 占位文件则先下载并暂缓基线，不能让版本初始化阻塞打开项目。
 */
@SpringBootTest(properties = {
        "spring.datasource.url=jdbc:h2:mem:local-import-baseline;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DEFAULT_NULL_ORDERING=HIGH;NON_KEYWORDS=VALUE;DB_CLOSE_DELAY=-1",
        "storage.local.root-path=target/test-storage-local-import-baseline"
})
@ActiveProfiles("desktop")
class LocalFolderImportBaselineTest {

    @Autowired private LocalProjectService localProjectService;
    @Autowired private ProjectRepoService repoService;
    @Autowired private WorkSessionService sessionService;
    @Autowired private VersionLifecycleService lifecycleService;

    /** 内存库每轮从 id=1 重发，上一轮留在固定存储根里的 repos/project-N.git 必须先清掉（同 VersionAutoEnableTest）。 */
    @BeforeAll
    static void clearStorageRoot() throws IOException {
        Path dir = ProjectStorageResolver.resolveConfiguredPath("target/test-storage-local-import-baseline");
        if (!Files.isDirectory(dir)) return;
        try (java.util.stream.Stream<Path> walk = Files.walk(dir)) {
            walk.sorted(java.util.Comparator.reverseOrder()).forEach(p -> {
                try { Files.deleteIfExists(p); } catch (IOException ignored) { }
            });
        }
    }

    @Test
    void openingAFolderCommitsTheImportedContentAsTheInitialVersion(@TempDir Path folder) throws Exception {
        Files.writeString(folder.resolve("合同.docx"), "x");
        Files.createDirectories(folder.resolve("证据"));
        Files.writeString(folder.resolve("证据/聊天记录.txt"), "y");

        long projectId = localProjectService.openLocalFolder(folder.toString(), false, null, null, 9100L)
                .project().getId();

        assertTrue(repoService.isInitialized(projectId), "返回时就应已建好初始版本");
        assertTrue(repoService.listPaths(projectId, "HEAD").contains("证据/聊天记录.txt"));
        assertEquals(0, sessionService.exitStatus(projectId).changedCount(),
                "刚导入的文件不能算待提交");
    }

    /**
     * D26（11-24 polish audit）：真实形态的案卷目录（真 docx、二进制 xlsx/pdf/pptx、子目录、
     * Finder 留下的 .DS_Store）刚打开、一个字都没改时，待提交必须是 0——状态栏不能说
     * 「3 个文件待提交」，否则律师会以为软件改了他的文件。
     */
    @Test
    void aRealisticUntouchedMatterFolderHasNothingPending(@TempDir Path folder) throws Exception {
        Path fixtures = Path.of("..", "fixtures");
        Files.copy(fixtures.resolve("evidence-demo-1076/01-购销合同.docx"), folder.resolve("01-购销合同.docx"));
        Files.copy(fixtures.resolve("contracts/with-revisions.docx"), folder.resolve("with-revisions.docx"));
        byte[] binary = new byte[64 * 1024];
        new java.util.Random(26).nextBytes(binary);
        Files.write(folder.resolve("fee-ledger.xlsx"), binary);
        Files.write(folder.resolve("hearing-bundle.pdf"), binary);
        Files.createDirectories(folder.resolve("证据/扫描件"));
        Files.write(folder.resolve("证据/扫描件/receipt.pdf"), binary);
        Files.write(folder.resolve("slides.pptx"), binary);
        Files.writeString(folder.resolve(".DS_Store"), "finder");

        long projectId = localProjectService.openLocalFolder(folder.toString(), false, null, null, 9100L)
                .project().getId();

        assertTrue(repoService.isInitialized(projectId));
        assertEquals(0, sessionService.exitStatus(projectId).changedCount(),
                "an untouched folder must show 0 files awaiting commit right after opening");
        assertTrue(sessionService.pendingChangesLocked(projectId).stream().allMatch(c -> c.path().startsWith(".awd/")),
                () -> "unexpected pending changes: " + sessionService.pendingChangesLocked(projectId));
    }

    @Test
    void datalessFilesDeferBaselineWithoutBlockingFolderOpen(@TempDir Path folder) throws Exception {
        Files.writeString(folder.resolve("合同.docx"), "x");
        ICloudFileMaterializer materializer = mock(ICloudFileMaterializer.class);
        doThrow(VersionException.userFacing("iCloud files are still downloading"))
                .when(materializer).requireLocalBytes(any());
        repoService.setICloudFileMaterializerForTest(materializer);
        try {
            long projectId = localProjectService.openLocalFolder(folder.toString(), false, null, null, 9100L)
                    .project().getId();

            assertTrue(projectId > 0);
            try (var repo = repoService.open(projectId)) {
                assertNull(repo.resolve(Constants.HEAD), "未下载文件不能进入 JGit 读取阶段");
            }
            verify(materializer).requireLocalBytes(folder);
        } finally {
            repoService.setICloudFileMaterializerForTest(new ICloudFileMaterializer());
        }
    }

    @Test
    void oversizedFolderIsNotBaselinedAndOpenStillSucceeds(@TempDir Path folder) throws Exception {
        for (int i = 0; i < 3; i++) Files.writeString(folder.resolve("卷宗" + i + ".txt"), "x".repeat(200));
        lifecycleService.setGuardrailForTest(100L, 20000);
        try {
            long projectId = localProjectService.openLocalFolder(folder.toString(), false, null, null, 9100L)
                    .project().getId();
            assertFalse(repoService.isInitialized(projectId), "超过护栏不自动开启，版本面板沿用现有提示");
        } finally {
            lifecycleService.setGuardrailForTest(2L * 1024 * 1024 * 1024, 20000);
        }
    }
}
