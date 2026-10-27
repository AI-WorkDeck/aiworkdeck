// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service;

import com.checkba.model.entity.Project;
import com.checkba.model.entity.ProjectFile;
import com.checkba.repository.*;
import com.checkba.storage.*;
import com.checkba.version.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.util.ReflectionTestUtils;

import java.io.ByteArrayInputStream;
import java.nio.file.*;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

@DataJpaTest(showSql = false)
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@TestPropertySource(properties = {
        "spring.datasource.url=jdbc:h2:mem:loose-file-test;MODE=PostgreSQL;NON_KEYWORDS=VALUE;DB_CLOSE_DELAY=-1",
        "spring.datasource.driver-class-name=org.h2.Driver", "spring.datasource.username=sa", "spring.datasource.password=",
        "spring.jpa.database-platform=org.hibernate.dialect.H2Dialect", "spring.jpa.hibernate.ddl-auto=create-drop"
})
class LooseFileWorkspaceTest {
    @Autowired ProjectRepository projects;
    @Autowired ProjectFileRepository files;
    @Autowired ProjectMemberRepository members;
    @Autowired org.springframework.transaction.PlatformTransactionManager transactions;
    @TempDir Path temp;
    LocalProjectService service;
    ProjectStorageResolver resolver;
    LocalFileStorageService storage;
    ProjectFileService fileService;
    org.springframework.context.ApplicationEventPublisher events;

    @BeforeEach void setup() {
        StorageProperties properties = new StorageProperties();
        properties.getLocal().setRootPath(temp.resolve("appdata").toString());
        resolver = new ProjectStorageResolver(properties, projects);
        ReflectionTestUtils.setField(resolver, "projectFileRepository", files);
        storage = new LocalFileStorageService(resolver);
        StorageServiceFactory factory = mock(StorageServiceFactory.class);
        when(factory.getStorageService()).thenReturn(storage);
        fileService = new ProjectFileService(files, mock(com.checkba.service.ai.ProjectRagService.class), factory,
                mock(WorkSessionService.class), mock(UserService.class), mock(com.checkba.service.quota.StageQuotaService.class),
                mock(com.checkba.service.telemetry.TelemetryService.class), mock(com.checkba.service.evidence.EvidenceLinkService.class));
        fileService.setStorageResolverForTest(resolver);
        events = mock(org.springframework.context.ApplicationEventPublisher.class);
        service = new LocalProjectService(projects, members, files, fileService, mock(ProjectMemberService.class),
                resolver, events, mock(com.checkba.service.telemetry.TelemetryService.class), transactions);
    }

    Path document(String relative) throws Exception {
        Path file = temp.resolve(relative);
        Files.createDirectories(file.getParent());
        return Files.writeString(file, "original");
    }

    @Test void registersOnlySelectedFilesReusesIdentityAndHandlesSameNameInDifferentFolders() throws Exception {
        Path first = document("a/contract.docx");
        document("a/private.txt");
        document("a/sub/other.pdf");
        Path second = document("b/contract.docx");
        var a = service.openLocalFile(first.toString(), 1L);
        var again = service.openLocalFile(first.getParent().resolve("./contract.docx").toString(), 1L);
        var b = service.openLocalFile(second.toString(), 1L);
        assertEquals(a.project().getId(), b.project().getId());
        assertEquals(a.file().getId(), again.file().getId());
        assertTrue(again.reused());
        assertFalse(a.reused());
        assertNotEquals(a.file().getId(), b.file().getId());
        assertNotEquals(a.file().getFilePath(), b.file().getFilePath());
        assertEquals(2, files.findByProjectId(a.project().getId()).size());
        assertNull(a.project().getLocalRoot());
        assertTrue(a.project().isLooseFileWorkspace());
        assertTrue(a.project().getVersionOptOut());
        assertEquals(1, members.findByProjectId(a.project().getId()).size());
        assertFalse(Files.exists(temp.resolve("a/.awd")));
        verifyNoInteractions(events);
        var otherUser = service.openLocalFile(first.toString(), 2L);
        assertNotEquals(a.project().getId(), otherUser.project().getId());
        assertNotEquals(a.file().getId(), otherUser.file().getId());
    }

