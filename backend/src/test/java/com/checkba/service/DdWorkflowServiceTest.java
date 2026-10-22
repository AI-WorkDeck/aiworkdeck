// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service;

import com.checkba.model.entity.*;
import com.checkba.repository.*;
import com.checkba.storage.StorageException;
import com.checkba.storage.StorageService;
import com.checkba.storage.StorageServiceFactory;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.event.ApplicationEvents;
import org.springframework.test.context.event.RecordApplicationEvents;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.io.InputStream;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** Real database transactions exercise history, locking, retries and storage rollback. */
@DataJpaTest(showSql = false, properties = {
        "spring.datasource.url=jdbc:h2:mem:dd-workflow;MODE=PostgreSQL;NON_KEYWORDS=VALUE;DB_CLOSE_DELAY=-1;LOCK_TIMEOUT=10000",
        "spring.datasource.driver-class-name=org.h2.Driver",
        "spring.jpa.database-platform=org.hibernate.dialect.H2Dialect",
        "spring.jpa.hibernate.ddl-auto=create-drop"
})
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@Import({DdWorkflowService.class, DdService.class, DdWorkflowServiceTest.Config.class})
@Transactional(propagation = Propagation.NOT_SUPPORTED)
@RecordApplicationEvents
class DdWorkflowServiceTest {
    @TestConfiguration static class Config {
        @Bean ObjectMapper objectMapper() { return new ObjectMapper().findAndRegisterModules(); }
    }
    @Autowired DdWorkflowService workflow;
    @Autowired DdService ddService;
    @Autowired DdRequestRepository requests;
    @Autowired DdItemRepository items;
    @Autowired DdSubmissionRepository submissions;
    @Autowired DdNotificationRepository notifications;
    @Autowired DdCommentRepository comments;
    @Autowired ProjectFileRepository files;
    @Autowired ProjectMemberRepository members;
    @Autowired ProjectRepository projects;
    @Autowired ApplicationEvents events;
    @Autowired org.springframework.transaction.PlatformTransactionManager transactionManager;
    @jakarta.persistence.PersistenceContext jakarta.persistence.EntityManager entityManager;
    @MockBean ProjectMemberService permissions;
    @MockBean ProjectFileAccessService access;
    @MockBean ProjectFileService fileService;
    @MockBean StorageServiceFactory storageFactory;
    StorageService storage;
    Map<String, byte[]> objects;
    long projectId, requestId, itemId;
    static final long LAWYER = 11L, CLIENT = 22L, READER = 33L;

    @BeforeEach void setup() throws Exception {
        notifications.deleteAll(); comments.deleteAll(); submissions.deleteAll(); items.deleteAll(); requests.deleteAll();
        files.deleteAll(); members.deleteAll(); projects.deleteAll();
        Project project = new Project(); project.setName("合成尽调测试"); project.setProjectType("TEST");
        project.setUserId(LAWYER); project.setListedCompanyName("甲公司"); project.setTargetCompanyName("乙公司");
        projectId = projects.save(project).getId();
        addMember(CLIENT, "CLIENT"); addMember(READER, "READ_ONLY");
        when(permissions.hasReadPermission(eq(projectId), anyLong())).thenAnswer(i -> Set.of(LAWYER, CLIENT, READER).contains(i.getArgument(1)));
        when(permissions.hasWritePermission(projectId, LAWYER)).thenReturn(true);
        when(access.isClient(projectId, CLIENT)).thenReturn(true);
        DdRequest request = ddService.createRequest(projectId, "第一轮清单", "营业执照", LAWYER);
        requestId = request.getId(); itemId = ddService.getItems(requestId).get(0).getId();
        objects = new ConcurrentHashMap<>(); storage = mock(StorageService.class);
        when(storageFactory.getStorageService()).thenReturn(storage);
        doAnswer(i -> {
            String key = i.getArgument(0); objects.put(key, ((InputStream) i.getArgument(1)).readAllBytes()); return key;
        }).when(storage).save(anyString(), any());
        doAnswer(i -> { objects.remove(i.getArgument(0)); return null; }).when(storage).delete(anyString());
        when(fileService.createFolder(anyLong(), any(), anyString(), anyLong())).thenAnswer(i -> {
            ProjectFile folder = new ProjectFile(); folder.setProjectId(i.getArgument(0)); folder.setParentId(i.getArgument(1));
            folder.setName(i.getArgument(2)); folder.setUserId(i.getArgument(3)); folder.setIsFolder(true); folder.setSortOrder(0);
            return files.save(folder);
        });
    }

