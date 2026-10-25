// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.localcore;

import com.checkba.storage.ProjectStorageResolver;
import com.checkba.storage.StorageProperties;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.zaxxer.hikari.HikariDataSource;
import jakarta.persistence.EntityManagerFactory;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.support.BeanDefinitionRegistry;
import org.springframework.beans.factory.support.RootBeanDefinition;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.jdbc.DataSourceProperties;
import org.springframework.boot.availability.AvailabilityChangeEvent;
import org.springframework.boot.availability.ReadinessState;
import org.springframework.boot.context.event.ApplicationContextInitializedEvent;
import org.springframework.boot.context.event.ApplicationEnvironmentPreparedEvent;
import org.springframework.boot.context.event.ApplicationFailedEvent;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.boot.context.properties.bind.Bindable;
import org.springframework.boot.context.properties.bind.Binder;
import org.springframework.context.ApplicationEvent;
import org.springframework.context.ApplicationListener;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.context.event.ContextClosedEvent;
import org.springframework.core.Ordered;
import org.springframework.core.env.ConfigurableEnvironment;
import org.springframework.core.env.MapPropertySource;
import org.springframework.core.env.Profiles;
import org.springframework.orm.jpa.EntityManagerFactoryInfo;

import javax.sql.DataSource;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.HashSet;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

/** Optional existing-H2 bootstrap. Register one instance with SpringApplication.addListeners(). */
public final class LocalCoreBootstrap implements ApplicationListener<ApplicationEvent>, Ordered, AutoCloseable {
    private static final Logger log = LoggerFactory.getLogger(LocalCoreBootstrap.class);
    private static final String BEAN = "localCoreBootstrap";
    // Only the desktop URL options understood here are eligible. In particular INIT must never run
    // while merely checking whether the database is eligible for a writable early core.
    private static final Set<String> URL_OPTIONS = Set.of("MODE", "DATABASE_TO_LOWER", "DEFAULT_NULL_ORDERING",
            "NON_KEYWORDS", "AUTO_SERVER", "AUTO_SERVER_PORT", "IFEXISTS", "DB_CLOSE_ON_EXIT", "LOCK_TIMEOUT");

    public interface Callbacks {
        /** Pending durable writes must be recovered even when the experiment is disabled. */
        default boolean requiresRecovery(ConfigurableEnvironment environment, Path databaseFile) throws Exception { return false; }
        /** Runs before any legacy DDL when a journal exists, otherwise before business initialization. */
        default void onPersistencePrepared(ConfigurableEnvironment environment, DataSource dataSource,
                                           LocalCoreStore store, Path databaseFile) throws Exception {}
        /** Own resources until returning their handle; clean up locally if preparation throws. */
        AutoCloseable onCorePrepared(ConfigurableEnvironment environment, DataSource dataSource,
                                     LocalCoreStore store, LocalCoreOwnership ownership) throws Exception;
        default void onJpaHandoff(ConfigurableApplicationContext context) throws Exception {}
        /** All synchronous Ready listeners have returned; this is separate from JPA ownership. */
        default void onReady(ConfigurableApplicationContext context) throws Exception {}
        default void onReady(ConfigurableApplicationContext context, boolean recordedSchema) throws Exception { onReady(context); }
    }

    private final Callbacks callbacks;
    private SpringApplication application;
    private ConfigurableApplicationContext context;
    private ConfigurableEnvironment environment;
    private String build;
    private Path databaseFile;
    private boolean candidate;
    private boolean readyEventSeen;
    private volatile boolean readyCompleted;
    private boolean persistencePrepared;
    private boolean handedOff;
    private volatile HikariDataSource pool;
    private volatile LocalCoreOwnership ownership;
    private AutoCloseable coreResource;
    private volatile boolean closed;

    public LocalCoreBootstrap(Callbacks callbacks) { this.callbacks = Objects.requireNonNull(callbacks); }

    @Override public int getOrder() { return Ordered.LOWEST_PRECEDENCE; }

