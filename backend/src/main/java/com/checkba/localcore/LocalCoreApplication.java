// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.localcore;

import com.checkba.config.LocalCoreGateway;
import com.checkba.service.AppLanguageScope;
import com.checkba.service.LicenseService;
import com.checkba.service.LocalIdentityService;
import com.checkba.service.account.AccountService;
import com.checkba.service.account.HttpAccountTransport;
import com.checkba.service.site.SiteProfileService;
import com.checkba.service.site.SiteProperties;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.support.RootBeanDefinition;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.context.event.ApplicationContextInitializedEvent;
import org.springframework.boot.context.properties.bind.Bindable;
import org.springframework.boot.context.properties.bind.Binder;
import org.springframework.boot.web.servlet.context.ServletWebServerApplicationContext;
import org.springframework.context.ApplicationListener;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.core.env.ConfigurableEnvironment;
import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.Resource;
import org.springframework.web.servlet.resource.ResourceHttpRequestHandler;

import javax.sql.DataSource;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFilePermissions;
import java.sql.SQLException;
import java.time.Duration;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Assembly of the opt-in desktop candidate. Unsupported operations still wait for the full backend. */
public final class LocalCoreApplication implements LocalCoreBootstrap.Callbacks,
        ApplicationListener<ApplicationContextInitializedEvent> {
    private final Map<String, Object> shared = new LinkedHashMap<>();
    private ObjectMapper json;
    private LocalCoreGateway gateway;
    private LocalCoreGateway.CoreHandler localDocumentRoutes;
    private ConfigurableApplicationContext applicationContext;
    private LocalCoreContentService content;
    private LocalCoreContentHttp contentHttp;
    private volatile boolean protocolPublished;
    private volatile com.checkba.version.WorkSessionService sessions;
    private volatile com.checkba.version.LocalCoreVersionHandoff versions;
    private volatile LocalCoreContentEffects effects;
    private final Map<java.util.UUID, LocalCoreContentService.SaveRequest> savedBeforeReady = new java.util.concurrent.ConcurrentHashMap<>();
    private final Map<java.util.UUID, Boolean> notified = new java.util.concurrent.ConcurrentHashMap<>();

    static Path journalDirectory(Path databaseFile) {
        return databaseFile.resolveSibling(databaseFile.getFileName() + ".awd-content-journal");
    }

    @Override public boolean requiresRecovery(ConfigurableEnvironment environment, Path databaseFile) throws IOException {
        Path journal = journalDirectory(databaseFile);
        if (!Files.exists(journal, LinkOption.NOFOLLOW_LINKS)) return false;
        if (!Files.isDirectory(journal, LinkOption.NOFOLLOW_LINKS) || !journal.equals(journal.toRealPath()))
            throw new IOException("Local content journal is unavailable");
        try (var files = Files.list(journal)) {
            return files.anyMatch(path -> path.getFileName().toString().endsWith(".json"));
        }
    }

    @Override public void onPersistencePrepared(ConfigurableEnvironment environment, DataSource database,
                                                LocalCoreStore store, Path databaseFile) throws Exception {
        if (content != null) throw new IllegalStateException("Local content persistence already prepared");
        Path journal = journalDirectory(databaseFile);
        privateDirectory(journal);
        String identity = java.util.HexFormat.of().formatHex(java.security.MessageDigest.getInstance("SHA-256")
                .digest(databaseFile.toRealPath().toString().getBytes(java.nio.charset.StandardCharsets.UTF_8)));
        long limit = org.springframework.util.unit.DataSize.parse(environment.getProperty("spring.servlet.multipart.max-file-size", "20GB")).toBytes();
        content = new LocalCoreContentService(database, store, journal, identity, limit);
        var recovery = content.recoverPending();
        if (recovery.items().stream().anyMatch(item -> item.state() == LocalCoreContentService.RecoveryState.CONFLICT))
            throw new IOException("Local content recovery needs reconciliation before business initialization");
        // The dedicated protocol stays unavailable on cloud-quota installations; their existing
        // upload path retains owner locking/accounting. Recovery remains mandatory if a journal exists.
        if (!environment.getProperty("desktop.local-core.enabled", Boolean.class, false)
                || environment.getProperty("storage.subscription-quota.enabled", Boolean.class, false)) return;
        Path snapshots = journal.resolve("downloads"); privateDirectory(snapshots);
        contentHttp = new LocalCoreContentHttp(database, store, content, new ObjectMapper(), snapshots, limit,
                projectId -> publication -> publish(projectId, publication),
                projectId -> cancellation -> cancel(projectId, cancellation), this::confirmReceipt);
    }

    private static void privateDirectory(Path path) throws IOException {
        if (!Files.exists(path, LinkOption.NOFOLLOW_LINKS)) {
            if (Files.getFileStore(path.getParent()).supportsFileAttributeView("posix"))
                Files.createDirectory(path, PosixFilePermissions.asFileAttribute(PosixFilePermissions.fromString("rwx------")));
            else Files.createDirectory(path);
        }
        if (!Files.isDirectory(path, LinkOption.NOFOLLOW_LINKS) || !path.equals(path.toRealPath()))
            throw new IOException("Local content directory is unavailable");
    }

    private LocalCoreContentService.SaveReceipt publish(long projectId, LocalCoreContentService.Publication publication)
            throws IOException, SQLException {
        LocalCoreContentService.SaveReceipt receipt;
        var session = sessions;
        if (session == null) receipt = publication.run();
        else {
            try {
                receipt = session.withFileContentWriteLock(projectId, () -> {
                    try {
                        var saved = publication.run();
                        versions.handoffProject(content, projectId);
                        return saved;
                    } catch (IOException | SQLException failure) { throw new PublicationFailure(failure); }
                });
            } catch (PublicationFailure failure) {
                if (failure.getCause() instanceof IOException io) throw io;
                throw (SQLException) failure.getCause();
            }
        }
        notifySaved(receipt.request());
        return receipt;
    }

    private LocalCoreContentService.OperationResult cancel(long projectId, LocalCoreContentService.Cancellation cancellation)
            throws IOException, SQLException {
        LocalCoreContentService.OperationResult result;
        var session = sessions;
        if (session == null) result = cancellation.run();
        else {
            try {
                result = session.withFileContentWriteLock(projectId, () -> {
                    try {
                        var cancelled = cancellation.run();
                        if (cancelled.completed() != null) versions.handoffProject(content, projectId);
                        return cancelled;
                    } catch (IOException | SQLException failure) { throw new PublicationFailure(failure); }
                });
            } catch (PublicationFailure failure) {
                if (failure.getCause() instanceof IOException io) throw io;
                throw (SQLException) failure.getCause();
            }
        }
        if (result.completed() != null) notifySaved(result.completed().request());
        return result;
    }

    /** A lost response or failed version handoff retries finalization, never the document bytes. */
    private void confirmReceipt(LocalCoreContentService.SaveReceipt receipt) throws IOException, SQLException {
        if (notified.containsKey(receipt.request().operationId())) return;
        var session = sessions;
        if (session != null) {
            try {
                session.withFileContentWriteLock(receipt.request().projectId(), () -> {
                    try { versions.handoffProject(content, receipt.request().projectId()); return null; }
                    catch (IOException | SQLException failure) { throw new PublicationFailure(failure); }
                });
            } catch (PublicationFailure failure) {
                if (failure.getCause() instanceof IOException io) throw io;
                throw (SQLException) failure.getCause();
            }
        }
        notifySaved(receipt.request());
    }

    private void notifySaved(LocalCoreContentService.SaveRequest request) {
        savedBeforeReady.put(request.operationId(), request);
        var readyEffects = effects;
        if (readyEffects == null) return;
        notified.computeIfAbsent(request.operationId(), operation -> {
            readyEffects.saved(request);
            return true;
        });
        savedBeforeReady.remove(request.operationId());
    }

    /** Same protocol on both sides of handoff; callers never fall back to the legacy POST for a PUT. */
    public boolean handleContent(HttpServletRequest request, HttpServletResponse response) throws IOException {
        return protocolPublished && contentHttp != null && contentHttp.handle(request, response);
    }

    public int contentProtocolVersion() { return protocolPublished && contentHttp != null ? 1 : 0; }

    private static final class PublicationFailure extends RuntimeException {
        PublicationFailure(Exception cause) { super(cause); }
    }

    public static void configure(SpringApplication application) {
        var wiring = new LocalCoreApplication();
        application.addListeners(new LocalCoreBootstrap(wiring), wiring);
    }

    @Override public AutoCloseable onCorePrepared(ConfigurableEnvironment environment, DataSource database,
                                                LocalCoreStore store, LocalCoreOwnership ownership) throws Exception {
        json = new ObjectMapper().registerModule(new JavaTimeModule()).disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);
        var properties = Binder.get(environment).bind("ai.account", Bindable.of(SiteProperties.class))
                .orElseGet(SiteProperties::new);
        String stateDir = environment.getProperty("security.license.dir",
                environment.getRequiredProperty("user.home") + "/.aiworkdeck");
        var site = new SiteProfileService(true, environment.getProperty("ai.account.base-url", "https://www.aiworkdeck.com"),
                environment.getProperty("ai.account.resolved-site", ""), stateDir, properties);
        var license = new LicenseService(true, site, stateDir,
                environment.getProperty("security.license.trial-code.enabled", Boolean.class, true),
                environment.getProperty("security.license.trial-code.legacy-grace-until", ""));
        var transport = new HttpAccountTransport();
        var account = new AccountService(site, stateDir, transport, license);
        shared.put("siteProperties", properties); shared.put("siteProfileService", site);
        shared.put("licenseService", license); shared.put("httpAccountTransport", transport); shared.put("accountService", account);
        // SmsAuthService.active and MailAuthService.active both explicitly return false in local mode.
        var reads = new LocalCoreHttpReads(store, database, license, account, site,
                new LocalCoreHttpReads.AuthFlags(environment.getProperty("security.admin.allow-all-users", Boolean.class, false), false, false),
                LocalIdentityService::displayNameOf);
        String build = environment.getRequiredProperty("AWD_BACKEND_BUILD");
        int publicPort = environment.getProperty("server.port", Integer.class, 8080);
        protocolPublished = contentHttp != null; // The bootstrap verified this exact recorded schema.
        localDocumentRoutes = (request, response) -> {
            if (handleContent(request, response)) return true;
            if (("GET".equals(request.getMethod()) || "HEAD".equals(request.getMethod()))
                    && request.getRequestURI().equals("/api/desktop/health")) {
                response.setStatus(503);
                writeJson(request, response, Map.of("status", "DOWN", "build", build, "phase", "core"));
                return true;
            }
            if (("GET".equals(request.getMethod()) || "HEAD".equals(request.getMethod()))
                    && request.getRequestURI().equals("/api/desktop/startup-health")) {
                try (var c = database.getConnection(); var s = c.createStatement()) {
                    s.setQueryTimeout(1);
                    try (var r = s.executeQuery("SELECT 1")) {
                        if (!r.next() || r.getInt(1) != 1) throw new IllegalStateException("Core database unavailable");
                    }
                }
                var readPaths = new java.util.ArrayList<>(LocalCoreHttpReads.READ_PATHS);
                readPaths.add("/api/desktop/startup-health");
                readPaths.add("/api/desktop/health");
                if (contentHttp != null) readPaths.add("/api/local-core/projects/:id/files/:id/content");
                writeJson(request, response, Map.of("status", "UP", "build", build, "phase", "core", "coreReadPaths", readPaths,
                        "coreContentProtocol", contentHttp == null ? 0 : 1));
                return true;
            }
            Map<String, List<String>> headers = new LinkedHashMap<>();
            for (String name : Collections.list(request.getHeaderNames())) headers.put(name, Collections.list(request.getHeaders(name)));
            String language = AppLanguageScope.normalize(request.getHeader("X-App-Language"));
            if (language == null) {
                try (var c = database.getConnection(); var s = c.prepareStatement("SELECT \"value\" FROM system_setting WHERE config_key='app.language'")) {
                    try (var r = s.executeQuery()) { language = r.next() ? AppLanguageScope.normalize(r.getString(1)) : null; }
                }
            }
            String effectiveLanguage = language == null ? "zh-CN" : language;
            try {
                return AppLanguageScope.call(effectiveLanguage, () -> {
                    try {
                        var result = reads.handle(new LocalCoreHttpReads.Request(request.getMethod(), request.getRequestURI(),
                                request.getQueryString(), headers));
                        if (result.isEmpty()) return false;
                        var body = result.get(); response.setStatus(body.status());
                        body.headers().forEach(response::setHeader);
                        if (body.bodyFile() != null) writeFile(request, response, body.bodyFile());
                        else writeJson(request, response, body.jsonBody());
                        return true;
                    } catch (Exception e) { throw new RequestFailure(e); }
                });
            } catch (RequestFailure e) { throw e.original; }
        };
        gateway = new LocalCoreGateway(publicPort, ownership, localDocumentRoutes,
                environment.getProperty("security.cors.allowed-origins", ""),
                environment.getProperty("security.cors.allow-all", Boolean.class, false), Duration.ofSeconds(10));
        // Keep server.port for callback URLs and internal clients; only the connector binds privately.
        org.springframework.boot.web.server.WebServerFactoryCustomizer<org.springframework.boot.web.embedded.tomcat.TomcatServletWebServerFactory>
                privateServer = factory -> {
                    factory.setPort(0);
                    factory.addConnectorCustomizers(connector -> connector.setProxyPort(publicPort));
                };
        shared.put("localCorePrivateServer", privateServer);
        return gateway;
    }

    @Override public void onApplicationEvent(ApplicationContextInitializedEvent event) {
        applicationContext = event.getApplicationContext();
        var factory = (org.springframework.beans.factory.support.BeanDefinitionRegistry) event.getApplicationContext().getBeanFactory();
        factory.registerBeanDefinition("localCoreApplication", new RootBeanDefinition(LocalCoreApplication.class, () -> this));
        shared.forEach((name, instance) -> {
            RootBeanDefinition definition = new RootBeanDefinition(instance.getClass());
            definition.setInstanceSupplier(() -> instance);
            factory.registerBeanDefinition(name, definition);
        });
    }

    @Override public void onJpaHandoff(ConfigurableApplicationContext context) throws Exception {
        if (content == null) return;
        var pending = content.beforeImagesForHandoff();
        versions = context.getBean(com.checkba.version.LocalCoreVersionHandoff.class);
        versions.handoff(content);
        for (var image : pending) savedBeforeReady.put(image.request().operationId(), image.request());
        sessions = context.getBean(com.checkba.version.WorkSessionService.class);
    }

    @Override public void onJpaAvailable(ConfigurableApplicationContext context) {
        if (gateway == null) return;
        if (sessions == null || versions == null) throw new IllegalStateException("JPA document locks are not installed");
        // Gateway admits only its explicit document methods/routes, and only in JPA. The content
        // adapter now publishes under the real project lock and hands receipts to JGit. Effects
        // remain deferred until full readiness; no private Servlet or optional startup work is needed.
        gateway.jpaDocumentsReady((request, response) -> localDocumentRoutes.handle(request, response));
    }

    @org.springframework.context.event.EventListener(org.springframework.boot.context.event.ApplicationReadyEvent.class)
    @org.springframework.core.annotation.Order(org.springframework.core.Ordered.HIGHEST_PRECEDENCE + 100)
    public void documentRoutesReady(org.springframework.boot.context.event.ApplicationReadyEvent event) {
        if (gateway == null) return; // Legacy/fresh/feature-off startup retains its original readiness.
        var context = event.getApplicationContext();
        if (context != applicationContext) return;
        if (!(context instanceof ServletWebServerApplicationContext web)) return;
        // All runners (including identity and file-type repair) have returned. This remaining
        // synchronous file repair must finish before PUTs can overlap unrelated Ready listeners.
        var repair = context.getBean(com.checkba.service.maintenance.OrphanParentReconciler.class);
        if (!repair.prepareForDocumentRequests()) return;
        gateway.documentBackendReady(web.getWebServer().getPort());
    }

    @Override public void onReady(ConfigurableApplicationContext context, boolean recordedSchema) {
        protocolPublished = recordedSchema && contentHttp != null;
        if (content != null) {
            effects = context.getBean(LocalCoreContentEffects.class);
        }
        if (gateway != null) gateway.backendReady(((ServletWebServerApplicationContext) context).getWebServer().getPort());
        if (effects != null) {
            savedBeforeReady.values().forEach(request -> {
                try { notifySaved(request); }
                catch (RuntimeException failure) {
                    // Saved bytes and the before-image handoff are durable. A receipt retry can
                    // retry this notification without republishing the original document.
                    System.getLogger(LocalCoreApplication.class.getName()).log(System.Logger.Level.WARNING,
                            "Saved local content notification deferred: fileId=" + request.fileId());
                }
            });
        }
    }

    private void writeJson(HttpServletRequest request, HttpServletResponse response, Object body) throws Exception {
        response.setContentType("application/json;charset=UTF-8");
        byte[] bytes = json.writeValueAsBytes(body); response.setContentLength(bytes.length);
        if (!"HEAD".equals(request.getMethod())) response.getOutputStream().write(bytes);
    }

    private static void writeFile(HttpServletRequest request, HttpServletResponse response, Path path) throws Exception {
        // Use Spring's existing resource transfer semantics, including HEAD, byte ranges and 416.
        var handler = new ResourceHttpRequestHandler() {
            @Override protected Resource getResource(HttpServletRequest ignored) { return new FileSystemResource(path); }
        };
        handler.afterPropertiesSet(); handler.handleRequest(request, response);
    }

    private static final class RequestFailure extends RuntimeException {
        final Exception original;
        RequestFailure(Exception original) { super(original); this.original = original; }
    }
}