    void addMember(long userId, String role) {
        ProjectMember member = new ProjectMember(); member.setProjectId(projectId); member.setUserId(userId); member.setRole(role); members.save(member);
    }
    MockMultipartFile file(String contents) {
        return new MockMultipartFile("files", "营业执照.pdf", "application/pdf", contents.getBytes(java.nio.charset.StandardCharsets.UTF_8));
    }
    void publish(boolean ai) { workflow.publish(requestId, ai, LAWYER); }
    DdSubmission submit(String key, boolean consent) throws Exception { return workflow.submit(itemId, List.of(file("合成材料")), key, consent, CLIENT); }
    void status(int code, org.junit.jupiter.api.function.Executable action) {
        assertEquals(code, assertThrows(ResponseStatusException.class, action).getStatusCode().value());
    }

    @Test void legacyMigrationCanStagePrivateDraftButClientCannot() throws Exception {
        status(403, () -> workflow.uploadLegacy(itemId, file("不应保存"), CLIENT));
        DdItem staged = workflow.uploadLegacy(itemId, file("迁入原件"), LAWYER);
        assertNull(staged.getCurrentSubmissionId()); assertEquals(0, submissions.count());
        assertEquals(0, notifications.count());
        workflow.review(itemId, "APPROVED", null, null, null, LAWYER);
        publish(false);
        DdItem published = items.findById(itemId).orElseThrow();
        assertNotNull(published.getCurrentSubmissionId());
        assertEquals("APPROVED", submissions.findById(published.getCurrentSubmissionId()).orElseThrow().getReviewStatus());
    }

    @Test void prepareLegacyMaterialsCreatesOneVersionWithoutPublishingOrNotifying() throws Exception {
        DdItem legacy = workflow.uploadLegacy(itemId, file("迁入原件"), LAWYER);
        Long fileId = legacy.getUploadedFileId();
        workflow.review(itemId, "APPROVED", null, null, null, LAWYER);
        long previousRevision = items.findById(itemId).orElseThrow().getRevision();
        status(403, () -> workflow.prepareMaterials(requestId, CLIENT));
        status(403, () -> workflow.prepareMaterials(requestId, READER));
        assertEquals(0, submissions.count());
        workflow.prepareMaterials(requestId, LAWYER);
        workflow.prepareMaterials(requestId, LAWYER);

        DdRequest draft = requests.findById(requestId).orElseThrow();
        assertEquals("DRAFT", draft.getStatus());
        assertNull(draft.getPublishedAt()); assertNull(draft.getPublishedBy());
        assertFalse(Boolean.TRUE.equals(draft.getAiReviewEnabled()));
        assertEquals(0, notifications.count());
        assertEquals(0, events.stream(DdSubmissionCreated.class).count());
        assertTrue(workflow.visibleRequests(projectId, CLIENT).isEmpty());
        status(403, () -> workflow.requireVisibleItem(itemId, CLIENT));
        assertEquals(1, submissions.count());
        DdItem prepared = items.findById(itemId).orElseThrow();
        assertEquals(previousRevision + 1, prepared.getRevision());
        assertEquals(fileId, prepared.getUploadedFileId());
        DdSubmission preserved = submissions.findById(prepared.getCurrentSubmissionId()).orElseThrow();
        assertEquals(1, preserved.getVersion());
        assertEquals("APPROVED", preserved.getReviewStatus());
        assertEquals("MANUAL_REQUIRED", preserved.getAiStatus());
        assertEquals(List.of(fileId), preserved.getFileIds());
        assertEquals(LAWYER, preserved.getSubmittedBy());
        assertEquals(1, objects.size());
        String key = files.findById(fileId).orElseThrow().getFilePath();
        assertArrayEquals("迁入原件".getBytes(java.nio.charset.StandardCharsets.UTF_8), objects.get(key));
    }

