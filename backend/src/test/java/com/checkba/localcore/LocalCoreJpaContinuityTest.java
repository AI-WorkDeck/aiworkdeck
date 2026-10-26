// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.localcore;

import com.checkba.config.LocalCoreGateway;
import com.checkba.model.entity.*;
import com.checkba.repository.*;
import com.checkba.storage.*;
import com.checkba.version.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.zaxxer.hikari.HikariDataSource;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.context.annotation.*;
import org.springframework.data.jpa.repository.config.EnableJpaRepositories;
import org.springframework.orm.jpa.*;
import org.springframework.orm.jpa.vendor.HibernateJpaVendorAdapter;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.annotation.EnableTransactionManagement;
import javax.sql.DataSource;
import java.nio.file.*;
import java.net.*;
import java.net.http.*;
import java.time.Duration;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

/** Real Spring Data JPA, H2, project lock and JGit; no MVC port or complete Ready callback exists. */
class LocalCoreJpaContinuityTest {
    @TempDir Path temporary;

    @Test void documentSaveAndBaselineRemainAvailableImmediatelyAfterJpaHandoff() throws Exception {
        temporary = temporary.toRealPath();
        Path root = Files.createDirectory(temporary.resolve("storage")).toRealPath();
        var pool = new HikariDataSource();
        pool.setJdbcUrl("jdbc:h2:file:" + temporary.resolve("database") + ";MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;NON_KEYWORDS=VALUE;DB_CLOSE_ON_EXIT=FALSE");
        pool.setUsername("sa");
        try (var context = new AnnotationConfigApplicationContext()) {
            context.registerBean("dataSource", HikariDataSource.class, () -> pool);
            context.register(JpaConfiguration.class); context.refresh();
            var users = context.getBean(UserRepository.class); var projects = context.getBean(ProjectRepository.class);
            var files = context.getBean(ProjectFileRepository.class);
            var user = new User(); user.setUsername("owned-user"); user.setPassword("owned-password");
            user.setDisplayName("Owned Author"); user.setRole("USER"); user = users.saveAndFlush(user);
            var project = new Project(); project.setName("Owned Project"); project.setProjectType("CASE");
            project.setListedCompanyName("Owned Listed"); project.setTargetCompanyName("Owned Target");
            project.setUserId(user.getId()); project.setUid("owned-project"); project = projects.saveAndFlush(project);
            long projectId = project.getId();
            Path document = Files.createDirectories(root.resolve("projects/" + projectId)).resolve("contract.docx");
            Files.writeString(document, "before");
            var file = new ProjectFile(); file.setProjectId(projectId); file.setIsFolder(false); file.setName("contract.docx");
            file.setFileType("docx"); file.setFilePath("projects/" + projectId + "/contract.docx");
            file.setSortOrder(0);
            file.setUserId(user.getId()); file.setFileSize(6L); file.setUid("owned-file"); file.setIsDeleted(false);
            file = files.saveAndFlush(file);
            var properties = new StorageProperties(); properties.getLocal().setRootPath(root.toString());
            var storage = new ProjectStorageResolver(properties, projects);
            var repos = new ProjectRepoService(storage);
            var manifests = new ProjectTreeManifestService(files, repos, new ObjectMapper(), users, projects);
            var sessions = new WorkSessionService(repos, manifests, context.getBean(WorkSessionRepository.class),
                    mock(org.springframework.scheduling.TaskScheduler.class), files, context);
            var lifecycle = new VersionLifecycleService(sessions, repos, projects, users,
                    context.getBean(ProjectRemoteRepository.class), task -> fail("No optional task before full Ready"));
            var versions = new LocalCoreVersionHandoff(repos, sessions, manifests, lifecycle, projects, files, storage);
            context.getBeanFactory().registerSingleton("workSessionService", sessions);
            context.getBeanFactory().registerSingleton("localCoreVersionHandoff", versions);
            var environment = new org.springframework.mock.env.MockEnvironment()
                    .withProperty("AWD_BACKEND_BUILD", "owned-continuity").withProperty("server.port", "0")
                    .withProperty("desktop.local-core.enabled", "true").withProperty("user.home", temporary.toString())
                    .withProperty("security.license.dir", temporary.resolve("license").toString());
            Path databaseFile = temporary.resolve("database.mv.db");
            var store = new LocalCoreStore(pool, root); store.selectIdentity(user.getId());
            var application = new LocalCoreApplication();
            application.onPersistencePrepared(environment, pool, store, databaseFile);
            var owner = new LocalCoreOwnership();
            try (var resource = application.onCorePrepared(environment, pool, store, owner)) {
                var gateway = (LocalCoreGateway) resource;
                var bootstrap = new LocalCoreBootstrap(application);
                ReflectionTestUtils.setField(bootstrap, "pool", pool);
                ReflectionTestUtils.setField(bootstrap, "context", context);
                ReflectionTestUtils.setField(bootstrap, "environment", environment);
                ReflectionTestUtils.setField(bootstrap, "databaseFile", databaseFile);
                ReflectionTestUtils.setField(bootstrap, "candidate", true);
                ReflectionTestUtils.setField(bootstrap, "persistencePrepared", true);
                ReflectionTestUtils.setField(bootstrap, "ownership", owner);
                bootstrap.beforeJpaBusinessInitialization(context, Duration.ofSeconds(2));
                assertEquals(LocalCoreOwnership.State.JPA, owner.state());
                assertFalse(bootstrap.isFullReady());
                var client = HttpClient.newHttpClient();
                String base = "http://127.0.0.1:" + gateway.port();
                var metadata = client.send(HttpRequest.newBuilder(URI.create(base + "/api/document/generator/settings"))
                        .timeout(Duration.ofSeconds(1)).build(), HttpResponse.BodyHandlers.ofString());
                assertEquals(200, metadata.statusCode());
                assertEquals(503, client.send(HttpRequest.newBuilder(URI.create(base + "/api/desktop/health"))
                        .timeout(Duration.ofSeconds(1)).build(), HttpResponse.BodyHandlers.ofString()).statusCode());
                URI content = URI.create(base + "/api/local-core/projects/" + projectId + "/files/" + file.getId() + "/content");
                var download = client.send(HttpRequest.newBuilder(content).timeout(Duration.ofSeconds(1))
                        .header(LocalCoreContentHttp.PROTOCOL, "1").build(), HttpResponse.BodyHandlers.ofString());
                assertEquals(200, download.statusCode()); assertEquals("before", download.body());
                var put = HttpRequest.newBuilder(content).timeout(Duration.ofSeconds(3))
                        .header(LocalCoreContentHttp.PROTOCOL, "1").header(LocalCoreContentHttp.UID, "owned-file")
                        .header(LocalCoreContentHttp.ACTOR, user.getId().toString()).header(LocalCoreContentHttp.OPERATION, UUID.randomUUID().toString())
                        .header(LocalCoreContentHttp.EXPECTED_SHA256, download.headers().firstValue(LocalCoreContentHttp.SHA256).orElseThrow())
                        .header("Content-Type", "application/octet-stream").PUT(HttpRequest.BodyPublishers.ofString("after durable save")).build();
                assertEquals(200, client.send(put, HttpResponse.BodyHandlers.ofString()).statusCode());
                assertEquals("after durable save", Files.readString(document));
                assertEquals(18L, files.findById(file.getId()).orElseThrow().getFileSize());
                try (var git = new org.eclipse.jgit.api.Git(repos.open(projectId))) {
                    assertNotNull(git.getRepository().resolve("HEAD"));
                    var commit = git.log().call().iterator().next();
                    assertEquals("Owned Author", commit.getAuthorIdent().getName());
                    try (var walk = org.eclipse.jgit.treewalk.TreeWalk.forPath(git.getRepository(), "contract.docx", commit.getTree())) {
                        assertEquals("before", new String(git.getRepository().open(walk.getObjectId(0)).getBytes(), java.nio.charset.StandardCharsets.UTF_8));
                    }
                }
                assertNull(ReflectionTestUtils.getField(application, "effects"));
                assertFalse(bootstrap.isFullReady());
                long fileId = file.getId(), actorId = user.getId();
                // The discovery query has already materialized an old entity before another
                // thread saves. The candidate must discard that entity and re-read under the lock.
                for (boolean orphan : new boolean[]{false, true}) {
                    var row = files.findById(fileId).orElseThrow();
                    if (orphan) row.setParentId(0L); else row.setFileType("image");
                    files.saveAndFlush(row);
                    var captured = new java.util.concurrent.CountDownLatch(1);
                    var continueMigration = new java.util.concurrent.CountDownLatch(1);
                    var observed = mock(ProjectFileRepository.class, org.mockito.AdditionalAnswers.delegatesTo(files));
                    var first = new java.util.concurrent.atomic.AtomicBoolean(true);
                    if (orphan) doAnswer(call -> {
                        var old = files.findByParentId(0L);
                        if (first.getAndSet(false)) { captured.countDown(); assertTrue(continueMigration.await(5, java.util.concurrent.TimeUnit.SECONDS)); }
                        return old;
                    }).when(observed).findByParentId(0L);
                    else doAnswer(call -> {
                        var old = files.findByFileTypeInAndIsFolderFalseAndIsDeletedFalse(call.getArgument(0));
                        captured.countDown(); assertTrue(continueMigration.await(5, java.util.concurrent.TimeUnit.SECONDS)); return old;
                    }).when(observed).findByFileTypeInAndIsFolderFalseAndIsDeletedFalse(anyList());
                    Object repair = orphan ? new com.checkba.service.maintenance.OrphanParentReconciler(observed)
                            : new com.checkba.service.mobile.MediaFileTypeReconciler(true, observed);
                    ReflectionTestUtils.setField(repair, "contentLocks", sessions);
                    boolean legacy = System.getProperty("owned.continuity.legacy", "").equals(orphan ? "orphan" : "media");
                    ReflectionTestUtils.setField(repair, "localCoreEnabled", !legacy);
                    var migration = java.util.concurrent.CompletableFuture.supplyAsync(() -> (Integer) ReflectionTestUtils.invokeMethod(repair, "reconcile"));
                    String newest = orphan ? "latest after orphan migration snapshot" : "newest after media migration snapshot";
                    try {
                        assertTrue(captured.await(5, java.util.concurrent.TimeUnit.SECONDS));
                        save(client, content, actorId, newest);
                    } finally { continueMigration.countDown(); }
                    assertEquals(1, migration.get(5, java.util.concurrent.TimeUnit.SECONDS));
                    var actual = files.findById(fileId).orElseThrow();
                    assertEquals((long) newest.length(), actual.getFileSize(), "A stale migration entity overwrote the latest content metadata");
                    assertEquals(newest, Files.readString(document));
                    if (orphan) assertNull(actual.getParentId()); else assertEquals("docx", actual.getFileType());
                }
            }
        } finally { pool.close(); }
    }

