// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.controller;

import com.zaxxer.hikari.HikariDataSource;
import org.junit.jupiter.api.Test;
import org.springframework.boot.CommandLineRunner;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.autoconfigure.ImportAutoConfiguration;
import org.springframework.boot.autoconfigure.availability.ApplicationAvailabilityAutoConfiguration;
import org.springframework.boot.autoconfigure.jackson.JacksonAutoConfiguration;
import org.springframework.boot.autoconfigure.web.servlet.DispatcherServletAutoConfiguration;
import org.springframework.boot.autoconfigure.web.servlet.ServletWebServerFactoryAutoConfiguration;
import org.springframework.boot.autoconfigure.web.servlet.WebMvcAutoConfiguration;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.web.context.WebServerInitializedEvent;
import org.springframework.context.ApplicationListener;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.*;

class DesktopStartupReadinessTest {
    @Test
    void aListeningHttpServerWaitsForRequiredRunners() throws Exception {
        checkReadiness(false, false);
    }

    @Test
    void aListeningHttpServerWaitsForRequiredReadyListeners() throws Exception {
        checkReadiness(true, false);
    }

    @Test
    void aFailedRunnerCannotReportAHealthyBoot() throws Exception {
        checkReadiness(false, true);
    }

    private void checkReadiness(boolean blockReadyListener, boolean failRunner) throws Exception {
        var entered = new CountDownLatch(1);
        var release = new CountDownLatch(1);
        var port = new AtomicInteger();
        var context = new AtomicReference<ConfigurableApplicationContext>();
        Runnable gate = () -> {
            entered.countDown();
            try {
                if (!release.await(15, TimeUnit.SECONDS)) throw new IllegalStateException("startup gate timed out");
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw new IllegalStateException(e);
            }
        };
        var app = new SpringApplication(HealthApplication.class);
        app.setWebApplicationType(WebApplicationType.SERVLET);
        app.addInitializers(ctx -> ctx.getBeanFactory().registerSingleton("requiredStartupWork",
                (CommandLineRunner) args -> {
                    if (!blockReadyListener) gate.run();
                    if (failRunner) throw new IllegalStateException("synthetic startup failure");
                }));
        app.addListeners((ApplicationListener<WebServerInitializedEvent>) event -> {
            context.set((ConfigurableApplicationContext) event.getApplicationContext());
            port.set(event.getWebServer().getPort());
        });
        app.addListeners((ApplicationListener<ApplicationReadyEvent>) event -> {
            if (blockReadyListener) gate.run();
        });
        var executor = Executors.newSingleThreadExecutor();
        var startup = executor.submit(() -> app.run("--spring.config.name=readiness-test-empty",
                "--server.address=127.0.0.1", "--server.port=0", "--security.local-mode=true",
                "--spring.main.banner-mode=off", "--logging.level.root=ERROR"));
        var client = HttpClient.newHttpClient();
        try {
            assertTrue(entered.await(10, TimeUnit.SECONDS), "the real startup callback must be running");
            assertTrue(port.get() > 0, "the real HTTP listener must already exist");
            var request = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port.get() + "/api/desktop/health"))
                    .timeout(Duration.ofSeconds(3)).GET().build();
            var pending = client.send(request, HttpResponse.BodyHandlers.ofString());
            assertEquals(503, pending.statusCode(), "SELECT 1 alone must not mark an unfinished boot healthy");
            assertFalse(pending.body().contains("\"UP\""));
            release.countDown();
            if (failRunner) {
                var failure = assertThrows(ExecutionException.class, () -> startup.get(10, TimeUnit.SECONDS));
                Throwable cause = failure;
                while (cause.getCause() != null) cause = cause.getCause();
                assertEquals("synthetic startup failure", cause.getMessage());
            } else {
                startup.get(10, TimeUnit.SECONDS);
                var ready = client.send(request, HttpResponse.BodyHandlers.ofString());
                assertEquals(200, ready.statusCode());
                assertTrue(ready.body().contains("\"UP\""));
            }
        } finally {
            release.countDown();
            try {
                try { startup.get(15, TimeUnit.SECONDS); } catch (ExecutionException ignored) { }
            } finally {
                if (context.get() != null) context.get().close();
                executor.shutdownNow();
                assertTrue(executor.awaitTermination(5, TimeUnit.SECONDS));
            }
        }
    }

    @TestConfiguration(proxyBeanMethods = false)
    @Import(DesktopHealthController.class)
    @ImportAutoConfiguration({ApplicationAvailabilityAutoConfiguration.class, JacksonAutoConfiguration.class,
            ServletWebServerFactoryAutoConfiguration.class, DispatcherServletAutoConfiguration.class,
            WebMvcAutoConfiguration.class})
    static class HealthApplication {
        @Bean(destroyMethod = "close")
        HikariDataSource dataSource() {
            var pool = new HikariDataSource();
            pool.setJdbcUrl("jdbc:h2:mem:readiness-" + UUID.randomUUID());
            pool.setMaximumPoolSize(1);
            return pool;
        }
    }
}