    @Test void draftIsPrivateAndPublicationIsIdempotentWithOneNotification() {
        assertTrue(workflow.visibleRequests(projectId, CLIENT).isEmpty());
        status(403, () -> workflow.requireVisibleItem(itemId, CLIENT));
        status(409, () -> submit("draft", false));
        status(403, () -> workflow.publish(requestId, false, READER));
        publish(true); publish(true);
        assertEquals(1, workflow.visibleRequests(projectId, CLIENT).size());
        assertEquals(1, workflow.inbox(projectId, CLIENT).size());
        DdNotification notification = workflow.inbox(projectId, CLIENT).get(0);
        status(404, () -> workflow.markRead(notification.getId(), LAWYER));
        assertNotNull(workflow.markRead(notification.getId(), CLIENT).getReadAt());
        assertTrue(requests.findById(requestId).orElseThrow().getAiReviewEnabled());
    }

    @Test void readonlyCannotSubmitExplainCommentOrReviewEvenIfAccountIsClient() {
        publish(true);
        when(access.isClient(projectId, READER)).thenReturn(true);
        status(403, () -> workflow.submit(itemId, List.of(file("x")), "r", true, READER));
        status(403, () -> workflow.explain(itemId, "UNAVAILABLE", "缺失", "r", READER));
        status(403, () -> workflow.comment(itemId, "x", READER));
        status(403, () -> workflow.review(itemId, "APPROVED", null, null, null, READER));
        assertEquals(0, submissions.count()); assertTrue(objects.isEmpty());
    }

    @Test void twoAttachmentsAndRetryPreserveBytesAndHistory() throws Exception {
        publish(false);
        DdSubmission first = workflow.submit(itemId, List.of(file("第一页"), file("第二页")), "retry", false, CLIENT);
        DdSubmission retry = workflow.submit(itemId, List.of(file("第一页"), file("第二页")), "retry", false, CLIENT);
        assertEquals(first.getId(), retry.getId()); assertEquals(2, first.getFileIds().size()); assertEquals(2, objects.size());
        status(409, () -> workflow.submit(itemId, List.of(file("不同内容")), "retry", false, CLIENT));
        DdSubmission second = submit("new", false);
        assertEquals(2, second.getVersion()); assertEquals(2, workflow.history(itemId, CLIENT).size());
        assertEquals(3, objects.size());
        var metadata = (List<?>) workflow.history(itemId, CLIENT).get(1).get("files");
        assertEquals(2, metadata.size());
        assertEquals(first.getFileIds().get(0), workflow.submissionFile(itemId, first.getId(), first.getFileIds().get(0), CLIENT).getId());
        status(403, () -> workflow.submissionFile(itemId, first.getId(), second.getFileIds().get(0), CLIENT));
    }

    @Test void replacingLegacyUploadRetainsOriginalInVersionHistory() throws Exception {
        ddService.uploadFile(itemId, file("旧版原件"), CLIENT);
        Long original = items.findById(itemId).orElseThrow().getUploadedFileId();
        publish(false);
        DdSubmission replacement = submit("replacement", false);
        assertEquals(2, replacement.getVersion());
        assertEquals(List.of(original), submissions.findByItemIdOrderByVersionDesc(itemId).get(1).getFileIds());
        assertEquals(2, objects.size());
    }

    @Test void consentRequiresBothLawyerAndUploader() throws Exception {
        publish(true);
        assertEquals("MANUAL_REQUIRED", submit("no-consent", false).getAiStatus());
        assertEquals(0, events.stream(DdSubmissionCreated.class).count());
        DdSubmission queued = submit("consented", true);
        assertEquals("QUEUED", queued.getAiStatus());
        assertEquals(List.of(queued.getId()), events.stream(DdSubmissionCreated.class).map(DdSubmissionCreated::submissionId).toList());
    }

