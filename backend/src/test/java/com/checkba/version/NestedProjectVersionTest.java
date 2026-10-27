// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.version;

import com.checkba.storage.ProjectStorageResolver;
import org.eclipse.jgit.api.Git;
import org.eclipse.jgit.lib.Repository;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class NestedProjectVersionTest {
    @TempDir Path temp;

    private ProjectRepoService service(Path parent) {
        ProjectStorageResolver storage = mock(ProjectStorageResolver.class);
        when(storage.globalRoot()).thenReturn(temp.resolve("data"));
        when(storage.projectRoot(7L)).thenReturn(parent);
        when(storage.projectRoot(8L)).thenReturn(parent.resolve("child"));
        when(storage.hasLocalRootForVersionLock(7L)).thenReturn(true);
        when(storage.hasLocalRootForVersionLock(8L)).thenReturn(true);
        return new ProjectRepoService(storage);
    }

    private void write(Path root, String relative, String text) throws Exception {
        Path file = root.resolve(relative);
        Files.createDirectories(file.getParent());
        Files.writeString(file, text);
    }

    @Test
    void parentAndChildKeepOwnManifestsAndParentCheckoutLeavesNestedMetadataUntouched() throws Exception {
        Path parent = temp.resolve("parent");
        write(parent, ".awd/tree.json", "parent manifest");
        write(parent, "child/.awd/tree.json", "child manifest");
        write(parent, "child/deep/.awd/tree.json", "grandchild manifest");
        write(parent, "child/contract.txt", "original");
        write(parent, "child/__staging_area__/note.txt", "user staging file");
        ProjectRepoService service = service(parent);
        service.init(8L, "author", "a@example.com");
        service.init(7L, "author", "a@example.com");
        List<String> parentPaths = service.listPaths(7L, "HEAD");
        assertTrue(parentPaths.contains(".awd/tree.json"));
        assertTrue(parentPaths.contains("child/contract.txt"));
        assertTrue(parentPaths.contains("child/__staging_area__/note.txt"), "Staging contains user files, not private metadata");
        assertFalse(parentPaths.stream().anyMatch(ProjectRepoService::isNestedProjectMetadata));
        assertTrue(service.listPaths(8L, "HEAD").contains(".awd/tree.json"));
        assertFalse(service.listPaths(8L, "HEAD").contains("deep/.awd/tree.json"));
        service.createBranch(7L, "original", "HEAD");

        write(parent, "child/.awd/tree.json", "current child manifest");
        write(parent, "child/deep/.awd/tree.json", "current grandchild manifest");
        assertNull(service.commitAll(7L, "metadata only", "auto", null, "author", "a@example.com"));
        write(parent, "child/contract.txt", "edited");
        assertNotNull(service.commitAll(7L, "edit", "auto", null, "author", "a@example.com"));
        service.checkoutBranch(7L, "original");
        assertEquals("original", Files.readString(parent.resolve("child/contract.txt")));
        assertEquals("current child manifest", Files.readString(parent.resolve("child/.awd/tree.json")));
        assertEquals("current grandchild manifest", Files.readString(parent.resolve("child/deep/.awd/tree.json")));
        service.copyBlobAtCommit(7L, "HEAD", "child/.awd/tree.json", parent.resolve("child/.awd/tree.json"));
        assertEquals("current child manifest", Files.readString(parent.resolve("child/.awd/tree.json")), "An absent historical child manifest must not delete current metadata");
    }

    @Test
    void legacyNestedMetadataIsUntrackedAndNamedBranchesMigrateWithoutTouchingFiles() throws Exception {
        Path parent = temp.resolve("parent");
        write(parent, ".awd/tree.json", "parent");
        write(parent, "child/contract.txt", "content");
        ProjectRepoService service = service(parent);
        service.init(7L, "author", "a@example.com");
        write(parent, "child/.awd/tree.json", "legacy child manifest");
        String legacy;
        try (Repository repo = service.open(7L); Git git = new Git(repo)) {
            Files.writeString(service.gitDir(7L).resolve("info/exclude"), "");
            git.add().addFilepattern(".").call();
            legacy = git.commit().setMessage("legacy").setAuthor("author", "a@example.com").call().name();
        }
        assertTrue(service.listPaths(7L, legacy).contains("child/.awd/tree.json"));
        service.createBranch(7L, "legacy", legacy);
        assertNotNull(service.commitAll(7L, "exclude nested metadata", "auto", null, "author", "a@example.com"));
        assertFalse(service.listPaths(7L, "HEAD").contains("child/.awd/tree.json"));
        assertEquals("legacy child manifest", Files.readString(parent.resolve("child/.awd/tree.json")));
        write(parent, "child/.awd/tree.json", "current child manifest");
        service.checkoutBranch(7L, "legacy");
        assertFalse(service.listPaths(7L, "HEAD").contains("child/.awd/tree.json"));
        assertTrue(service.isAncestor(7L, legacy, "HEAD"), "Migration appends a commit without rewriting history");
        VersionException rejected = assertThrows(VersionException.class, () -> service.requireObjectsAt(7L, legacy));
        assertTrue(rejected.isUserFacing());
        assertEquals("current child manifest", Files.readString(parent.resolve("child/.awd/tree.json")));
        assertEquals("legacy child manifest", new String(service.readBlobAtCommit(7L, legacy, "child/.awd/tree.json")), "History remains readable");
    }
    @Test
    void overlappingLocalVersionOperationsSerializeWithoutBlockingManagedProjects() throws Exception {
        ProjectRepoService repo = service(temp.resolve("parent"));
        WorkSessionService sessions = new WorkSessionService(repo, null, null, null, null, null);
        var parentLock = sessions.repoLock(7L);
        parentLock.lock();
        try {
            boolean childAcquired = java.util.concurrent.CompletableFuture.supplyAsync(() -> {
                var childLock = sessions.repoLock(8L);
                if (!childLock.tryLock()) return false;
                try { return true; } finally { childLock.unlock(); }
            }).get(5, java.util.concurrent.TimeUnit.SECONDS);
            assertFalse(childAcquired, "A child snapshot must wait until the parent checkout finishes");
            boolean managedAcquired = java.util.concurrent.CompletableFuture.supplyAsync(() -> {
                var managedLock = sessions.repoLock(9L);
                if (!managedLock.tryLock()) return false;
                try { return true; } finally { managedLock.unlock(); }
            }).get(5, java.util.concurrent.TimeUnit.SECONDS);
            assertTrue(managedAcquired, "Managed projects keep independent locks");
        } finally { parentLock.unlock(); }
    }

    @Test
    void unresolvedLockClassificationRetriesAndThenCoordinatesTheLocalFolderScope() throws Exception {
        for (boolean databaseFailure : List.of(true, false)) {
            var projects = mock(com.checkba.repository.ProjectRepository.class);
            var parent = new com.checkba.model.entity.Project();
            parent.setId(7L);
            parent.setLocalRoot(temp.resolve("parent").toString());
            var child = new com.checkba.model.entity.Project();
            child.setId(8L);
            child.setLocalRoot(temp.resolve("parent/child").toString());
            if (databaseFailure) {
                when(projects.findById(7L)).thenThrow(new IllegalStateException("database unavailable"))
                        .thenReturn(java.util.Optional.of(parent));
            } else {
                when(projects.findById(7L)).thenReturn(java.util.Optional.empty(), java.util.Optional.of(parent));
            }
            when(projects.findById(8L)).thenReturn(java.util.Optional.of(child));
            var props = new com.checkba.storage.StorageProperties();
            props.getLocal().setRootPath(temp.resolve("data").toString());
            var resolver = new ProjectStorageResolver(props, projects);
            var sessions = new WorkSessionService(new ProjectRepoService(resolver), null, null, null, null, null);

            assertThrows(RuntimeException.class, () -> sessions.repoLock(7L));
            var retried = sessions.repoLock(7L);
            retried.lock();
            try {
                assertFalse(java.util.concurrent.CompletableFuture.supplyAsync(() -> {
                    var childLock = sessions.repoLock(8L);
                    if (!childLock.tryLock()) return false;
                    childLock.unlock(); return true;
                }).get(3, java.util.concurrent.TimeUnit.SECONDS), "A failed lookup must not cache an isolated managed lock");
            } finally { retried.unlock(); }
            assertSame(retried, sessions.repoLock(7L));
            verify(projects, times(2)).findById(7L);
        }
    }

}
