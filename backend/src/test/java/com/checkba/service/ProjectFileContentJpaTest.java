// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service;

import com.checkba.model.entity.Project;
import com.checkba.model.entity.ProjectFile;
import com.checkba.model.entity.ProjectMember;
import com.checkba.model.entity.User;
import com.checkba.repository.*;
import com.checkba.service.mobile.CloudStorageQuotaService;
import com.checkba.storage.*;
import com.checkba.version.*;
import jakarta.persistence.EntityManager;
import jakarta.persistence.EntityManagerFactory;
import jakarta.persistence.PersistenceContext;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.orm.jpa.EntityManagerHolder;
import org.springframework.scheduling.TaskScheduler;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDateTime;
import java.util.UUID;
import java.util.concurrent.*;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** Real OSIV persistence context, separate committed transactions, real H2 rows and local disk. */
@DataJpaTest(showSql = false)
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@TestPropertySource(properties = {
        "spring.datasource.url=jdbc:h2:mem:content-coordination;MODE=PostgreSQL;NON_KEYWORDS=VALUE;DB_CLOSE_DELAY=-1",
        "spring.datasource.driver-class-name=org.h2.Driver", "spring.datasource.username=sa", "spring.datasource.password=",
        "spring.jpa.database-platform=org.hibernate.dialect.H2Dialect", "spring.jpa.hibernate.ddl-auto=create-drop"
})
@Transactional(propagation = Propagation.NOT_SUPPORTED)
class ProjectFileContentJpaTest {
    @Autowired ProjectRepository projects;
    @Autowired ProjectFileRepository files;
    @Autowired ProjectMemberRepository memberships;
    @Autowired UserRepository users;
    @Autowired PlatformTransactionManager transactions;
    @Autowired EntityManagerFactory entityManagerFactory;
    @PersistenceContext EntityManager entityManager;
    @TempDir Path directory;
    private ProjectFileContentService content;
    private ProjectMemberService members;
    private WorkSessionService sessions;
    private LocalFileStorageService storage;
    private CloudStorageQuotaService quota;
    private ProjectFile file;
    private Project project;
    private User owner;
    private User actor;
    private Path original;
    private TransactionTemplate transaction;

    @BeforeEach void prepare() throws Exception {
        transaction = new TransactionTemplate(transactions);
        transaction.executeWithoutResult(status -> {
            owner = user("owner"); actor = user("actor");
            project = new Project(); project.setName("content"); project.setProjectType("BLANK");
            project.setListedCompanyName(""); project.setTargetCompanyName(""); project.setUserId(owner.getId());
            project = projects.saveAndFlush(project);
            ProjectMember member = new ProjectMember(); member.setProjectId(project.getId());
            member.setUserId(actor.getId()); member.setRole("PARTICIPANT"); memberships.saveAndFlush(member);
            file = new ProjectFile(); file.setProjectId(project.getId()); file.setUserId(owner.getId());
            file.setName("note.txt"); file.setFileType("txt"); file.setIsFolder(false); file.setSortOrder(0);
            file.setFilePath("projects/" + project.getId() + "/note.txt"); file.setFileSize(3L);
            file = files.saveAndFlush(file);
        });
        StorageProperties properties = new StorageProperties(); properties.getLocal().setRootPath(directory.toString());
        var resolver = new ProjectStorageResolver(properties, projects);
        ReflectionTestUtils.setField(resolver, "projectFileRepository", files);
        storage = spy(new LocalFileStorageService(resolver));
        storage.save(file.getFilePath(), new ByteArrayInputStream("old".getBytes(StandardCharsets.UTF_8)));
        original = resolver.resolve(file.getFilePath());
        var factory = mock(StorageServiceFactory.class); when(factory.getStorageService()).thenReturn(storage);
        members = new ProjectMemberService(memberships, users, projects, mock(ProjectInvitationRepository.class));
        var access = new ProjectFileAccessService(members, users, files);
        var repo = mock(ProjectRepoService.class);
        sessions = new WorkSessionService(repo, mock(ProjectTreeManifestService.class), mock(WorkSessionRepository.class),
                mock(TaskScheduler.class), files, event -> {});
        quota = mock(CloudStorageQuotaService.class);
        content = new ProjectFileContentService(files, factory, members, access, resolver, sessions, transactions, quota);
        ReflectionTestUtils.setField(content, "entityManager", entityManager);
    }

    private User user(String name) {
        User value = new User(); value.setUsername(name + UUID.randomUUID()); value.setDisplayName(name);
        value.setPassword("test-only"); value.setRole("USER"); return users.saveAndFlush(value);
    }

    @Test void pathChangedWhileReceivingUsesFreshPathDespiteOsivCache() throws Exception {
        Path renamed = original.resolveSibling("renamed.txt");
        withOsiv(() -> {
            preflight(actor.getId());
            var result = upload(actor.getId(), () -> {
                try { Files.move(original, renamed); } catch (Exception e) { throw new RuntimeException(e); }
                ProjectFile current = files.findById(file.getId()).orElseThrow();
                current.setFilePath("projects/" + project.getId() + "/renamed.txt"); files.saveAndFlush(current);
            });
            assertEquals("projects/" + project.getId() + "/renamed.txt", result.path());
            assertFalse(Files.exists(original)); assertEquals("new content", Files.readString(renamed));
        });
    }