    @Test void lawyerOptOutPreventsAiEvenWhenClientConsents() throws Exception {
        publish(false); assertEquals("MANUAL_REQUIRED", submit("consent", true).getAiStatus());
        assertEquals(0, events.stream(DdSubmissionCreated.class).count());
    }

    @Test void explanationNeedsLawyerAndDoesNotFabricateAFile() {
        publish(true);
        DdSubmission explanation = workflow.explain(itemId, "NOT_APPLICABLE", "公司没有子公司", "explain", CLIENT);
        assertEquals("EXPLANATION", explanation.getType()); assertEquals("MANUAL_REQUIRED", explanation.getAiStatus());
        assertEquals(List.of(), explanation.getFileIds()); assertTrue(objects.isEmpty());
        DdItem current = items.findById(itemId).orElseThrow();
        status(403, () -> workflow.review(itemId, "APPROVED", null, explanation.getId(), current.getRevision(), CLIENT));
        assertEquals("APPROVED", workflow.review(itemId, "APPROVED", "确认不适用", explanation.getId(), current.getRevision(), LAWYER).getStatus());
        assertEquals(1, workflow.inbox(projectId, LAWYER).size());
    }

    @Test void staleAndLegacyReviewsCannotApproveReplacedMaterial() throws Exception {
        publish(false); DdSubmission old = submit("one", false);
        Long revision = items.findById(itemId).orElseThrow().getRevision();
        DdSubmission replacement = submit("two", false);
        status(409, () -> workflow.review(itemId, "APPROVED", null, old.getId(), revision, LAWYER));
        status(409, () -> workflow.review(itemId, "APPROVED", null, null, null, LAWYER));
        assertEquals("UPLOADED", submissions.findById(replacement.getId()).orElseThrow().getReviewStatus());
        DdItem latest = items.findById(itemId).orElseThrow();
        workflow.review(itemId, "APPROVED", null, replacement.getId(), latest.getRevision(), LAWYER);
        status(409, () -> submit("three", false));
    }

    @Test void failedAiCanBeAppealedThenLawyerConfirmsAndClientIsNotified() throws Exception {
        publish(true); DdSubmission submission = submit("one", true);
        submission.setAiStatus("FAILED"); submissions.save(submission);
        workflow.appeal(itemId, submission.getId(), "原件如此，请律师复核", CLIENT);
        workflow.appeal(itemId, submission.getId(), "原件如此，请律师复核", CLIENT);
        assertEquals(2, workflow.inbox(projectId, LAWYER).size());
        DdItem latest = items.findById(itemId).orElseThrow();
        workflow.review(itemId, "APPROVED", "已核对原件", submission.getId(), latest.getRevision(), LAWYER);
        DdSubmission approved = submissions.findById(submission.getId()).orElseThrow();
        assertEquals("APPROVED", approved.getReviewStatus()); assertEquals("FAILED", approved.getAiStatus());
        assertNotNull(approved.getReviewedAt()); assertNotNull(approved.getAppealedAt());
        assertEquals(2, workflow.inbox(projectId, CLIENT).size());
    }

    @Test void archiveKeepsHistoryAndPreventsMutationsAndDeletion() throws Exception {
        publish(false); DdSubmission submission = submit("one", false); workflow.archive(requestId, LAWYER);
        assertEquals(1, workflow.visibleRequests(projectId, CLIENT).size());
        assertEquals(1, workflow.history(itemId, CLIENT).size());
        status(409, () -> submit("two", false));
        status(409, () -> workflow.comment(itemId, "x", CLIENT));
        status(409, () -> workflow.deleteRequest(requestId, LAWYER));
        status(409, () -> workflow.deleteItem(itemId, LAWYER));
        status(409, () -> workflow.review(itemId, "APPROVED", null, submission.getId(), 1L, LAWYER));
        assertEquals(1, objects.size());
    }

