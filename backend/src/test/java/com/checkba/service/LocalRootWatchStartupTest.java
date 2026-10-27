// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service;

import com.checkba.model.entity.Project;
import com.checkba.repository.ProjectRepository;
import io.methvin.watcher.DirectoryWatcher;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.test.util.ReflectionTestUtils;

import java.nio.file.Path;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

class LocalRootWatchStartupTest {
    private Project project(Path root) {
        var project = new Project();
        project.setId(1L);
        project.setLocalRoot(root.toString());
        return project;
    }

    private LocalRootWatchService service(ProjectRepository repository) {
        return spy(new LocalRootWatchService(repository, mock(LocalProjectService.class),
                mock(LocalProjectFileChangeService.class)));
    }

    private void drain(LocalRootWatchService service) throws Exception {
        var startup = (java.util.concurrent.Future<?>) ReflectionTestUtils.getField(service, "startupTask");
        assertNotNull(startup);
        startup.get(5, TimeUnit.SECONDS);
    }

    @Test
    void readyDoesNotWaitForRegistrationAndDuplicateOpenWaitsForTheSameScan(@TempDir Path root) throws Exception {
        var repository = mock(ProjectRepository.class);
        var project = project(root);
        when(repository.findByLocalRootIsNotNull()).thenReturn(List.of(project));
        when(repository.findById(1L)).thenReturn(Optional.of(project));
        var service = service(repository);
        var watcher = mock(DirectoryWatcher.class);
        var started = new CountDownLatch(1);
        var release = new CountDownLatch(1);
        when(watcher.watchAsync(any())).thenAnswer(call -> {
            started.countDown();
            assertTrue(release.await(10, TimeUnit.SECONDS));
            return new CompletableFuture<Void>();
        });
        doReturn(watcher).when(service).createWatcher(eq(root), any());
        var caller = Executors.newSingleThreadExecutor();
        try {
            service.onStartup();
            assertTrue(started.await(5, TimeUnit.SECONDS));
            assertFalse(service.isWatching(1L), "Registration has not finished yet");
            Path otherRoot = Files.createDirectory(root.resolve("other"));
            var other = mock(DirectoryWatcher.class);
            when(other.watchAsync(any())).thenReturn(new CompletableFuture<>());
            doReturn(other).when(service).createWatcher(eq(otherRoot), any());
            assertTrue(service.ensureWatch(2L, otherRoot.toString()),
                    "Opening another project must not wait for the background scan");
            var openStarted = new CountDownLatch(1);
            var opened = caller.submit(() -> {
                openStarted.countDown();
                service.onLocalProjectOpened(new LocalProjectService.LocalProjectOpened(1L, root.toString()));
            });
            assertTrue(openStarted.await(5, TimeUnit.SECONDS));
            assertThrows(java.util.concurrent.TimeoutException.class, () -> opened.get(150, TimeUnit.MILLISECONDS),
                    "An explicit open must not report success while its registration is pending");
            release.countDown();
            opened.get(5, TimeUnit.SECONDS);
            drain(service);
            assertTrue(service.isWatching(1L));
            verify(service).createWatcher(eq(root), any());
            verify(watcher).watchAsync(any());
        } finally {
            release.countDown();
            service.shutdown();
            caller.shutdownNow();
        }
    }

    @Test
    void stopCancelsQueuedStartupRegistrationButExplicitReopenStillWorks(@TempDir Path root) throws Exception {
        var repository = mock(ProjectRepository.class);
        var entered = new CountDownLatch(1);
        var release = new CountDownLatch(1);
        when(repository.findByLocalRootIsNotNull()).thenAnswer(call -> {
            entered.countDown();
            assertTrue(release.await(10, TimeUnit.SECONDS));
            return List.of(project(root));
        });
        var service = service(repository);
        try {
            service.onStartup();
            assertTrue(entered.await(5, TimeUnit.SECONDS));
            service.stopWatch(1L);
            release.countDown();
            drain(service);
            assertFalse(service.isWatching(1L));
            verify(service, never()).createWatcher(any(), any());
            assertTrue(service.ensureWatch(1L, root.toString()));
            assertTrue(service.isWatching(1L));
        } finally {
            release.countDown();
            service.shutdown();
        }
    }