    @Test void exactMappingReadsAndSavesOriginalWithoutGrantingSiblingAccess() throws Exception {
        Path original = document("selected/合同.txt");
        Path sibling = document("selected/private.txt");
        var opened = service.openLocalFile(original.toString(), 1L);
        String key = opened.file().getFilePath();
        assertEquals(original.toRealPath(), resolver.resolve(key));
        assertEquals("original", new String(storage.load(key).getInputStream().readAllBytes()));
        storage.save(key, new ByteArrayInputStream("edited".getBytes()));
        assertEquals("edited", Files.readString(original));
        assertEquals("original", Files.readString(sibling));
        assertThrows(StorageException.class, () -> resolver.resolve(key.replace("合同.txt", "private.txt")));
        assertThrows(StorageException.class, () -> resolver.resolve(key + "/../private.txt"));
        assertFalse(Files.exists(resolver.projectRoot(opened.project().getId())));
        String json = new com.fasterxml.jackson.databind.ObjectMapper().findAndRegisterModules().writeValueAsString(opened.file());
        assertFalse(json.contains("externalPath"));
        assertFalse(json.contains(original.toString()));
    }

    @Test void reopeningRefreshesSizeAfterTheOriginalWasChangedElsewhere() throws Exception {
        Path original = document("selected/a.txt");
        var first = service.openLocalFile(original.toString(), 1L);
        assertEquals(Files.size(original), first.file().getFileSize());
        Files.writeString(original, "");
        var reopened = service.openLocalFile(original.toString(), 1L);
        assertTrue(reopened.reused());
        assertEquals(first.file().getId(), reopened.file().getId());
        assertEquals(0L, reopened.file().getFileSize());
        assertEquals(0L, files.findById(first.file().getId()).orElseThrow().getFileSize());
        Files.writeString(original, "a longer external edit");
        assertEquals(Files.size(original), service.openLocalFile(original.toString(), 1L).file().getFileSize());
    }

    @Test void missingOrReboundOriginalCannotBeRecreatedOrRedirected() throws Exception {
        Path original = document("selected/a.txt");
        var opened = service.openLocalFile(original.toString(), 1L);
        String key = opened.file().getFilePath();
        Files.delete(original);
        assertThrows(StorageException.class, () -> storage.load(key));
        assertThrows(StorageException.class, () -> storage.save(key, new ByteArrayInputStream("save".getBytes())));
        assertThrows(StorageException.class, () -> storage.append(key, new ByteArrayInputStream("append".getBytes())));
        assertThrows(StorageException.class, () -> storage.createFromTemplate(key));
        assertThrows(IllegalArgumentException.class, () -> service.openLocalFile(original.toString(), 1L));
        assertFalse(Files.exists(original));
        Path unrelated = document("elsewhere/private.txt");
        Files.createSymbolicLink(original, unrelated);
        assertThrows(StorageException.class, () -> storage.save(key, new ByteArrayInputStream("save".getBytes())));
        assertEquals("original", Files.readString(unrelated));
    }

    @Test void structuralFileOperationsCannotMoveOrDeleteOriginal() throws Exception {
        Path original = document("selected/a.txt");
        var opened = service.openLocalFile(original.toString(), 1L);
        Long id = opened.file().getId();
        String key = opened.file().getFilePath();
        assertThrows(IllegalArgumentException.class, () -> fileService.rename(id, "renamed.txt", 1L));
        assertThrows(IllegalArgumentException.class, () -> fileService.move(id, null, 0, 1L));
        assertThrows(IllegalArgumentException.class, () -> fileService.delete(id, 1L));
        assertThrows(IllegalArgumentException.class, () -> fileService.permDelete(id, 1L));
        assertThrows(IllegalArgumentException.class, () -> fileService.diskPathsForPurge(id));
        assertThrows(StorageException.class, () -> storage.delete(key));
        assertThrows(StorageException.class, () -> storage.move(key, "projects/1/renamed.txt"));
        assertEquals("original", Files.readString(original));
        assertEquals(key, files.findById(id).orElseThrow().getFilePath());
        assertFalse(files.findById(id).orElseThrow().getIsDeleted());
    }