    @Test void failedSecondFileRollsBackRowsAndAllWrittenBytes() throws Exception {
        publish(true); AtomicInteger count = new AtomicInteger();
        doAnswer(i -> {
            String key = i.getArgument(0); objects.put(key, ((InputStream) i.getArgument(1)).readAllBytes());
            if (count.incrementAndGet() == 2) throw new StorageException("模拟磁盘中断");
            return key;
        }).when(storage).save(anyString(), any());
        assertThrows(StorageException.class, () -> workflow.submit(itemId, List.of(file("一"), file("二")), "rollback", true, CLIENT));
        assertEquals(0, submissions.count()); assertNull(items.findById(itemId).orElseThrow().getCurrentSubmissionId());
        assertEquals(0, files.findAll().stream().filter(f -> !f.getIsFolder()).count());
        assertTrue(objects.isEmpty()); assertEquals(0, events.stream(DdSubmissionCreated.class).count());
    }

    @Test void concurrentIdenticalRetryCreatesOneVersionAndOneObject() throws Exception {
        publish(false); CountDownLatch storing = new CountDownLatch(1), release = new CountDownLatch(1);
        AtomicBoolean first = new AtomicBoolean(true);
        doAnswer(i -> {
            if (first.compareAndSet(true, false)) { storing.countDown(); assertTrue(release.await(5, TimeUnit.SECONDS)); }
            String key = i.getArgument(0); objects.put(key, ((InputStream) i.getArgument(1)).readAllBytes()); return key;
        }).when(storage).save(anyString(), any());
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            Future<DdSubmission> a = pool.submit(() -> submit("same", false));
            assertTrue(storing.await(5, TimeUnit.SECONDS));
            Future<DdSubmission> b = pool.submit(() -> submit("same", false));
            release.countDown();
            assertEquals(a.get(10, TimeUnit.SECONDS).getId(), b.get(10, TimeUnit.SECONDS).getId());
        } finally { release.countDown(); pool.shutdownNow(); }
        assertEquals(1, submissions.count()); assertEquals(1, objects.size());
        assertEquals(1, workflow.inbox(projectId, LAWYER).size());
    }

    @Test void originalGuardAllowsCleanupOfRolledBackBatch(@org.junit.jupiter.api.io.TempDir java.nio.file.Path root) throws Exception {
        publish(false);
        var properties = new com.checkba.storage.StorageProperties();
        properties.getLocal().setRootPath(root.toString()); properties.getLocal().setTemplatePath(root.resolve("none.docx").toString());
        var resolver = new com.checkba.storage.ProjectStorageResolver(properties, projects);
        var realStorage = new com.checkba.storage.LocalFileStorageService(resolver);
        org.springframework.test.util.ReflectionTestUtils.setField(realStorage, "ddOriginalGuard", new DdOriginalGuard(submissions, files, resolver));
        StorageService failingStorage = mock(StorageService.class);
        AtomicInteger count = new AtomicInteger();
        when(failingStorage.save(anyString(), any())).thenAnswer(i -> {
            String key = i.getArgument(0); realStorage.save(key, i.getArgument(1));
            if (count.incrementAndGet() == 2) throw new StorageException("模拟中断");
            return key;
        });
        doAnswer(i -> { realStorage.delete(i.getArgument(0)); return null; }).when(failingStorage).delete(anyString());
        when(storageFactory.getStorageService()).thenReturn(failingStorage);
        assertThrows(StorageException.class, () -> workflow.submit(itemId, List.of(file("一"), file("二")), "rollback", false, CLIENT));
        assertEquals(0, submissions.count());
        try (var paths = java.nio.file.Files.walk(root)) { assertEquals(0, paths.filter(java.nio.file.Files::isRegularFile).count()); }
    }

    @Test void wholeProjectDeletionRemovesOriginalBytesAndAllDdRecords(@org.junit.jupiter.api.io.TempDir java.nio.file.Path root) throws Exception {
        publish(false); DdSubmission submission = submit("one", false);
        workflow.comment(itemId, "已提交", CLIENT);
        ProjectFile original = files.findById(submission.getFileIds().get(0)).orElseThrow();
        var properties = new com.checkba.storage.StorageProperties();
        properties.getLocal().setRootPath(root.toString()); properties.getLocal().setTemplatePath(root.resolve("none.docx").toString());
        var resolver = new com.checkba.storage.ProjectStorageResolver(properties, projects);
        var realStorage = new com.checkba.storage.LocalFileStorageService(resolver);
        realStorage.save(original.getFilePath(), new java.io.ByteArrayInputStream(new byte[]{1, 2}));
        var guard = new DdOriginalGuard(submissions, files, resolver);
        org.springframework.test.util.ReflectionTestUtils.setField(realStorage, "ddOriginalGuard", guard);
        assertThrows(IllegalArgumentException.class, () -> realStorage.delete(original.getFilePath()));
        when(storageFactory.getStorageService()).thenReturn(realStorage);
        var repo = mock(com.checkba.version.ProjectRepoService.class);
        when(repo.gitDir(projectId)).thenReturn(root.resolve("git"));
        when(repo.objects()).thenReturn(mock(com.checkba.version.objects.LocalVersionObjectStore.class));
        var memory = mock(com.checkba.version.memory.MemoryRepoService.class);
        when(memory.gitDir(anyString())).thenReturn(root.resolve("memory-git"));
        when(memory.workTree(anyString())).thenReturn(root.resolve("memory-work"));
        var service = new ProjectService(projects, members, mock(UserRepository.class), files,
                mock(ProjectProfileFieldRepository.class), mock(TushareService.class), mock(ProjectVariableService.class),
                mock(com.checkba.service.telemetry.TelemetryService.class), resolver, repo, memory,
                mock(MemoryRemoteRepository.class), mock(CompletionEntryRepository.class), mock(org.springframework.context.ApplicationEventPublisher.class));
        org.springframework.test.util.ReflectionTestUtils.setField(service, "entityManager", entityManager);
        org.springframework.test.util.ReflectionTestUtils.setField(service, "storageServiceFactory", storageFactory);
        var quota = mock(com.checkba.service.mobile.CloudStorageQuotaService.class);
        when(quota.isEnabled()).thenReturn(true);
        org.springframework.test.util.ReflectionTestUtils.setField(service, "cloudStorageQuota", quota);
        var work = mock(com.checkba.version.WorkSessionService.class);
        doAnswer(i -> { ((Runnable) i.getArgument(1)).run(); return null; }).when(work).runProjectDeletion(eq(projectId), any());
        org.springframework.test.util.ReflectionTestUtils.setField(service, "workSessions", work);
        new org.springframework.transaction.support.TransactionTemplate(transactionManager).executeWithoutResult(tx -> service.deleteProject(projectId));
        assertFalse(java.nio.file.Files.exists(root.resolve(original.getFilePath())));
        assertEquals(0, submissions.count()); assertEquals(0, notifications.count()); assertEquals(0, requests.count());
        assertEquals(0, items.count()); assertEquals(0, comments.count()); assertFalse(projects.existsById(projectId));
    }

    @Test void failedProjectDeletionRollsBackOriginalReferencesAndPreservesAccounting() throws Exception {
        publish(false); DdSubmission submission = submit("kept", false);
        workflow.comment(itemId, "保留这份原件", CLIENT);
        ProjectFile original = files.findById(submission.getFileIds().get(0)).orElseThrow();
        long notificationCount = notifications.count();
        long fileCount = files.count();
        var resolver = mock(com.checkba.storage.ProjectStorageResolver.class);
        var service = new ProjectService(projects, members, mock(UserRepository.class), files,
                mock(ProjectProfileFieldRepository.class), mock(TushareService.class), mock(ProjectVariableService.class),
                mock(com.checkba.service.telemetry.TelemetryService.class), resolver,
                mock(com.checkba.version.ProjectRepoService.class), mock(com.checkba.version.memory.MemoryRepoService.class),
                mock(MemoryRemoteRepository.class), mock(CompletionEntryRepository.class), mock(org.springframework.context.ApplicationEventPublisher.class));
        org.springframework.test.util.ReflectionTestUtils.setField(service, "entityManager", entityManager);
        org.springframework.test.util.ReflectionTestUtils.setField(service, "storageServiceFactory", storageFactory);
        var quota = mock(com.checkba.service.mobile.CloudStorageQuotaService.class);
        when(quota.isEnabled()).thenReturn(true);
        org.springframework.test.util.ReflectionTestUtils.setField(service, "cloudStorageQuota", quota);
        var work = mock(com.checkba.version.WorkSessionService.class);
        doAnswer(i -> { ((Runnable) i.getArgument(1)).run(); return null; }).when(work).runProjectDeletion(eq(projectId), any());
        org.springframework.test.util.ReflectionTestUtils.setField(service, "workSessions", work);
        doAnswer(i -> {
            assertEquals(0, submissions.count(), "原件保护引用已在同一数据库事务中解除");
            assertTrue(projects.existsById(projectId));
            assertTrue(files.existsById(original.getId()));
            throw new StorageException("模拟原件存储无法删除");
        }).when(storage).delete(original.getFilePath());

        var transaction = new org.springframework.transaction.support.TransactionTemplate(transactionManager);
        assertThrows(StorageException.class, () -> transaction.executeWithoutResult(tx -> service.deleteProject(projectId)));
        assertTrue(projects.existsById(projectId));
        assertTrue(requests.existsById(requestId));
        assertEquals(fileCount, files.count());
        assertEquals(notificationCount, notifications.count());
        assertEquals(1, comments.count());
        DdSubmission restored = submissions.findById(submission.getId()).orElseThrow();
        assertEquals(List.of(original.getId()), restored.getFileIds());
        assertEquals(submission.getId(), items.findById(itemId).orElseThrow().getCurrentSubmissionId());
        assertTrue(objects.containsKey(original.getFilePath()));
        assertThrows(IllegalArgumentException.class,
                () -> new DdOriginalGuard(submissions, files, resolver).requireMutableTree(original),
                "事务回滚后原件应继续禁止改写和删除");
        verify(resolver, never()).invalidate(anyLong());
    }

    @Test void preloadedWebRequestEntityCannotHideAConcurrentReplacement() throws Exception {
        publish(false); DdSubmission original = submit("original", false);
        ExecutorService pool = Executors.newSingleThreadExecutor();
        var transaction = new org.springframework.transaction.support.TransactionTemplate(transactionManager);
        try {
            status(409, () -> transaction.execute(tx -> {
                DdItem stale = items.findById(itemId).orElseThrow();
                Long staleRevision = stale.getRevision();
                requests.findById(requestId).orElseThrow();
                try { pool.submit(() -> submit("replacement", false)).get(10, TimeUnit.SECONDS); }
                catch (Exception e) { throw new IllegalStateException(e); }
                workflow.review(itemId, "APPROVED", null, original.getId(), staleRevision, LAWYER);
                return null;
            }));
        } finally { pool.shutdownNow(); }
        DdItem latest = items.findById(itemId).orElseThrow();
        assertEquals(2, latest.getRevision()); assertEquals("UPLOADED", latest.getStatus());
    }

    @Test void concurrentNewSubmissionsGetDistinctVersionsAndLatestPointer() throws Exception {
        publish(false);
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            CountDownLatch start = new CountDownLatch(1);
            Future<DdSubmission> a = pool.submit(() -> { start.await(); return submit("a", false); });
            Future<DdSubmission> b = pool.submit(() -> { start.await(); return submit("b", false); });
            start.countDown();
            assertEquals(Set.of(1, 2), Set.of(a.get(10, TimeUnit.SECONDS).getVersion(), b.get(10, TimeUnit.SECONDS).getVersion()));
        } finally { pool.shutdownNow(); }
        DdItem latest = items.findById(itemId).orElseThrow();
        assertEquals(2, submissions.findById(latest.getCurrentSubmissionId()).orElseThrow().getVersion());
        assertEquals(2, latest.getRevision()); assertEquals(2, objects.size());
    }
}