    @Test
    void shutdownDefersCloseUntilInFlightRegistrationReturns(@TempDir Path root) throws Exception {
        var repository = mock(ProjectRepository.class);
        var project = project(root);
        when(repository.findByLocalRootIsNotNull()).thenReturn(List.of(project));
        when(repository.findById(1L)).thenReturn(Optional.of(project));
        var service = service(repository);
        var watcher = mock(DirectoryWatcher.class);
        var started = new CountDownLatch(1);
        var release = new CountDownLatch(1);
        when(watcher.watchAsync(any())).thenAnswer(call -> {
            started.countDown();
            // Model a filesystem registration which returns late despite shutdown interruption.
            long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
            while (release.getCount() != 0 && System.nanoTime() < deadline) {
                try { release.await(100, TimeUnit.MILLISECONDS); } catch (InterruptedException ignored) { }
            }
            assertEquals(0, release.getCount());
            return new CompletableFuture<Void>();
        });
        doReturn(watcher).when(service).createWatcher(eq(root), any());
        try {
            service.onStartup();
            assertTrue(started.await(5, TimeUnit.SECONDS));
            service.shutdown();
            verify(watcher, never()).close();
            release.countDown();
            var executor = (java.util.concurrent.ExecutorService) ReflectionTestUtils.getField(service, "watchExecutor");
            assertTrue(executor.awaitTermination(5, TimeUnit.SECONDS));
            verify(watcher).close();
            assertFalse(service.isWatching(1L));
            assertFalse(service.ensureWatch(1L, root.toString()));
            verify(watcher).watchAsync(any());
            verify(repository).findById(1L);
        } finally {
            release.countDown();
            service.shutdown();
        }
    }

    @Test
    void deletedProjectInStartupSnapshotIsNotRegistered(@TempDir Path root) throws Exception {
        var repository = mock(ProjectRepository.class);
        when(repository.findByLocalRootIsNotNull()).thenReturn(List.of(project(root)));
        when(repository.findById(1L)).thenReturn(Optional.empty());
        var service = service(repository);
        try {
            service.onStartup();
            drain(service);
            assertFalse(service.isWatching(1L));
            verify(service, never()).createWatcher(any(), any());
        } finally {
            service.shutdown();
        }
    }

    @Test
    void deletionDuringRegistrationClosesTheLateWatcher(@TempDir Path root) throws Exception {
        var repository = mock(ProjectRepository.class);
        var project = project(root);
        when(repository.findByLocalRootIsNotNull()).thenReturn(List.of(project));
        var current = new AtomicReference<>(Optional.of(project));
        when(repository.findById(1L)).thenAnswer(call -> current.get());
        var watcher = mock(DirectoryWatcher.class);
        when(watcher.watchAsync(any())).thenAnswer(call -> {
            current.set(Optional.empty());
            return new CompletableFuture<Void>();
        });
        var service = service(repository);
        doReturn(watcher).when(service).createWatcher(eq(root), any());
        try {
            service.onStartup();
            drain(service);
            assertFalse(service.isWatching(1L));
            verify(watcher).close();
            verify(repository, times(2)).findById(1L);
        } finally {
            service.shutdown();
        }
    }

    @Test
    void failedRegistrationIsClosedAndAnExplicitOpenCanRetry(@TempDir Path root) throws Exception {
        var service = service(mock(ProjectRepository.class));
        var failed = mock(DirectoryWatcher.class);
        var retry = mock(DirectoryWatcher.class);
        when(failed.watchAsync(any())).thenReturn(CompletableFuture.failedFuture(new IllegalStateException("synthetic")));
        when(retry.watchAsync(any())).thenReturn(new CompletableFuture<>());
        doReturn(failed, retry).when(service).createWatcher(eq(root), any());
        try {
            assertFalse(service.ensureWatch(1L, root.toString()));
            assertFalse(service.isWatching(1L));
            verify(failed).close();
            assertTrue(service.ensureWatch(1L, root.toString()));
            assertTrue(service.isWatching(1L));
        } finally {
            service.shutdown();
        }
    }

