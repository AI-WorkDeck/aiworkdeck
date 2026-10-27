// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.config;

import com.checkba.service.ai.PluginRevocationService;
import com.checkba.service.ai.PluginService;
import com.checkba.service.ai.skill.SkillRegistry;
import com.checkba.service.feedback.FeedbackResolutionSyncService;
import com.checkba.service.feedback.FeedbackUploadService;
import com.checkba.service.pack.PackAutoInstaller;
import com.checkba.service.pack.PackUpdater;
import com.checkba.service.platform.ExternalProviderBackfill;
import com.checkba.service.plugin.PluginJobService;
import com.checkba.service.team.TeamUsageUploadService;
import com.checkba.service.telemetry.TelemetryUploadService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.autoconfigure.ImportAutoConfiguration;
import org.springframework.boot.autoconfigure.web.servlet.ServletWebServerFactoryAutoConfiguration;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.web.context.WebServerInitializedEvent;
import org.springframework.context.ApplicationListener;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.context.annotation.CommonAnnotationBeanPostProcessor;
import org.springframework.context.event.DefaultEventListenerFactory;
import org.springframework.context.event.EventListenerMethodProcessor;
import org.springframework.context.support.GenericApplicationContext;

import java.time.Duration;
import java.net.ConnectException;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class StartupDataInitializerTest {
    private final ch.qos.logback.classic.Logger rootLogger =
            (ch.qos.logback.classic.Logger) org.slf4j.LoggerFactory.getLogger(org.slf4j.Logger.ROOT_LOGGER_NAME);
    private final ch.qos.logback.classic.Level previousRootLevel = rootLogger.getLevel();

    @AfterEach
    void restoreLoggingLevel() {
        rootLogger.setLevel(previousRootLevel);
    }

    private final ExternalProviderBackfill providers = mock(ExternalProviderBackfill.class);
    private final PluginJobService jobs = mock(PluginJobService.class);
    private final PluginService plugins = mock(PluginService.class);
    private final SkillRegistry skills = mock(SkillRegistry.class);
    private final PluginRevocationService revocations = mock(PluginRevocationService.class);
    private final PackAutoInstaller packs = mock(PackAutoInstaller.class);
    private final PackUpdater updater = mock(PackUpdater.class);
    private final FeedbackUploadService feedback = mock(FeedbackUploadService.class);
    private final FeedbackResolutionSyncService resolutions = mock(FeedbackResolutionSyncService.class);
    private final TelemetryUploadService telemetry = mock(TelemetryUploadService.class);
    private final TeamUsageUploadService usage = mock(TeamUsageUploadService.class);

    @Test
    void constructionDoesNotRunDataOrBackgroundCallbacksAndRefreshRunsRequiredWorkInOrder() {
        var order = new ArrayList<String>();
        doAnswer(i -> { order.add("providers"); return null; }).when(providers).onStartup();
        doAnswer(i -> { order.add("jobs"); return null; }).when(jobs).recoverOrphans();
        doAnswer(i -> { order.add("plugins"); return null; }).when(plugins).init();
        doAnswer(i -> { order.add("skills"); return null; }).when(skills).init();
        try (var context = new GenericApplicationContext()) {
            // Real lifecycle processors, without application dependency injection into Mockito fixtures.
            context.registerBean(CommonAnnotationBeanPostProcessor.class);
            context.registerBean(EventListenerMethodProcessor.class);
            context.registerBean(DefaultEventListenerFactory.class);
            context.registerBean(ExternalProviderBackfill.class, () -> providers);
            context.registerBean(PluginJobService.class, () -> jobs);
            context.registerBean(PluginService.class, () -> plugins);
            context.registerBean(SkillRegistry.class, () -> skills);
            context.registerBean(PluginRevocationService.class, () -> revocations);
            context.registerBean(PackAutoInstaller.class, () -> packs);
            context.registerBean(PackUpdater.class, () -> updater);
            context.registerBean(FeedbackUploadService.class, () -> feedback);
            context.registerBean(FeedbackResolutionSyncService.class, () -> resolutions);
            context.registerBean(TelemetryUploadService.class, () -> telemetry);
            context.registerBean(TeamUsageUploadService.class, () -> usage);
            context.registerBean(StartupDataInitializer.class, () -> new StartupDataInitializer(
                    context.getBean(ExternalProviderBackfill.class), context.getBean(PluginJobService.class),
                    context.getBean(PluginService.class), context.getBean(SkillRegistry.class)));
            context.registerBean("lastOrdinaryObject", Object.class, () -> {
                assertEquals(List.of(), order, "database callbacks must not block ordinary Bean construction");
                verifyNoBackgroundWork();
                order.add("constructed");
                return new Object();
            });
            context.refresh();
            assertEquals(List.of("constructed", "providers", "jobs", "plugins", "skills"), order);
            verifyNoBackgroundWork();
            context.publishEvent(new ApplicationReadyEvent(new SpringApplication(), new String[0], context, Duration.ZERO));
            verify(revocations).onStartup();
            verify(packs).scheduleCheck();
            verify(updater).schedule();
            verify(feedback).onStartup();
            verify(resolutions).onStartup();
            verify(telemetry).onStartup();
            verify(usage).onStartup();
            verify(providers).onStartup();
            verify(jobs).recoverOrphans();
            verify(plugins).init();
            verify(skills).init();
        }
    }

    @ParameterizedTest
    @ValueSource(booleans = {true, false})
    void requiredDataWorkCompletesBeforeTheRealWebServerAcceptsRequests(boolean localMode) throws Exception {
        var entered = new CountDownLatch(1);
        var release = new CountDownLatch(1);
        var constructed = new AtomicBoolean();
        var webServerStarted = new AtomicBoolean();
        doAnswer(i -> {
            assertTrue(constructed.get(), "ordinary objects may initialize while the database is bootstrapping");
            entered.countDown();
            assertTrue(release.await(15, TimeUnit.SECONDS));
            return null;
        }).when(providers).onStartup();
        final int port;
        try (var reservation = new ServerSocket(0, 1, InetAddress.getByName("127.0.0.1"))) {
            port = reservation.getLocalPort();
        }
        var client = HttpClient.newBuilder().connectTimeout(Duration.ofMillis(500)).build();
        var request = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + "/"))
                .timeout(Duration.ofSeconds(2)).GET().build();
        var app = application(constructed);
        app.addListeners((ApplicationListener<WebServerInitializedEvent>) event -> {
            verify(skills).init();
            assertEquals(port, event.getWebServer().getPort());
            webServerStarted.set(true);
        });
        var executor = Executors.newSingleThreadExecutor();
        var startup = executor.submit(() -> run(app, localMode, port));
        ConfigurableApplicationContext context = null;
        try {
            assertTrue(entered.await(10, TimeUnit.SECONDS));
            assertFalse(webServerStarted.get(), "business connections must not precede provider/job/plugin recovery");
            assertThrows(ConnectException.class, () -> client.send(request, HttpResponse.BodyHandlers.ofString()),
                    "the actual HTTP connector must refuse connections until necessary initialization completes");
            verifyNoInteractions(jobs, plugins, skills);
            release.countDown();
            context = startup.get(10, TimeUnit.SECONDS);
            assertTrue(webServerStarted.get());
            assertEquals(404, client.send(request, HttpResponse.BodyHandlers.ofString()).statusCode(),
                    "the same isolated HTTP connector must now respond (this fixture has no business routes)");
            var ordered = inOrder(providers, jobs, plugins, skills);
            ordered.verify(providers).onStartup();
            ordered.verify(jobs).recoverOrphans();
            ordered.verify(plugins).init();
            ordered.verify(skills).init();
        } finally {
            release.countDown();
            try {
                if (context == null) context = startup.get(15, TimeUnit.SECONDS);
            } finally {
                if (context != null) context.close();
                executor.shutdownNow();
                assertTrue(executor.awaitTermination(5, TimeUnit.SECONDS));
            }
        }
    }

    @Test
    void failedRequiredInitializationDoesNotStartTheWebServerOrAnnounceReady() {
        doThrow(new IllegalStateException("synthetic plugin initialization failure")).when(plugins).init();
        var app = application(new AtomicBoolean());
        var listening = new AtomicBoolean();
        var ready = new AtomicBoolean();
        app.addListeners((ApplicationListener<WebServerInitializedEvent>) event -> listening.set(true));
        app.addListeners((ApplicationListener<ApplicationReadyEvent>) event -> ready.set(true));
        var failure = assertThrows(IllegalStateException.class, () -> run(app, true));
        assertEquals("synthetic plugin initialization failure", failure.getMessage());
        assertFalse(listening.get());
        assertFalse(ready.get());
        verifyNoInteractions(skills);
    }

    private SpringApplication application(AtomicBoolean constructed) {
        var app = new SpringApplication(ServerApplication.class);
        app.setWebApplicationType(WebApplicationType.SERVLET);
        app.addInitializers(context -> {
            var generic = (GenericApplicationContext) context;
            generic.registerBean(StartupDataInitializer.class,
                    () -> new StartupDataInitializer(providers, jobs, plugins, skills));
            generic.registerBean("ordinaryObject", Object.class, () -> {
                constructed.set(true);
                return new Object();
            });
        });
        return app;
    }

    private ConfigurableApplicationContext run(SpringApplication app, boolean localMode) {
        return run(app, localMode, 0);
    }

    private ConfigurableApplicationContext run(SpringApplication app, boolean localMode, int port) {
        return app.run("--spring.config.name=startup-phase-test-empty", "--server.address=127.0.0.1",
                "--server.port=" + port, "--security.local-mode=" + localMode,
                "--spring.main.banner-mode=off", "--logging.level.root=ERROR");
    }

    private void verifyNoBackgroundWork() {
        verifyNoInteractions(revocations, packs, updater, feedback, resolutions, telemetry, usage);
    }

    @TestConfiguration(proxyBeanMethods = false)
    @ImportAutoConfiguration(ServletWebServerFactoryAutoConfiguration.class)
    static class ServerApplication { }
}
