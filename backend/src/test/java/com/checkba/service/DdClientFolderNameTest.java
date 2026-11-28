// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service;

import com.checkba.model.entity.DdItem;
import com.checkba.model.entity.DdRequest;
import com.checkba.model.entity.ProjectFile;
import com.checkba.repository.DdCommentRepository;
import com.checkba.repository.DdItemRepository;
import com.checkba.repository.DdRequestRepository;
import com.checkba.repository.ProjectFileRepository;
import com.checkba.storage.StorageService;
import com.checkba.storage.StorageServiceFactory;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.TestPropertySource;

import java.util.List;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * C31（dev-board#1867）：客户上传的根文件夹写死成「客户提供的文件」，繁中和英文律师的案卷里
 * 也是一个简体中文文件夹。新案卷按**律师建清单时**的界面语言起名（案件库上每个请求按
 * X-App-Language 定语言，客户上传时的语言是客户的，不能拿来给律师的案卷起名）；
 * 已有的根文件夹（任何一个已知名字）一律沿用：不改名、不另建（X44 同一条规矩）。
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@TestPropertySource(properties = {
        "spring.datasource.url=jdbc:h2:mem:dd-client-folder-name;MODE=PostgreSQL;NON_KEYWORDS=VALUE;DB_CLOSE_DELAY=-1",
        "spring.datasource.driver-class-name=org.h2.Driver",
        "spring.datasource.username=sa",
        "spring.datasource.password=",
        "spring.jpa.database-platform=org.hibernate.dialect.H2Dialect",
        "spring.jpa.hibernate.ddl-auto=create-drop"
})
class DdClientFolderNameTest {

    @Autowired private ProjectFileRepository files;
    @Autowired private DdRequestRepository requests;
    @Autowired private DdItemRepository items;
    private DdService dd;

    @BeforeEach
    void setUp() {
        StorageServiceFactory storage = mock(StorageServiceFactory.class);
        when(storage.getStorageService()).thenReturn(mock(StorageService.class));
        ProjectFileService pfs = mock(ProjectFileService.class);
        when(pfs.createFolderQuietly(anyLong(), any(), anyString(), anyLong())).thenAnswer(inv -> {
            ProjectFile f = new ProjectFile();
            f.setProjectId(inv.getArgument(0));
            f.setParentId(inv.getArgument(1));
            f.setName(inv.getArgument(2));
            f.setIsFolder(true);
            f.setIsDeleted(false);
            f.setUserId(inv.getArgument(3));
            f.setSortOrder(0);
            return files.save(f);
        });
        dd = new DdService(requests, items, mock(DdCommentRepository.class), files, pfs, storage);
        dd.self = dd;
    }

    private List<ProjectFile> roots(long projectId) {
        return files.findByProjectId(projectId).stream()
                .filter(f -> f.getParentId() == null && Boolean.TRUE.equals(f.getIsFolder())).toList();
    }

    private DdRequest createAs(String lang, long projectId) {
        AtomicReference<DdRequest> out = new AtomicReference<>();
        AppLanguageScope.run(lang, () -> out.set(dd.createRequest(projectId, "尽调清单", "营业执照", 9L)));
        return out.get();
    }

    private ProjectFile uploadAs(String lang, DdRequest req) {
        DdItem item = items.findByDdRequestIdOrderBySortOrderAsc(req.getId()).get(0);
        AtomicReference<ProjectFile> out = new AtomicReference<>();
        AppLanguageScope.run(lang, () -> {
            try {
                out.set(dd.storeAttachment(item.getId(),
                        new MockMultipartFile("file", "license.pdf", "application/pdf", new byte[]{1}), 9L));
            } catch (Exception e) { throw new RuntimeException(e); }
        });
        return out.get();
    }

    @Test
    void aNewCaseGetsTheRootInTheLawyersLanguage() {
        createAs("en-US", 41L);
        assertEquals(List.of("Client materials"), roots(41L).stream().map(ProjectFile::getName).toList());
        createAs("zh-TW", 42L);
        assertEquals(List.of("客戶提供的檔案"), roots(42L).stream().map(ProjectFile::getName).toList());
        createAs("zh-CN", 43L);
        assertEquals(List.of("客户提供的文件"), roots(43L).stream().map(ProjectFile::getName).toList());
    }

    @Test
    void theClientsPortalLanguageNeverNamesTheLawyersFolder() {
        DdRequest req = createAs("en-US", 44L);
        ProjectFile stored = uploadAs("zh-TW", req);
        assertEquals(List.of("Client materials"), roots(44L).stream().map(ProjectFile::getName).toList());
        assertTrue(stored.getFilePath().startsWith("projects/44/Client materials/"), stored.getFilePath());
    }

    @Test
    void anExistingRootIsNeverRenamedNorDuplicated() {
        ProjectFile legacy = new ProjectFile();
        legacy.setProjectId(45L); legacy.setName("客户提供的文件"); legacy.setIsFolder(true);
        legacy.setIsDeleted(false); legacy.setUserId(9L); legacy.setSortOrder(0);
        files.save(legacy);

        DdRequest req = createAs("en-US", 45L);
        ProjectFile stored = uploadAs("en-US", req);
        assertEquals(List.of("客户提供的文件"), roots(45L).stream().map(ProjectFile::getName).toList());
        assertTrue(stored.getFilePath().startsWith("projects/45/客户提供的文件/"), stored.getFilePath());
    }
}
