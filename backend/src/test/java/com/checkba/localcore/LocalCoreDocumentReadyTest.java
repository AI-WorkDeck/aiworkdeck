// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.localcore;

import com.checkba.config.LocalCoreGateway;
import com.checkba.controller.DocumentGeneratorController;
import com.checkba.service.document.DocumentGeneratorSettings;
import com.checkba.service.maintenance.OrphanParentReconciler;
import com.checkba.repository.ProjectFileRepository;
import org.junit.jupiter.api.Test;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.EnableAutoConfiguration;
import org.springframework.boot.autoconfigure.jdbc.DataSourceAutoConfiguration;
import org.springframework.boot.autoconfigure.orm.jpa.HibernateJpaAutoConfiguration;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.boot.web.servlet.context.ServletWebServerApplicationContext;
import org.springframework.context.annotation.Bean;
import org.springframework.context.event.EventListener;
import org.springframework.core.annotation.Order;
import org.springframework.test.util.ReflectionTestUtils;

import java.net.URI;
import java.net.http.*;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.UUID;
import java.util.function.Supplier;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class LocalCoreDocumentReadyTest {
    @org.junit.jupiter.api.io.TempDir Path temporary;
    private org.h2.jdbcx.JdbcDataSource database;
    @org.junit.jupiter.api.AfterEach void closeDatabase() throws Exception {
        if (database != null) try (var c = database.getConnection(); var s = c.createStatement()) { s.execute("SHUTDOWN"); }
    }

    @Test void actualMvcMetadataWorksWhileAnUnrelatedReadyCallbackIsBlocked() throws Exception {
        var owner = new LocalCoreOwnership(); owner.drainAndHandoff(Duration.ZERO, () -> {});
        var entered = new CountDownLatch(1); var release = new CountDownLatch(1);
        var reconciled = new AtomicBoolean();
        var context = new AtomicReference<ServletWebServerApplicationContext>();
        var local = new LocalCoreApplication();
        Path document = prepareContent(local);
        try (var gateway = new LocalCoreGateway(0, owner, (q, r) -> fail("CORE must stay retired"), "", false, Duration.ofSeconds(3))) {
            ReflectionTestUtils.setField(local, "gateway", gateway);
            var application = new SpringApplication(TestConfiguration.class);
            application.setRegisterShutdownHook(false);
            application.setDefaultProperties(Map.of("server.port", "0", "server.address", "127.0.0.1", "spring.main.banner-mode", "off"));
            application.addInitializers(ctx -> {
                ReflectionTestUtils.setField(local, "applicationContext", ctx);
                ctx.getBeanFactory().registerSingleton("dataSource", database);
                ctx.getBeanFactory().registerSingleton("localCoreApplication", local);
                ctx.getBeanFactory().registerSingleton("lateReady", new LateReady(entered, release, context));
                var files = mock(ProjectFileRepository.class);
                when(files.findByParentId(0L)).thenAnswer(call -> { reconciled.set(true); return List.of(); });
                ctx.getBeanFactory().registerSingleton("orphanParentReconciler", new OrphanParentReconciler(files));
            });
            var started = CompletableFuture.supplyAsync(() -> (ServletWebServerApplicationContext) application.run("--server.port=0", "--server.address=127.0.0.1"));
            try {
                assertTrue(entered.await(30, TimeUnit.SECONDS));
                var client = HttpClient.newHttpClient();
                var uri = URI.create("http://127.0.0.1:" + gateway.port() + "/api/document/generator/settings");
                var response = client.send(HttpRequest.newBuilder(uri).timeout(Duration.ofSeconds(1)).build(), HttpResponse.BodyHandlers.ofString());
                assertEquals(200, response.statusCode());
                assertTrue(response.body().contains("\"enabled\":true"));
                for (String health : new String[]{"/api/desktop/health", "/api/desktop/startup-health"}) {
                    for (String method : new String[]{"GET", "HEAD"}) {
                        var probe = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + gateway.port() + health))
                                .timeout(Duration.ofSeconds(1)).method(method, HttpRequest.BodyPublishers.noBody()).build();
                        assertEquals(503, client.send(probe, HttpResponse.BodyHandlers.ofString()).statusCode());
                    }
                }
                assertThrows(java.net.http.HttpTimeoutException.class, () -> client.send(HttpRequest.newBuilder(uri)
                        .timeout(Duration.ofMillis(200)).header("Content-Type", "application/json")
                        .PUT(HttpRequest.BodyPublishers.ofString("{\"enabled\":false}")).build(), HttpResponse.BodyHandlers.ofString()));
                var contentUri = URI.create("http://127.0.0.1:" + gateway.port() + "/api/local-core/projects/101/files/1001/content");
                var download = client.send(HttpRequest.newBuilder(contentUri).header(LocalCoreContentHttp.PROTOCOL, "1").build(), HttpResponse.BodyHandlers.ofString());
                assertEquals(200, download.statusCode()); assertEquals("before", download.body());
                var put = HttpRequest.newBuilder(contentUri).timeout(Duration.ofSeconds(1))
                        .header(LocalCoreContentHttp.PROTOCOL, "1").header(LocalCoreContentHttp.UID, "file-1001")
                        .header(LocalCoreContentHttp.ACTOR, "11").header(LocalCoreContentHttp.OPERATION, UUID.randomUUID().toString())
                        .header(LocalCoreContentHttp.EXPECTED_SHA256, download.headers().firstValue(LocalCoreContentHttp.SHA256).orElseThrow())
                        .header("Content-Type", "application/octet-stream").PUT(HttpRequest.BodyPublishers.ofString("after long save")).build();
                assertEquals(200, client.send(put, HttpResponse.BodyHandlers.ofString()).statusCode());
                assertEquals("after long save", Files.readString(document));
                assertEquals(403, client.send(HttpRequest.newBuilder(contentUri).header(LocalCoreContentHttp.PROTOCOL, "1")
                        .header("X-Forwarded-For", "127.0.0.1").build(), HttpResponse.BodyHandlers.ofString()).statusCode());
                assertEquals(org.springframework.boot.availability.ReadinessState.REFUSING_TRAFFIC,
                        context.get().getBean(org.springframework.boot.availability.ApplicationAvailability.class).getReadinessState());
                assertFalse(started.isDone(), "Full startup must still wait for the unrelated Ready callback");
                assertTrue(reconciled.get(), "File reconciliation must precede document publication");
            } finally {
                release.countDown();
                try { started.get(30, TimeUnit.SECONDS).close(); }
                finally { if (context.get() != null) context.get().close(); }
            }
        }
    }

    // Real HTTP/MVC and JDBC publication; the version service is a scoped collaborator stub.
    private Path prepareContent(LocalCoreApplication local) throws Exception {
        Path storage = Files.createDirectory(temporary.resolve("storage")).toRealPath();
        Path journal = Files.createDirectory(temporary.resolve("journal")).toRealPath();
        Path snapshots = Files.createDirectory(journal.resolve("downloads"));
        Path document = Files.createDirectories(storage.resolve("projects/101")).resolve("contract.docx");
        Files.writeString(document, "before");
        database = new org.h2.jdbcx.JdbcDataSource();
        database.setURL("jdbc:h2:mem:document-ready-" + UUID.randomUUID() + ";MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;NON_KEYWORDS=VALUE;DB_CLOSE_DELAY=-1");
        try (var c = database.getConnection(); var s = c.createStatement()) {
            s.execute("CREATE TABLE app_users(id BIGINT PRIMARY KEY, username VARCHAR, display_name VARCHAR, avatar_url VARCHAR, role VARCHAR, subscription_type VARCHAR, phone VARCHAR, verified_email VARCHAR, totp_enabled BOOLEAN)");
            s.execute("CREATE TABLE system_setting(id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, config_key VARCHAR(128) UNIQUE, \"value\" CLOB)");
            s.execute("CREATE TABLE project(id BIGINT PRIMARY KEY, name VARCHAR, project_type VARCHAR, listed_company_name VARCHAR, target_company_name VARCHAR, listed_company_info_json CLOB, target_company_info_json CLOB, user_id BIGINT, local_root VARCHAR, version_opt_out BOOLEAN, created_at TIMESTAMP, updated_at TIMESTAMP, uid VARCHAR)");
            s.execute("CREATE TABLE project_member(id BIGINT PRIMARY KEY, project_id BIGINT, user_id BIGINT, role VARCHAR, joined_at TIMESTAMP)");
            s.execute("CREATE TABLE project_file(id BIGINT PRIMARY KEY, project_id BIGINT, parent_id BIGINT, is_folder BOOLEAN, name VARCHAR, file_type VARCHAR, file_size BIGINT, file_path VARCHAR, external_path VARCHAR, wps_file_id VARCHAR, sort_order INTEGER, user_id BIGINT, client_visible BOOLEAN, created_at TIMESTAMP, updated_at TIMESTAMP, is_deleted BOOLEAN, uid VARCHAR, meta_json CLOB, deleted_at TIMESTAMP)");
            s.execute("CREATE TABLE dd_submission(project_id BIGINT, file_ids_json VARCHAR)");
            s.execute("INSERT INTO app_users(id,username,display_name,role) VALUES(11,'owner','Owner','USER')");
            s.execute("INSERT INTO project(id,name,project_type,user_id,uid) VALUES(101,'Project','CASE',11,'project-101')");
            s.execute("INSERT INTO project_file(id,project_id,is_folder,name,file_type,file_size,file_path,user_id,is_deleted,uid) VALUES(1001,101,FALSE,'contract.docx','docx',6,'projects/101/contract.docx',11,FALSE,'file-1001')");
        }
        var store = new LocalCoreStore(database, storage); store.selectIdentity(11);
        var content = new LocalCoreContentService(database, store, journal, "document-ready", 1048576);
        var sessions = mock(com.checkba.version.WorkSessionService.class);
        when(sessions.withFileContentWriteLock(eq(101L), any())).thenAnswer(call -> ((Supplier<?>) call.getArgument(1)).get());
        ReflectionTestUtils.setField(local, "sessions", sessions);
        ReflectionTestUtils.setField(local, "versions", mock(com.checkba.version.LocalCoreVersionHandoff.class));
        ReflectionTestUtils.setField(local, "content", content);
        ReflectionTestUtils.setField(local, "contentHttp", new LocalCoreContentHttp(database, store, content,
                new com.fasterxml.jackson.databind.ObjectMapper(), snapshots, 1048576,
                project -> publication -> ReflectionTestUtils.invokeMethod(local, "publish", project, publication)));
        ReflectionTestUtils.setField(local, "protocolPublished", true);
        return document;
    }

    static class LateReady {
        private final CountDownLatch entered, release;
        private final AtomicReference<ServletWebServerApplicationContext> context;
        LateReady(CountDownLatch entered, CountDownLatch release, AtomicReference<ServletWebServerApplicationContext> context) {
            this.entered = entered; this.release = release; this.context = context;
        }
        @EventListener @Order(0)
        public void ready(ApplicationReadyEvent event) throws InterruptedException {
            context.set((ServletWebServerApplicationContext) event.getApplicationContext());
            entered.countDown();
            if (!release.await(30, TimeUnit.SECONDS)) throw new IllegalStateException("Test callback was not released");
        }
    }

    @org.springframework.context.annotation.Configuration(proxyBeanMethods = false)
    @EnableAutoConfiguration(exclude = {DataSourceAutoConfiguration.class, HibernateJpaAutoConfiguration.class,
            org.springframework.boot.autoconfigure.data.jpa.JpaRepositoriesAutoConfiguration.class})
    static class TestConfiguration {
        @Bean DocumentGeneratorController generator() {
            var settings = mock(DocumentGeneratorSettings.class); when(settings.enabled()).thenReturn(true);
            return new DocumentGeneratorController(settings);
        }
        @Bean com.checkba.controller.LocalCoreContentController contents(org.springframework.beans.factory.ObjectProvider<LocalCoreApplication> application) {
            return new com.checkba.controller.LocalCoreContentController(application);
        }
        @Bean com.checkba.controller.DesktopHealthController health(javax.sql.DataSource dataSource,
                org.springframework.boot.availability.ApplicationAvailability availability) {
            return new com.checkba.controller.DesktopHealthController(dataSource, availability);
        }
    }
}