    private static void save(HttpClient client, URI content, long actor, String value) throws Exception {
        var current = client.send(HttpRequest.newBuilder(content).timeout(Duration.ofSeconds(2))
                .header(LocalCoreContentHttp.PROTOCOL, "1").build(), HttpResponse.BodyHandlers.ofString());
        assertEquals(200, current.statusCode());
        var upload = HttpRequest.newBuilder(content).timeout(Duration.ofSeconds(3)).header(LocalCoreContentHttp.PROTOCOL, "1")
                .header(LocalCoreContentHttp.UID, "owned-file").header(LocalCoreContentHttp.ACTOR, Long.toString(actor))
                .header(LocalCoreContentHttp.OPERATION, UUID.randomUUID().toString())
                .header(LocalCoreContentHttp.EXPECTED_SHA256, current.headers().firstValue(LocalCoreContentHttp.SHA256).orElseThrow())
                .header("Content-Type", "application/octet-stream").PUT(HttpRequest.BodyPublishers.ofString(value)).build();
        assertEquals(200, client.send(upload, HttpResponse.BodyHandlers.ofString()).statusCode());
    }

    @org.springframework.boot.test.context.TestConfiguration(proxyBeanMethods = false)
    @EnableTransactionManagement
    @EnableJpaRepositories(basePackages = {"com.checkba.repository", "com.checkba.version"})
    static class JpaConfiguration {
        @Bean LocalContainerEntityManagerFactoryBean entityManagerFactory(DataSource dataSource) {
            var factory = new LocalContainerEntityManagerFactoryBean(); factory.setDataSource(dataSource);
            factory.setPackagesToScan("com.checkba.model.entity", "com.checkba.version");
            factory.setJpaVendorAdapter(new HibernateJpaVendorAdapter());
            factory.setJpaPropertyMap(Map.of("hibernate.hbm2ddl.auto", "create-drop",
                    "hibernate.physical_naming_strategy", "org.hibernate.boot.model.naming.CamelCaseToUnderscoresNamingStrategy")); return factory;
        }
        @Bean org.springframework.transaction.PlatformTransactionManager transactionManager(jakarta.persistence.EntityManagerFactory emf) {
            return new JpaTransactionManager(emf);
        }
    }
}