    @Override public void onApplicationEvent(ApplicationEvent event) {
        try {
            if (event instanceof ApplicationEnvironmentPreparedEvent prepared) {
                if (application != null) return;
                application = prepared.getSpringApplication();
                prepare(prepared.getEnvironment());
            } else if (event instanceof ApplicationContextInitializedEvent initialized
                    && initialized.getSpringApplication() == application) {
                context = initialized.getApplicationContext();
                registerBeans(context);
            } else if (event instanceof ApplicationReadyEvent ready && ready.getApplicationContext() == context) {
                readyEventSeen = true;
            } else if (event instanceof AvailabilityChangeEvent<?> available && event.getSource() == context
                    && available.getState() == ReadinessState.ACCEPTING_TRAFFIC && readyEventSeen && !readyCompleted) {
                completeReady();
            } else if (event instanceof ApplicationFailedEvent failed && failed.getSpringApplication() == application) {
                close();
            } else if (event instanceof ContextClosedEvent closedEvent && closedEvent.getApplicationContext() == context) {
                // Stop admitting requests before Spring stops its lifecycles and destroys the pool.
                closeCoreResource();
            }
        } catch (Exception failure) {
            close();
            throw new IllegalStateException("Local core bootstrap failed", failure);
        }
    }

    private void prepare(ConfigurableEnvironment env) throws Exception {
        environment = env;
        String address = env.getProperty("server.address", "").trim();
        if (!env.acceptsProfiles(Profiles.of("desktop"))
                || !env.getProperty("security.local-mode", Boolean.class, false)
                || !(address.equals("127.0.0.1") || address.equalsIgnoreCase("localhost"))) return;
        build = env.getProperty("AWD_BACKEND_BUILD", System.getenv("AWD_BACKEND_BUILD"));
        boolean enabled = env.getProperty("desktop.local-core.enabled", Boolean.class, false)
                && build != null && !build.isBlank() && build.length() <= 256 && !build.contains("\n") && !build.contains("\r");

        HikariDataSource proposed = null;
        LocalCoreStore store;
        boolean recovery = false;
        boolean inspectingRecovery = false;
        boolean early = false;
        try {
            Binder binder = Binder.get(env);
            DataSourceProperties properties = binder.bind("spring.datasource", DataSourceProperties.class)
                    .orElseGet(DataSourceProperties::new);
            // Discover a journal before rejecting configuration. Parsing a file location does not
            // approve URL options or open a connection (INIT must never execute during discovery).
            Path discoveredFile = h2FileLocation(env.getProperty("spring.datasource.hikari.jdbc-url", properties.getUrl()));
            if (discoveredFile != null) {
                inspectingRecovery = true;
                recovery = callbacks.requiresRecovery(env, discoveredFile);
                inspectingRecovery = false;
            }
            if (properties.getJndiName() != null || (properties.getType() != null && properties.getType() != HikariDataSource.class)) {
                if (recovery) throw new IllegalStateException("Pending local content requires a supported database configuration");
                return;
            }
            proposed = properties.initializeDataSourceBuilder().type(HikariDataSource.class).build();
            binder.bind("spring.datasource.hikari", Bindable.ofInstance(proposed));
            databaseFile = h2File(proposed.getJdbcUrl());
            if (databaseFile == null || proposed.getDataSource() != null || proposed.getDataSourceClassName() != null
                    || proposed.getDataSourceJNDI() != null || !proposed.getDataSourceProperties().isEmpty()
                    || !"org.h2.Driver".equals(proposed.getDriverClassName())
                    || (proposed.getConnectionInitSql() != null && !proposed.getConnectionInitSql().isBlank())) {
                if (recovery) throw new IllegalStateException("Pending local content requires a supported database configuration");
                proposed.close(); return;
            }
            candidate = enabled;
            if (!candidate && !recovery) { proposed.close(); return; }
            if (!Files.isRegularFile(databaseFile)) {
                if (recovery) throw new IllegalStateException("Pending local content database is unavailable");
                proposed.close(); return;
            }
            // Check before the FIRST connection. IFEXISTS forbids accidental creation; disabling
            // AUTO_SERVER prevents attaching to another JVM and lets H2's file lock exclude even
            // unmodified legacy processes. The original environment remains unchanged on fallback.
            proposed.setJdbcUrl(exclusiveExistingFileUrl(proposed.getJdbcUrl()));
            var proof = new LocalCoreSchemaProof(proposed, enabled ? build : "recovery");
            early = enabled && proof.isCurrent();
            if (recovery && !proof.isRecordedSchema())
                throw new IllegalStateException("Pending local content requires its recorded database schema");
            store = new LocalCoreStore(proposed, storageRoot(env));
        } catch (Exception unavailable) {
            if (proposed != null) proposed.close();
            if (recovery || inspectingRecovery) throw unavailable;
            // Keep the established startup path; never include JDBC URLs or credentials in logs.
            log.info("Local core eligibility unavailable; using legacy initialization");
            return;
        }
        pool = proposed;
        // A new build uses legacy DDL, but retains this exclusive pool. It must not later expose the
        // new write protocol through an AUTO_SERVER connection that another JVM can attach to.
        if (!early && !recovery) return;
        callbacks.onPersistencePrepared(env, pool, store, databaseFile);
        persistencePrepared = true;
        if (!early) return;
        ownership = new LocalCoreOwnership();
        // This must precede creation of any EntityManagerFactory, including an asynchronous one.
        env.getPropertySources().addFirst(new MapPropertySource("localCoreSchemaSafety", Map.of(
                "spring.jpa.hibernate.ddl-auto", "none",
                "spring.jpa.generate-ddl", false,
                "spring.jpa.properties.hibernate.hbm2ddl.auto", "none",
                "spring.jpa.properties.jakarta.persistence.schema-generation.database.action", "none",
                "spring.jpa.properties.jakarta.persistence.schema-generation.scripts.action", "none",
                "spring.sql.init.mode", "never")));
        coreResource = Objects.requireNonNull(callbacks.onCorePrepared(env, pool, store, ownership), "Core resource handle");
    }

