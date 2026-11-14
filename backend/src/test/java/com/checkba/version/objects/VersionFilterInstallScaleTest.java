// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.version.objects;

import com.checkba.storage.StorageProperties;
import com.checkba.version.ProjectRepoService;
import org.eclipse.jgit.lib.Config;
import org.eclipse.jgit.lib.Repository;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.*;

/**
 * /version/status 每 15 秒一次，每次 open 都会 VersionObjectFilters.install：
 * 此前逐条 setString 建每文件过滤器配置是 O(n²)，2000 个文件单次 1 秒多。
 * 改为一次 fromText 后，配置内容必须与原来逐条写入完全一致，且同一仓库重复 install 不叠段。
 */
class VersionFilterInstallScaleTest {

    @Test
    void perPathFiltersAreConfiguredOncePerPathAndOpenStaysFastAt2000Files(@TempDir Path root) throws Exception {
        StorageProperties props = new StorageProperties();
        props.getLocal().setRootPath(root.toString());
        ProjectRepoService service = new ProjectRepoService(new com.checkba.storage.ProjectStorageResolver(props, null));
        Path work = root.resolve("projects/9");
        for (int d = 0; d < 20; d++) {
            Path dir = Files.createDirectories(work.resolve("dir-" + d));
            for (int f = 0; f < 100; f++) Files.writeString(dir.resolve("file-" + f + ".txt"), "x" + d + "-" + f);
        }
        service.init(9, "Tester", "tester@example.test");
        service.commitAll(9, "seed", "auto", null, "Tester", "tester@example.test");

        try (Repository repo = service.open(9)) {
            Config config = repo.getConfig();
            long perPath = config.getSubsections("filter").stream().filter(n -> n.startsWith("awd-path-")).count();
            assertEquals(2000, perPath, "one filter section per tracked file");
            String name = config.getSubsections("filter").stream().filter(n -> n.startsWith("awd-path-")).findFirst().orElseThrow();
            assertEquals("jgit://awd/" + name + "/clean", config.getString("filter", name, "clean"));
            assertEquals("jgit://awd/" + name + "/smudge", config.getString("filter", name, "smudge"));
            assertTrue(config.getBoolean("filter", name, "required", false));
            assertEquals("jgit://awd/clean", config.getString("filter", "awd-content", "clean"));
            assertEquals("jgit://awd/media", config.getString("filter", "awd-media", "clean"));
            // 同一仓库对象再 install 一次：不叠出第二份段
            VersionObjectFilters.install(repo, null, 9, Long.MAX_VALUE);
            assertEquals(1, config.getStringList("filter", name, "clean").length);
            assertEquals(2000, config.getSubsections("filter").stream().filter(n -> n.startsWith("awd-path-")).count());
        }
        assertTrue(service.pendingChanges(9).isEmpty());

        // 量级守卫（防回到 O(n²)）：本机改后 23ms、改前 225ms；上限 150ms 给 CI 留余量
        long best = Long.MAX_VALUE;
        for (int i = 0; i < 5; i++) {
            long t = System.nanoTime();
            service.pendingChanges(9);
            best = Math.min(best, (System.nanoTime() - t) / 1_000_000);
        }
        assertTrue(best < 150, "pendingChanges on 2000 files took " + best + " ms");
    }

    @Test
    void stripsOnlyAwdFilterSections() {
        String text = "[core]\n\tbare = false\n[filter \"awd-content\"]\n\tclean = jgit://awd/clean\n"
                + "[filter \"lfs\"]\n\tclean = git-lfs clean\n[filter \"awd-path-abc\"]\n\tclean = x\n[user]\n\tname = T\n";
        String out = VersionObjectFilters.withoutAwdFilters(text);
        assertTrue(out.contains("[core]") && out.contains("[filter \"lfs\"]") && out.contains("git-lfs clean") && out.contains("[user]"), out);
        assertFalse(out.contains("awd-content") || out.contains("awd-path-abc"), out);
    }
}