    @Test void interruptedUploadLeavesOriginalAndRemovesTemporaryFile() throws Exception {
        Path original = document("selected/a.txt");
        var opened = service.openLocalFile(original.toString(), 1L);
        for (boolean append : List.of(false, true)) {
            var broken = new java.io.InputStream() {
                int reads;
                public int read() throws java.io.IOException {
                    if (reads++ < 5) return 'x';
                    throw new java.io.IOException("interrupted upload");
                }
            };
            assertThrows(StorageException.class, () -> {
                if (append) storage.append(opened.file().getFilePath(), broken);
                else storage.save(opened.file().getFilePath(), broken);
            });
            assertEquals("original", Files.readString(original));
            try (var children = Files.list(original.getParent())) { assertEquals(1, children.count()); }
        }
    }

    @Test void replacedParentDirectoryCannotRedirectReadsOrSaves() throws Exception {
        Path original = document("selected/a.txt");
        var opened = service.openLocalFile(original.toString(), 1L);
        Path unrelated = document("elsewhere/a.txt");
        Files.move(original.getParent(), temp.resolve("moved"));
        Files.createSymbolicLink(original.getParent(), unrelated.getParent());
        assertThrows(StorageException.class, () -> storage.load(opened.file().getFilePath()));
        assertThrows(StorageException.class, () -> storage.save(opened.file().getFilePath(), new ByteArrayInputStream("save".getBytes())));
        assertEquals("original", Files.readString(unrelated));
        assertEquals("original", Files.readString(temp.resolve("moved/a.txt")));
    }

    @Test void workspaceIsHiddenAndCannotInitializeVersionHistory() throws Exception {
        var opened = service.openLocalFile(document("selected/a.txt").toString(), 1L);
        ProjectService projectService = new ProjectService(projects, members, null, files, null, null, null, null,
                resolver, null, null, null, null, events);
        assertEquals(List.of(), projectService.getUserProjects(1L));
        ProjectRepoService repo = new ProjectRepoService(resolver);
        assertThrows(VersionException.class, () -> repo.init(opened.project().getId(), "user", "u@example.com"));
        assertThrows(VersionException.class, () -> repo.initEmptyForReceive(opened.project().getId()));
        assertThrows(VersionException.class, () -> repo.cloneFromRemote(opened.project().getId(), "unused", null, null));
        var manifest = mock(ProjectTreeManifestService.class);
        var sessions = new WorkSessionService(repo, manifest, mock(WorkSessionRepository.class),
                new org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler(), files, events);
        assertThrows(VersionException.class, () -> sessions.enableVersionRecording(opened.project().getId(), "user", "u@example.com"));
        verifyNoInteractions(manifest);
        opened.project().setVersionOptOut(false);
        var lifecycle = new VersionLifecycleService(sessions, repo, projects, mock(UserRepository.class),
                mock(ProjectRemoteRepository.class), Runnable::run);
        lifecycle.onAutoEnableRequest(new WorkSessionService.AutoEnableRequest(opened.project().getId(), 1L, "user"));
        assertFalse(repo.isInitialized(opened.project().getId()));
        assertThrows(VersionException.class, () -> lifecycle.clearOptOut(opened.project().getId()));
        assertFalse(Files.exists(repo.gitDir(opened.project().getId())));
        assertFalse(Files.exists(repo.workTree(opened.project().getId())));
    }

    @Test void rejectsDirectoriesRelativePathsUnsupportedTypesAndInternalData() throws Exception {
        assertThrows(IllegalArgumentException.class, () -> service.openLocalFile(temp.toString(), 1L));
        assertThrows(IllegalArgumentException.class, () -> service.openLocalFile("relative.txt", 1L));
        assertThrows(IllegalArgumentException.class, () -> service.openLocalFile(document("run.exe").toString(), 1L));
        assertThrows(IllegalArgumentException.class, () -> service.openLocalFile(document("appdata/internal.txt").toString(), 1L));
        assertEquals(0, projects.count());
    }
}