    private void registerBeans(ConfigurableApplicationContext ctx) {
        BeanDefinitionRegistry registry = (BeanDefinitionRegistry) ctx.getBeanFactory();
        if (registry.containsBeanDefinition(BEAN)) throw new IllegalStateException("Local core bootstrap bean already exists");
        RootBeanDefinition bootstrap = new RootBeanDefinition(LocalCoreBootstrap.class, () -> this);
        bootstrap.setDestroyMethodName("close");
        registry.registerBeanDefinition(BEAN, bootstrap);
        if (pool != null) {
            if (registry.containsBeanDefinition("dataSource")) throw new IllegalStateException("DataSource already exists");
            RootBeanDefinition source = new RootBeanDefinition(HikariDataSource.class, () -> pool);
            source.setDestroyMethodName("close");
            source.setDependsOn(BEAN);
            registry.registerBeanDefinition("dataSource", source);
        }
    }

    /** Call synchronously as the FIRST action of StartupDataInitializer.afterSingletonsInstantiated. */
    public void beforeJpaBusinessInitialization(ConfigurableApplicationContext ctx, Duration drainTimeout) {
        // A brand-new database was created by the legacy path without an exclusive pool. Record its
        // proof at readiness; only a subsequent exclusive launch may expose the content protocol.
        if (pool == null || (!candidate && !persistencePrepared) || handedOff) return;
        DataSource source = ctx.getBean(DataSource.class);
        if (ctx != context || closed || (pool != null && source != pool))
            throw new IllegalStateException("JPA must share the local core DataSource");
        EntityManagerFactory factory = ctx.getBean(EntityManagerFactory.class);
        if (!(factory instanceof EntityManagerFactoryInfo info) || info.getDataSource() != source)
            throw new IllegalStateException("JPA must use the local core DataSource");
        // A deferred FactoryBean proxy does not mean its native factory has finished. Wait before
        // DRAINING so that an indefinitely blocked EMF still leaves the early JDBC core usable.
        Objects.requireNonNull(info.getNativeEntityManagerFactory(), "Native EntityManagerFactory");
        if (closed) throw new IllegalStateException("Local core bootstrap is closed");
        try {
            if (!persistencePrepared) {
                try (var connection = source.getConnection()) {
                    if (!databaseFile.equals(h2File(connection.getMetaData().getURL())))
                        throw new IllegalStateException("Local core database changed during initialization");
                }
                callbacks.onPersistencePrepared(environment, source, new LocalCoreStore(source, storageRoot(environment)), databaseFile);
                persistencePrepared = true;
            }
            if (ownership == null) callbacks.onJpaHandoff(ctx);
            else ownership.drainAndHandoff(drainTimeout, () -> callbacks.onJpaHandoff(ctx));
            handedOff = true;
        } catch (Exception failure) {
            throw new IllegalStateException("Local core ownership handoff failed", failure);
        }
    }

