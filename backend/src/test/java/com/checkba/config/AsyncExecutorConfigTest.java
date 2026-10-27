// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.config;

import org.junit.jupiter.api.Test;
import org.springframework.boot.autoconfigure.data.jpa.JpaRepositoriesAutoConfiguration;
import org.springframework.boot.orm.jpa.EntityManagerFactoryBuilder;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.context.annotation.Bean;
import org.springframework.core.task.AsyncTaskExecutor;
import org.springframework.orm.jpa.LocalContainerEntityManagerFactoryBean;
import org.springframework.orm.jpa.vendor.HibernateJpaVendorAdapter;
import org.springframework.scheduling.annotation.Async;
import org.springframework.scheduling.annotation.EnableAsync;

import javax.sql.DataSource;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotSame;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;

class AsyncExecutorConfigTest {

    @Test
    void jpaBootstrapSelectsApplicationExecutorFromTheRealMultiPoolMap() {
        try (var context = new AnnotationConfigApplicationContext(AsyncExecutorConfig.class)) {
            Map<String, AsyncTaskExecutor> executors = context.getBeansOfType(AsyncTaskExecutor.class);
            assertEquals(Set.of("applicationTaskExecutor", "contextExecutor", "memoryExecutor"), executors.keySet());
            assertSame(context.getBean("taskExecutor"), executors.get("applicationTaskExecutor"));

            EntityManagerFactoryBuilder builder = new EntityManagerFactoryBuilder(
                    new HibernateJpaVendorAdapter(), Map.of(), null);
            new JpaRepositoriesAutoConfiguration()
                    .entityManagerFactoryBootstrapExecutorCustomizer(executors).customize(builder);
            // Building the factory bean does not initialize Hibernate or open a database connection.
            LocalContainerEntityManagerFactoryBean factory = builder.dataSource(mock(DataSource.class))
                    .packages(AsyncExecutorConfigTest.class).build();

            assertSame(context.getBean("applicationTaskExecutor"), factory.getBootstrapExecutor());
        }
    }

    @Test
    void oldAndFrameworkNamesAndDefaultAsyncStillUseTheInteractionPool() throws Exception {
        try (var context = new AnnotationConfigApplicationContext(AsyncExecutorConfig.class, AsyncCalls.class)) {
            AsyncWorker worker = context.getBean(AsyncWorker.class);
            Thread caller = Thread.currentThread();
            for (CompletableFuture<Thread> invocation : List.of(
                    worker.legacyName(), worker.frameworkName(), worker.defaultName())) {
                Thread executing = invocation.get(5, TimeUnit.SECONDS);
                assertNotSame(caller, executing);
                assertTrue(executing.getName().startsWith("awd-async-"), executing.getName());
            }
        }
    }

    @TestConfiguration(proxyBeanMethods = false)
    @EnableAsync
    static class AsyncCalls {
        @Bean
        AsyncWorker asyncWorker() {
            return new AsyncWorker();
        }
    }

    public static class AsyncWorker {
        @Async("taskExecutor")
        public CompletableFuture<Thread> legacyName() {
            return CompletableFuture.completedFuture(Thread.currentThread());
        }

        @Async("applicationTaskExecutor")
        public CompletableFuture<Thread> frameworkName() {
            return CompletableFuture.completedFuture(Thread.currentThread());
        }

        @Async
        public CompletableFuture<Thread> defaultName() {
            return CompletableFuture.completedFuture(Thread.currentThread());
        }
    }
}