    @Test void membershipRevokedWhileReceivingIsDeniedDespiteCachedRole() throws Exception {
        withOsiv(() -> {
            preflight(actor.getId());
            var failure = assertThrows(ProjectFileContentService.ContentWriteException.class, () -> upload(actor.getId(), () -> {
                var member = memberships.findByProjectIdAndUserId(project.getId(), actor.getId()).orElseThrow();
                member.setRole("READ_ONLY"); memberships.saveAndFlush(member);
            }));
            assertEquals(403, failure.status()); assertEquals("old", Files.readString(original));
        });
    }

    @Test void globalClientRoleChangedWhileReceivingIsDeniedDespiteCachedUser() throws Exception {
        withOsiv(() -> {
            preflight(owner.getId());
            var failure = assertThrows(ProjectFileContentService.ContentWriteException.class, () -> upload(owner.getId(), () -> {
                var current = users.findById(owner.getId()).orElseThrow(); current.setRole("CLIENT"); users.saveAndFlush(current);
            }));
            assertEquals(403, failure.status()); assertEquals("old", Files.readString(original));
        });
    }

    @Test void ownerChangedWhileReceivingIsDeniedDespiteCachedProject() throws Exception {
        withOsiv(() -> {
            preflight(owner.getId());
            var failure = assertThrows(ProjectFileContentService.ContentWriteException.class, () -> upload(owner.getId(), () -> {
                var current = projects.findById(project.getId()).orElseThrow(); current.setUserId(actor.getId()); projects.saveAndFlush(current);
            }));
            assertEquals(403, failure.status()); assertEquals("old", Files.readString(original));
        });
    }

    @Test void metadataUpdateCannotOverwriteAConcurrentMoveOrDeletion() throws Exception {
        doAnswer(invocation -> {
            Object result = invocation.callRealMethod();
            inOtherTransaction(() -> {
                var current = files.findById(file.getId()).orElseThrow();
                current.setFilePath("projects/" + project.getId() + "/moved.txt");
                current.setIsDeleted(true); files.saveAndFlush(current);
            });
            return result;
        }).when(storage).save(eq(file.getFilePath()), any());
        var result = upload(actor.getId(), () -> {});
        assertTrue(result.complete(), "published bytes retain the existing best-effort metadata response");
        ProjectFile current = files.findById(file.getId()).orElseThrow();
        assertTrue(current.getIsDeleted()); assertTrue(current.getFilePath().endsWith("/moved.txt"));
        assertEquals(3L, current.getFileSize()); assertEquals("new content", Files.readString(original));
    }

    @Test void quotaOwnerLockSurvivesPublicationAndTransactionEndsBeforeUnlock() throws Exception {
        ReflectionTestUtils.setField(content, "subscriptionQuotaEnabled", true);
        doAnswer(invocation -> {
            assertTrue(TransactionSynchronizationManager.isActualTransactionActive());
            users.lockStorageOwner(owner.getId()).orElseThrow();
            return null;
        }).when(quota).requireFileCapacity(any(), anyLong(), anyBoolean());
        CountDownLatch publishing = new CountDownLatch(1), release = new CountDownLatch(1), otherOwnerAcquired = new CountDownLatch(1);
        doAnswer(invocation -> {
            assertTrue(TransactionSynchronizationManager.isActualTransactionActive());
            publishing.countDown(); assertTrue(release.await(5, TimeUnit.SECONDS)); return invocation.callRealMethod();
        }).when(storage).save(eq(file.getFilePath()), any());
        var pool = Executors.newFixedThreadPool(2);
        try {
            Future<?> writer = pool.submit(() -> { try { upload(actor.getId(), () -> {}); } catch (Exception e) { throw new RuntimeException(e); } });
            assertTrue(publishing.await(3, TimeUnit.SECONDS));
            Future<?> other = pool.submit(() -> transaction.executeWithoutResult(status -> {
                users.lockStorageOwner(owner.getId()).orElseThrow(); otherOwnerAcquired.countDown();
            }));
            assertFalse(otherOwnerAcquired.await(200, TimeUnit.MILLISECONDS));
            release.countDown(); writer.get(5, TimeUnit.SECONDS); other.get(5, TimeUnit.SECONDS);
            assertEquals(11L, files.findById(file.getId()).orElseThrow().getFileSize());
            sessions.withFileContentWriteLock(project.getId(), () -> {
                assertFalse(TransactionSynchronizationManager.isActualTransactionActive()); return null;
            });
        } finally { release.countDown(); pool.shutdownNow(); }
    }