    @Test
    void stopDuringRegistrationAllowsOneReopenAndOldCallbacksCannotClearIt(@TempDir Path root) throws Exception {
        var repository = mock(ProjectRepository.class);
        var project = project(root);
        when(repository.findByLocalRootIsNotNull()).thenReturn(List.of(project));
        when(repository.findById(1L)).thenReturn(Optional.of(project));
        var service = service(repository);
        var first = mock(DirectoryWatcher.class);
        var second = mock(DirectoryWatcher.class);
        var firstLoop = new CompletableFuture<Void>();
        var started = new CountDownLatch(1);
        var release = new CountDownLatch(1);
        var callbacks = new ArrayList<Runnable>();
        when(first.watchAsync(any())).thenAnswer(call -> {
            started.countDown();
            assertTrue(release.await(10, TimeUnit.SECONDS));
            return firstLoop;
        });
        when(second.watchAsync(any())).thenReturn(new CompletableFuture<>());
        doAnswer(call -> {
            callbacks.add(call.getArgument(1));
            return callbacks.size() == 1 ? first : second;
        }).when(service).createWatcher(eq(root), any());
        var caller = Executors.newSingleThreadExecutor();
        try {
            service.onStartup();
            assertTrue(started.await(5, TimeUnit.SECONDS));
            service.stopWatch(1L);
            verify(first, never()).close();
            var reopen = caller.submit(() -> service.ensureWatch(1L, root.toString()));
            release.countDown();
            assertTrue(reopen.get(5, TimeUnit.SECONDS));
            drain(service);
            verify(first).close();
            firstLoop.complete(null);
            callbacks.get(0).run();
            assertTrue(service.isWatching(1L));
            assertTrue(((Map<?, ?>) ReflectionTestUtils.getField(service, "pending")).isEmpty());
            verify(first).watchAsync(any());
            verify(second).watchAsync(any());
            verify(service, times(2)).createWatcher(eq(root), any());
        } finally {
            release.countDown();
            service.shutdown();
            caller.shutdownNow();
        }
    }

    @Test
    void eventLoopFailureClosesTheWatcherAndAllowsRetry(@TempDir Path root) throws Exception {
        var service = service(mock(ProjectRepository.class));
        var failed = mock(DirectoryWatcher.class);
        var retry = mock(DirectoryWatcher.class);
        var eventLoop = new CompletableFuture<Void>();
        when(failed.watchAsync(any())).thenReturn(eventLoop);
        when(retry.watchAsync(any())).thenReturn(new CompletableFuture<>());
        doReturn(failed, retry).when(service).createWatcher(eq(root), any());
        try {
            assertTrue(service.ensureWatch(1L, root.toString()));
            eventLoop.completeExceptionally(new IllegalStateException("synthetic loop failure"));
            assertFalse(service.isWatching(1L));
            verify(failed).close();
            assertTrue(service.ensureWatch(1L, root.toString()));
        } finally {
            service.shutdown();
        }
    }

    @Test
    void blockedStartupScanDoesNotDelayChangesFromAnotherProject(@TempDir Path root) throws Exception {
        var repository = mock(ProjectRepository.class);
        var project = project(root);
        when(repository.findByLocalRootIsNotNull()).thenReturn(List.of(project));
        when(repository.findById(1L)).thenReturn(Optional.of(project));
        var projects = mock(LocalProjectService.class);
        var changes = mock(LocalProjectFileChangeService.class);
        when(projects.reconcileProject(2L))
                .thenReturn(new LocalProjectService.ReconcileResult(1, false, false, 0, false));
        var service = spy(new LocalRootWatchService(repository, projects, changes));
        var blocked = mock(DirectoryWatcher.class);
        var entered = new CountDownLatch(1);
        var release = new CountDownLatch(1);
        when(blocked.watchAsync(any())).thenAnswer(call -> {
            entered.countDown();
            assertTrue(release.await(10, TimeUnit.SECONDS));
            return new CompletableFuture<Void>();
        });
        doReturn(blocked).when(service).createWatcher(eq(root), any());
        Path opened = Files.createDirectory(root.resolve("opened"));
        try {
            service.onStartup();
            assertTrue(entered.await(5, TimeUnit.SECONDS));
            assertTrue(service.ensureWatch(2L, opened.toString()));
            Files.writeString(opened.resolve("changed.txt"), "real filesystem change");
            verify(projects, timeout(3000)).reconcileProject(2L);
            verify(changes, timeout(2000)).filesChanged(2L);
            assertEquals(1, release.getCount(), "The old-project scan must still be blocked");
        } finally {
            release.countDown();
            service.shutdown();
        }
    }

