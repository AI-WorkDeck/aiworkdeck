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
        /** Own resources until returning their handle; clean up locally if preparation throws. */
        AutoCloseable onCorePrepared(ConfigurableEnvironment environment, DataSource dataSource,
                                     LocalCoreStore store, LocalCoreOwnership ownership) throws Exception;
        default void onJpaHandoff(ConfigurableApplicationContext context) throws Exception {}
        /** All synchronous Ready listeners have returned; this is separate from JPA ownership. */
        default void onReady(ConfigurableApplicationContext context) throws Exception {}
    }

    private final Callbacks callbacks;
    private SpringApplication application;
    private ConfigurableApplicationContext context;
    private ConfigurableEnvironment environment;
    private String build;
    private Path databaseFile;
    private boolean candidate;
    private boolean readyEventSeen;
    private boolean readyCompleted;
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
                || !env.getProperty("desktop.local-core.enabled", Boolean.class, false)
                || !(address.equals("127.0.0.1") || address.equalsIgnoreCase("localhost"))) return;
        build = env.getProperty("AWD_BACKEND_BUILD", System.getenv("AWD_BACKEND_BUILD"));
        if (build == null || build.isBlank() || build.length() > 256 || build.contains("\n") || build.contains("\r")) return;

        HikariDataSource proposed = null;
        LocalCoreStore store;
        try {
            Binder binder = Binder.get(env);
            DataSourceProperties properties = binder.bind("spring.datasource", DataSourceProperties.class)
                    .orElseGet(DataSourceProperties::new);
            if (properties.getJndiName() != null || (properties.getType() != null && properties.getType() != HikariDataSource.class)) return;
            proposed = properties.initializeDataSourceBuilder().type(HikariDataSource.class).build();
            binder.bind("spring.datasource.hikari", Bindable.ofInstance(proposed));
            databaseFile = h2File(proposed.getJdbcUrl());
            if (databaseFile == null || proposed.getDataSource() != null || proposed.getDataSourceClassName() != null
                    || proposed.getDataSourceJNDI() != null || !proposed.getDataSourceProperties().isEmpty()
                    || !"org.h2.Driver".equals(proposed.getDriverClassName())
                    || (proposed.getConnectionInitSql() != null && !proposed.getConnectionInitSql().isBlank())) {
                proposed.close(); return;
            }
            candidate = true;
            if (!Files.isRegularFile(databaseFile)) { proposed.close(); return; }
            // Check before the FIRST connection. IFEXISTS forbids accidental creation; disabling
            // AUTO_SERVER prevents attaching to another JVM and lets H2's file lock exclude even
            // unmodified legacy processes. The original environment remains unchanged on fallback.
            proposed.setJdbcUrl(exclusiveExistingFileUrl(proposed.getJdbcUrl()));
            if (!new LocalCoreSchemaProof(proposed, build).isCurrent()) { proposed.close(); return; }
            store = new LocalCoreStore(proposed, storageRoot(env));
        } catch (Exception unavailable) {
            if (proposed != null) proposed.close();
            // Keep the established startup path; never include JDBC URLs or credentials in logs.
            log.info("Local core eligibility unavailable; using legacy initialization");
            return;
        }
        pool = proposed;
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
        if (ownership == null) return;
        if (ctx != context || closed || ctx.getBean(DataSource.class) != pool)
            throw new IllegalStateException("JPA must share the early core DataSource");
        EntityManagerFactory factory = ctx.getBean(EntityManagerFactory.class);
        if (!(factory instanceof EntityManagerFactoryInfo info) || info.getDataSource() != pool)
            throw new IllegalStateException("JPA must use the early core DataSource");
        // A deferred FactoryBean proxy does not mean its native factory has finished. Wait before
        // DRAINING so that an indefinitely blocked EMF still leaves the early JDBC core usable.
        Objects.requireNonNull(info.getNativeEntityManagerFactory(), "Native EntityManagerFactory");
        if (closed) throw new IllegalStateException("Local core bootstrap is closed");
        try {
            ownership.drainAndHandoff(drainTimeout, () -> callbacks.onJpaHandoff(ctx));
        } catch (Exception failure) {
            throw new IllegalStateException("Local core ownership handoff failed", failure);
        }
    }

    private void completeReady() throws Exception {
        if (closed) return;
        if (ownership != null && ownership.state() != LocalCoreOwnership.State.JPA)
            throw new IllegalStateException("Application became ready before local core handoff");
        if (candidate && ownership == null) {
            DataSource source = context.getBean(DataSource.class);
            try {
                boolean sameFile;
                try (var connection = source.getConnection()) {
                    sameFile = databaseFile.equals(h2File(connection.getMetaData().getURL()));
                }
                if (sameFile) new LocalCoreSchemaProof(source, build).recordAfterLegacyInitialization();
            } catch (Exception unsupported) {
                // A valid legacy installation may contain objects outside the proof's supported set.
                log.info("Legacy initialization completed without a reusable local core schema proof");
            }
        }
        readyCompleted = true;
        if (candidate) callbacks.onReady(context);
    }

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
        if (url == null || !url.startsWith("jdbc:h2:file:")) return null;
        String[] parts = url.substring("jdbc:h2:file:".length()).split(";", -1);
        try {
            Path base = Path.of(parts[0]);
            if (!base.isAbsolute()) return null;
            Set<String> seen = new HashSet<>();
            for (int i = 1; i < parts.length; i++) {
                int equals = parts[i].indexOf('=');
                if (equals < 1) return null;
                String key = parts[i].substring(0, equals).toUpperCase(Locale.ROOT);
                if (!URL_OPTIONS.contains(key) || !seen.add(key)) return null;
            }
            return Path.of(base.toString() + ".mv.db").normalize();
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