    @Test void existingTransactionIsRejectedBeforeReceivingOrAcquiringRepoLock() {
        transaction.executeWithoutResult(status -> {
            assertThrows(IllegalStateException.class, () -> content.upload(file.getId(), project.getId(), actor.getId(),
                    new ByteArrayInputStream(new byte[0]), 0, null, true, null));
        });
        assertEquals("old", assertDoesNotThrow(() -> Files.readString(original)));
    }

    @Test void permissionRevokedWhileWaitingForQuotaOwnerLockCannotPublish() throws Exception {
        quotaWaitChange(() -> {
            var current = memberships.findByProjectIdAndUserId(project.getId(), actor.getId()).orElseThrow();
            current.setRole("READ_ONLY"); memberships.saveAndFlush(current);
        }, 403);
    }

    @Test void mustExistIsRecheckedAfterQuotaWaitRefreshesTheFilePath() throws Exception {
        quotaWaitChange(() -> {
            var current = files.findById(file.getId()).orElseThrow();
            current.setFilePath("projects/" + project.getId() + "/missing.txt"); files.saveAndFlush(current);
        }, 409);
        assertFalse(Files.exists(original.resolveSibling("missing.txt")));
    }

    @Test void ownerChangedDuringQuotaWaitCannotSpendThePreviousOwnersAllowance() throws Exception {
        quotaWaitChange(() -> {
            var current = projects.findById(project.getId()).orElseThrow();
            current.setUserId(actor.getId()); projects.saveAndFlush(current);
        }, 400);
    }

    private void quotaWaitChange(Runnable change, int expectedStatus) throws Exception {
        ReflectionTestUtils.setField(content, "subscriptionQuotaEnabled", true);
        CountDownLatch ownerHeld = new CountDownLatch(1), releaseOwner = new CountDownLatch(1), quotaWaiting = new CountDownLatch(1);
        doAnswer(invocation -> {
            quotaWaiting.countDown(); users.lockStorageOwner(owner.getId()).orElseThrow();
            entityManager.refresh(invocation.getArgument(0)); // Same refresh as CloudStorageQuotaService.
            return null;
        }).when(quota).requireFileCapacity(any(), anyLong(), anyBoolean());
        var pool = Executors.newFixedThreadPool(2);
        try {
            Future<?> holder = pool.submit(() -> transaction.executeWithoutResult(status -> {
                users.lockStorageOwner(owner.getId()).orElseThrow(); ownerHeld.countDown();
                try { assertTrue(releaseOwner.await(5, TimeUnit.SECONDS)); } catch (InterruptedException e) { throw new RuntimeException(e); }
            }));
            assertTrue(ownerHeld.await(3, TimeUnit.SECONDS));
            Future<Throwable> writer = pool.submit(() -> {
                try { upload(actor.getId(), () -> {}); return null; }
                catch (Throwable error) { return error; }
            });
            assertTrue(quotaWaiting.await(3, TimeUnit.SECONDS));
            inOtherTransaction(change);
            releaseOwner.countDown(); holder.get(3, TimeUnit.SECONDS);
            Throwable failure = writer.get(5, TimeUnit.SECONDS);
            assertInstanceOf(ProjectFileContentService.ContentWriteException.class, failure);
            assertEquals(expectedStatus, ((ProjectFileContentService.ContentWriteException) failure).status());
            assertEquals("old", Files.readString(original));
        } finally { releaseOwner.countDown(); pool.shutdownNow(); }
    }

    private void preflight(Long userId) {
        assertTrue(members.hasWritePermission(project.getId(), userId));
        assertEquals(file.getFilePath(), files.findById(file.getId()).orElseThrow().getFilePath());
    }
    private ProjectFileContentService.UploadResult upload(Long userId, Runnable change) throws Exception {
        byte[] bytes = "new content".getBytes(StandardCharsets.UTF_8);
        var input = new java.io.InputStream() {
            private final ByteArrayInputStream source = new ByteArrayInputStream(bytes);
            private boolean changed;
            private void changeOnce() { if (!changed) { changed = true; inOtherTransaction(change); } }
            public int read() { changeOnce(); return source.read(); }
            public int read(byte[] target, int offset, int length) {
                changeOnce(); return source.read(target, offset, length);
            }
        };
        return content.upload(file.getId(), project.getId(), userId, input, bytes.length, null, true, null);
    }
    private void inOtherTransaction(Runnable change) {
        var pool = Executors.newSingleThreadExecutor();
        try {
            pool.submit(() -> transaction.executeWithoutResult(status -> change.run())).get(5, TimeUnit.SECONDS);
        } catch (Exception e) { throw new RuntimeException(e); }
        finally { pool.shutdownNow(); }
    }
    private interface Checked { void run() throws Exception; }
    private void withOsiv(Checked body) throws Exception {
        EntityManager osiv = entityManagerFactory.createEntityManager();
        TransactionSynchronizationManager.bindResource(entityManagerFactory, new EntityManagerHolder(osiv));
        try { body.run(); }
        finally { TransactionSynchronizationManager.unbindResource(entityManagerFactory); osiv.close(); }
    }
}