    @Test
    void shutdownDoesNotWaitForNativeRegistrationMonitor(@TempDir Path root) throws Exception {
        var repository = mock(ProjectRepository.class);
        var project = project(root);
        when(repository.findByLocalRootIsNotNull()).thenReturn(List.of(project));
        when(repository.findById(1L)).thenReturn(Optional.of(project));
        var service = service(repository);
        var watcher = mock(DirectoryWatcher.class);
        Object nativeMonitor = new Object();
        var registering = new CountDownLatch(1);
        var release = new CountDownLatch(1);
        var closed = new CountDownLatch(1);
        // directory-watcher 0.18.0 MacOSXListeningWatchService uses the same monitor
        // for register (including tree traversal) and close. Interruption need not stop traversal.
        when(watcher.watchAsync(any())).thenAnswer(call -> {
            synchronized (nativeMonitor) {
                registering.countDown();
                long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
                while (release.getCount() != 0 && System.nanoTime() < deadline) {
                    try { release.await(100, TimeUnit.MILLISECONDS); } catch (InterruptedException ignored) { }
                }
                assertEquals(0, release.getCount());
                return new CompletableFuture<Void>();
            }
        });
        doAnswer(call -> {
            synchronized (nativeMonitor) { closed.countDown(); }
            return null;
        }).when(watcher).close();
        doReturn(watcher).when(service).createWatcher(eq(root), any());
        var caller = Executors.newSingleThreadExecutor();
        try {
            service.onStartup();
            assertTrue(registering.await(5, TimeUnit.SECONDS));
            var shutdown = caller.submit(service::shutdown);
            assertDoesNotThrow(() -> shutdown.get(500, TimeUnit.MILLISECONDS),
                    "Shutdown must not call close while native registration owns its monitor");
            assertEquals(1, release.getCount());
            assertEquals(1, closed.getCount(), "Registration still owns the native monitor");
            assertFalse(service.isWatching(1L));
            release.countDown();
            assertTrue(closed.await(5, TimeUnit.SECONDS), "Cancelled registration must eventually be closed");
            var executor = (java.util.concurrent.ExecutorService) ReflectionTestUtils.getField(service, "watchExecutor");
            assertTrue(executor.awaitTermination(5, TimeUnit.SECONDS));
            assertFalse(service.isWatching(1L));
            assertFalse(service.ensureWatch(1L, root.toString()));
        } finally {
            release.countDown();
            service.shutdown();
            caller.shutdownNow();
        }
    }

    @ParameterizedTest
    @ValueSource(strings = {"stop", "delete", "shutdown"})
    void cancelledStartupCompensationDoesNotReconcileOrRevive(String action, @TempDir Path root) throws Exception {
        var repository = mock(ProjectRepository.class);
        var project = project(root);
        when(repository.findByLocalRootIsNotNull()).thenReturn(List.of(project));
        when(repository.findById(1L)).thenReturn(Optional.of(project));
        var projects = mock(LocalProjectService.class);
        var changes = mock(LocalProjectFileChangeService.class);
        var service = new LocalRootWatchService(repository, projects, changes);
        var executor = (java.util.concurrent.ScheduledExecutorService) ReflectionTestUtils.getField(service, "executor");
        var entered = new CountDownLatch(1);
        var release = new CountDownLatch(1);
        var finished = new CountDownLatch(1);
        executor.submit(() -> {
            entered.countDown();
            try { release.await(10, TimeUnit.SECONDS); }
            catch (InterruptedException ignored) { }
            finally { finished.countDown(); }
        });
        try {
            assertTrue(entered.await(5, TimeUnit.SECONDS));
            service.onStartup();
            drain(service);
            assertTrue(service.isWatching(1L));
            var pending = (Map<?, ?>) ReflectionTestUtils.getField(service, "pending");
            assertNotNull(pending.get(1L), "Successful startup registration must queue compensation");
            switch (action) {
                case "stop" -> service.stopWatch(1L);
                case "delete" -> service.onProjectDeleted(new ProjectService.ProjectDeletedEvent(1L));
                case "shutdown" -> service.shutdown();
                default -> fail("Unknown action");
            }
            assertTrue(pending.isEmpty());
            release.countDown();
            assertTrue(finished.await(5, TimeUnit.SECONDS));
            if (!action.equals("shutdown")) executor.submit(() -> {}).get(5, TimeUnit.SECONDS);
            assertFalse(service.isWatching(1L));
            verifyNoInteractions(projects, changes);
        } finally {
            release.countDown();
            service.shutdown();
        }
    }
}