    private void completeReady() throws Exception {
        if (closed) return;
        if ((pool != null && (candidate || persistencePrepared) && !handedOff)
                || (ownership != null && ownership.state() != LocalCoreOwnership.State.JPA))
            throw new IllegalStateException("Application became ready before local core handoff");
        boolean recordedSchema = false;
        if (candidate || persistencePrepared) {
            DataSource source = context.getBean(DataSource.class);
            try {
                boolean sameFile;
                try (var connection = source.getConnection()) {
                    sameFile = databaseFile.equals(h2File(connection.getMetaData().getURL()));
                }
                if (sameFile) {
                    String proofBuild = build != null && !build.isBlank() && build.length() <= 256
                            && !build.contains("\n") && !build.contains("\r") ? build : "recovery";
                    var proof = new LocalCoreSchemaProof(source, proofBuild);
                    if (ownership == null) proof.recordAfterLegacyInitialization();
                    recordedSchema = proof.isCurrent();
                }
            } catch (Exception unsupported) {
                if (persistencePrepared && callbacks.requiresRecovery(environment, databaseFile)) throw unsupported;
                // A valid legacy installation may contain objects outside the proof's supported set.
                log.info("Legacy initialization completed without a reusable local core schema proof");
            }
            if (!recordedSchema && (ownership != null
                    || (persistencePrepared && callbacks.requiresRecovery(environment, databaseFile))))
                throw new IllegalStateException("Active local content schema proof could not be verified");
        }
        if (candidate || persistencePrepared) callbacks.onReady(context, recordedSchema);
        readyCompleted = true;
    }

    public boolean isFullReady() { return readyCompleted && !closed; }

    @JsonIgnoreProperties(ignoreUnknown = true)
    private static final class StoredLocation { public String root; public String movedAt; }

    static Path storageRoot(ConfigurableEnvironment env) {
        StorageProperties properties = Binder.get(env).bind("storage", StorageProperties.class).orElseGet(StorageProperties::new);
        Path configured = ProjectStorageResolver.resolveConfiguredPath(properties.getLocal().getRootPath());
        Path state = Path.of(env.getProperty("security.license.dir", env.getProperty("user.home") + "/.aiworkdeck"), "storage-location.json");
        StoredLocation location;
        try {
            location = Files.exists(state) ? new ObjectMapper().readValue(Files.readAllBytes(state), StoredLocation.class) : null;
        } catch (Exception unreadable) { return configured; }
        // Match StorageLocationService: a missing external disk must NOT fall back to configuredRoot.
        return location == null || location.root == null || location.root.isBlank()
                ? configured : Path.of(location.root).toAbsolutePath().normalize();
    }

    static Path h2File(String url) {
        Path location = h2FileLocation(url);
        if (location == null) return null;
        String[] parts = url.substring("jdbc:h2:file:".length()).split(";", -1);
        try {
            Set<String> seen = new HashSet<>();
            for (int i = 1; i < parts.length; i++) {
                int equals = parts[i].indexOf('=');
                if (equals < 1) return null;
                String key = parts[i].substring(0, equals).toUpperCase(Locale.ROOT);
                if (!URL_OPTIONS.contains(key) || !seen.add(key)) return null;
            }
            return location;
        } catch (RuntimeException invalid) { return null; }
    }

    private static Path h2FileLocation(String url) {
        if (url == null || !url.startsWith("jdbc:h2:file:")) return null;
        try {
            Path base = Path.of(url.substring("jdbc:h2:file:".length()).split(";", -1)[0]);
            return base.isAbsolute() ? Path.of(base + ".mv.db").normalize() : null;
        } catch (RuntimeException invalid) { return null; }
    }

    private static String exclusiveExistingFileUrl(String url) {
        return url.replaceAll("(?i);(?:IFEXISTS|AUTO_SERVER)=[^;]*", "") + ";AUTO_SERVER=FALSE;IFEXISTS=TRUE";
    }

    private synchronized void closeCoreResource() {
        AutoCloseable resource = coreResource;
        coreResource = null;
        if (resource != null) try { resource.close(); }
        catch (Exception ignored) { log.warn("Local core resource cleanup failed"); }
    }

    @Override public synchronized void close() {
        if (closed) return;
        closed = true;
        closeCoreResource();
        if (pool != null) pool.close();
    }
}
