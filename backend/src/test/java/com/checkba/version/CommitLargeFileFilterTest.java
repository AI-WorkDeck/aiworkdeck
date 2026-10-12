// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.version;

import com.checkba.storage.StorageProperties;
import com.checkba.storage.ProjectStorageResolver;
import com.checkba.version.objects.LocalVersionObjectStore;
import com.checkba.version.objects.VersionObjectPointer;
import org.eclipse.jgit.api.Git;
import org.eclipse.jgit.lib.Repository;
import org.eclipse.jgit.revwalk.RevWalk;
import org.eclipse.jgit.treewalk.TreeWalk;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/** Large-file versions contain recoverable immutable objects, not skipped-file fingerprints. */
class CommitLargeFileFilterTest {
    @TempDir Path root;

    private ProjectRepoService service(long threshold) {
        var props = new StorageProperties();
        props.getLocal().setRootPath(root.toString());
        var service = new ProjectRepoService(new ProjectStorageResolver(props, null));
        service.setMaxTrackedFileSizeBytesForTest(threshold);
        return service;
    }

    private Path write(String name, String contents) throws IOException {
        Path file = root.resolve("projects/7").resolve(name);
        Files.createDirectories(file.getParent());
        Files.writeString(file, contents);
        return file;
    }

    private String commit(ProjectRepoService service) {
        return service.commitAll(7, "saved", "auto", null, "Tester", "tester@example.test");
    }

    private byte[] raw(ProjectRepoService service, String ref, String path) throws Exception {
        try (var repo = service.open(7); var walk = new RevWalk(repo)) {
            var commit = walk.parseCommit(repo.resolve(ref));
            try (var tree = TreeWalk.forPath(repo, path, commit.getTree())) {
                return repo.open(tree.getObjectId(0)).getBytes();
            }
        }
    }

    @Test void initialVersionRoutesLargeAndMediaButKeepsSmallDocumentsInGit() throws Exception {
        write("small.txt", "12345678");
        write("large.pdf", "123456789");
        write("voice.MP3", "music");
        var service = service(8);
        service.init(7, "Tester", "tester@example.test");
        assertArrayEquals("12345678".getBytes(), raw(service, "HEAD", "small.txt"));
        assertNotNull(VersionObjectPointer.parse(raw(service, "HEAD", "large.pdf")));
        assertNotNull(VersionObjectPointer.parse(raw(service, "HEAD", "voice.MP3")));
        assertArrayEquals("music".getBytes(), service.readBlobAtCommit(7, "HEAD", "voice.MP3"));
        assertEquals(2, service.objectPointersAt(7, "HEAD", true).size());
        assertTrue(service.pendingChanges(7).isEmpty());
        assertNull(commit(service));
    }

    @Test void queryDoesNotPersistNewObjectsAndVersionsRemainRecoverableAfterDeletion() throws Exception {
        Path media = write("video.mp4", "version-one");
        var service = service(8);
        service.init(7, "Tester", "tester@example.test");
        String one = service.resolveRef(7, "HEAD");
        Files.writeString(media, "version-two");
        byte[] indexBefore = Files.readAllBytes(service.gitDir(7).resolve("index"));
        var objectsBefore = service.objects().list(7);
        assertEquals(List.of(new FileChange("video.mp4", FileChange.Type.MODIFY)), service.pendingChanges(7));
        assertEquals(objectsBefore, service.objects().list(7));
        assertArrayEquals(indexBefore, Files.readAllBytes(service.gitDir(7).resolve("index")));
        String two = commit(service);
        Files.delete(media);
        commit(service);
        service.copyBlobAtCommit(7, one, "video.mp4", media);
        assertEquals("version-one", Files.readString(media));
        service.copyBlobAtCommit(7, two, "video.mp4", media);
        assertEquals("version-two", Files.readString(media));
        assertEquals(2, service.objects().list(7).size());
    }

    @Test void legacyGitBlobAndNewObjectVersionsCanBeSwitchedBothWays() throws Exception {
        Path file = write("scan [1] 合同.bin", "old-complete-file");
        var service = service(Long.MAX_VALUE);
        service.init(7, "Tester", "tester@example.test");
        String old = service.resolveRef(7, "HEAD");
        service.createBranch(7, "old", old);
        service.setMaxTrackedFileSizeBytesForTest(8);
        Files.writeString(file, "new-complete-file");
        String newer = commit(service);
        service.checkoutBranch(7, "old");
        assertEquals("old-complete-file", Files.readString(file));
        service.checkoutBranch(7, "master");
        assertEquals("new-complete-file", Files.readString(file));
        assertArrayEquals("old-complete-file".getBytes(), service.readBlobAtCommit(7, old, "scan [1] 合同.bin"));
        assertNotNull(VersionObjectPointer.parse(raw(service, newer, "scan [1] 合同.bin")));
    }

    @Test void missingOrCorruptTargetObjectCannotReplaceAnyCurrentFileOrBranch() throws Exception {
        Path media = write("video.mp4", "version-one");
        Path note = write("a.txt", "old");
        var service = service(8);
        service.init(7, "Tester", "tester@example.test");
        service.createBranch(7, "old", "HEAD");
        Files.writeString(media, "version-two");
        Files.writeString(note, "new");
        commit(service);
        var old = service.objectPointersAt(7, "old", false).get(0);
        Path objectPath = service.objects().path(7, old.sha256());
        Files.writeString(objectPath, "corrupt");
        assertThrows(VersionException.class, () -> service.checkoutBranch(7, "old"));
        assertEquals("master", service.currentBranch(7));
        assertEquals("version-two", Files.readString(media));
        assertEquals("new", Files.readString(note));
        Files.delete(objectPath);
        assertThrows(VersionException.class, () -> service.checkoutBranch(7, "old"));
        assertEquals("version-two", Files.readString(media));
    }

    @Test void binaryPointersConflictAndAbortRestoresContentWithoutTouchingUnrelatedEdits() throws Exception {
        Path media = write("video.mp4", "initial");
        var service = service(8);
        service.init(7, "Tester", "tester@example.test");
        service.createBranch(7, "draft", "HEAD");
        Files.writeString(media, "mainline"); commit(service);
        service.checkoutBranch(7, "draft");
        Files.writeString(media, "draft-version"); commit(service);
        service.checkoutBranch(7, "master");
        var result = service.mergeKeepingConflicts(7, "draft", "merge", "Tester", "tester@example.test");
        assertFalse(result.success());
        assertEquals(List.of("video.mp4"), result.conflictingPaths());
        assertNull(VersionObjectPointer.parse(Files.readAllBytes(media)), "Never expose a pointer to the editor");
        write("unrelated.txt", "keep my editing");
        service.abortMerge(7);
        assertEquals("mainline", Files.readString(media));
        assertEquals("keep my editing", Files.readString(root.resolve("projects/7/unrelated.txt")));
    }

    @Test void clonePrefetchesBeforeCheckoutAndReceivesFullHistoricalObjects() throws Exception {
        write("video.mp4", "first");
        var source = service(8);
        source.init(7, "Tester", "tester@example.test");
        write("video.mp4", "second"); commit(source);
        var props = new StorageProperties();
        props.getLocal().setRootPath(root.resolve("second-machine").toString());
        var target = new ProjectRepoService(new ProjectStorageResolver(props, null));
        target.cloneFromRemote(8, source.gitDir(7).toUri().toString(), "", "", () -> {
            assertFalse(Files.exists(target.workTree(8).resolve("video.mp4")));
            for (var ref : target.objectPointersAt(8, "HEAD", true)) {
                try (var in = source.objects().open(7, ref.sha256())) {
                    target.objects().importObject(8, ref, in);
                } catch (IOException e) { throw new RuntimeException(e); }
            }
        });
        assertEquals("second", Files.readString(target.workTree(8).resolve("video.mp4")));
        assertEquals(2, target.objects().list(8).size());
        assertTrue(target.pendingChanges(8).isEmpty());
    }

    @Test void failedOrWrongObjectImportDoesNotPublishPartialContent() throws Exception {
        var service = service(8);
        var expected = LocalVersionObjectStore.fingerprint(new ByteArrayInputStream("good".getBytes()));
        assertThrows(IOException.class, () -> service.objects().importObject(7, expected,
                new ByteArrayInputStream("wrong".getBytes())));
        assertTrue(service.objects().list(7).isEmpty());
        assertThrows(IllegalArgumentException.class, () -> service.objects().path(7, "../outside"));
    }
    @Test void rawLegacyPointerLookingBytesAreNeverDecodedAndAreEscapedWhenNextSaved() throws Exception {
        var service = service(1024);
        service.init(7, "Tester", "tester@example.test");
        byte[] literal = VersionObjectPointer.encode(new LocalVersionObjectStore.ObjectRef("1".repeat(64), 456));
        Path file = root.resolve("projects/7/literal.txt");
        Files.write(file, literal);
        try (var rawRepo = new org.eclipse.jgit.storage.file.FileRepositoryBuilder()
                .setGitDir(service.gitDir(7).toFile()).setWorkTree(service.workTree(7).toFile()).build();
             var rawGit = new Git(rawRepo)) {
            rawGit.add().addFilepattern(".").call();
            rawGit.commit().setAuthor("Tester", "tester@example.test").setMessage("legacy format").call();
        }
        service.createBranch(7, "legacy", "HEAD");
        Files.writeString(file, "new text"); commit(service);
        service.checkoutBranch(7, "legacy");
        assertArrayEquals(literal, Files.readAllBytes(file));
        assertTrue(service.pendingChanges(7).isEmpty());
        write("unrelated.txt", "new small file"); commit(service);
        assertArrayEquals(literal, service.readBlobAtCommit(7, "HEAD", "literal.txt"));
        service.checkoutBranch(7, "master");
        service.checkoutBranch(7, "legacy");
        assertArrayEquals(literal, Files.readAllBytes(file));
    }

    @Test void fiftyOneMiBVersionRestoresByStreamWhileComparisonRemainsBounded() throws Exception {
        var service = service(50L * 1024 * 1024);
        Path file = write("recording.mp4", "");
        byte[] chunk = new byte[64 * 1024];
        new java.util.Random(42).nextBytes(chunk);
        try (var out = Files.newOutputStream(file)) {
            for (int i = 0; i < 51 * 16; i++) out.write(chunk);
        }
        LocalVersionObjectStore.ObjectRef expected;
        try (var in = Files.newInputStream(file)) { expected = LocalVersionObjectStore.fingerprint(in); }
        service.init(7, "Tester", "tester@example.test");
        assertThrows(VersionException.class, () -> service.readBlobAtCommit(7, "HEAD", "recording.mp4"));
        Files.writeString(file, "later editing");
        service.copyBlobAtCommit(7, "HEAD", "recording.mp4", file);
        try (var in = Files.newInputStream(file)) { assertEquals(expected, LocalVersionObjectStore.fingerprint(in)); }
        assertTrue(raw(service, "HEAD", "recording.mp4").length < 160);
    }

    @Test void validDownloadRepairsCorruptObjectButInvalidDownloadLeavesItUntouched() throws Exception {
        var store = service(8).objects();
        byte[] good = "complete-content".getBytes();
        var ref = store.put(7, new ByteArrayInputStream(good));
        Files.writeString(store.path(7, ref.sha256()), "damaged");
        assertThrows(IOException.class, () -> store.importObject(7, ref, new ByteArrayInputStream("wrong".getBytes())));
        assertEquals("damaged", Files.readString(store.path(7, ref.sha256())));
        store.importObject(7, ref, new ByteArrayInputStream(good));
        store.verify(7, ref);
    }

    @Test void deletingHistoryRemovesSnapshotsAndKeepsUserFilesAndOtherProjects() throws Exception {
        Path file = write("video.mp4", "private recording");
        var service = service(8);
        service.init(7, "Tester", "tester@example.test");
        service.objects().put(8, new ByteArrayInputStream("other project".getBytes()));
        assertTrue(service.repoSizeBytes(7) >= Files.size(file));
        service.deleteRepository(7);
        assertFalse(Files.exists(service.objects().projectRoot(7)));
        assertFalse(Files.exists(service.gitDir(7)));
        assertEquals("private recording", Files.readString(file));
        assertEquals(1, service.objects().list(8).size());
    }

    @Test void onlyExplicitRecoveryFetchesMissingObjectsAndVerifiesDownloadedBytes() throws Exception {
        byte[] original = "recording".getBytes();
        write("video.mp4", "recording");
        var service = service(8);
        service.init(7, "Tester", "tester@example.test");
        var object = service.objectPointersAt(7, "HEAD", false).get(0);
        Files.delete(service.objects().path(7, object.sha256()));
        var backup = org.mockito.Mockito.mock(com.checkba.service.mobile.MobileRelayClientService.class);
        @SuppressWarnings("unchecked")
        org.springframework.beans.factory.ObjectProvider<com.checkba.service.mobile.MobileRelayClientService> provider =
                org.mockito.Mockito.mock(org.springframework.beans.factory.ObjectProvider.class);
        org.mockito.Mockito.when(provider.getIfAvailable()).thenReturn(backup);
        org.springframework.test.util.ReflectionTestUtils.setField(service, "versionBackupProvider", provider);
        org.mockito.Mockito.doAnswer(call -> {
            service.objects().importObject(7, object, new ByteArrayInputStream(original));
            return null;
        }).when(backup).restoreVersionObject(7, object);
        assertTrue(service.pendingChanges(7).isEmpty());
        org.mockito.Mockito.verifyNoInteractions(backup);
        service.requireObjectsAt(7, "HEAD");
        service.objects().verify(7, object);
        org.mockito.Mockito.verify(backup).restoreVersionObject(7, object);
    }

    @Test void objectVersionsPreserveCrLfBytesEvenWithAutoCrlfEnabled() throws Exception {
        write("small.txt", "ok");
        var service = service(8);
        service.init(7, "Tester", "tester@example.test");
        try (var repo = service.open(7)) {
            repo.getConfig().setBoolean("core", null, "autocrlf", true);
            repo.getConfig().save();
        }
        byte[] original = "one\r\ntwo\r\nthree\r\n".getBytes();
        Path file = write("large.txt", "one\r\ntwo\r\nthree\r\n");
        String version = commit(service);
        assertNotNull(VersionObjectPointer.parse(raw(service, version, "large.txt")));
        assertArrayEquals(original, service.readBlobAtCommit(7, version, "large.txt"));
        Files.writeString(file, "changed\r\nbytes\r\n");
        commit(service);
        service.checkoutBranch(7, version);
        assertArrayEquals(original, Files.readAllBytes(file));
        assertTrue(service.pendingChanges(7).isEmpty());
    }

    @Test void mergingLegacyPointerShapedBytesIntoMarkedMainlineEscapesTheLiteralFile() throws Exception {
        write("base.txt", "base");
        var service = service(4096);
        service.init(7, "Tester", "tester@example.test");
        service.createBranch(7, "legacy", "HEAD");
        service.checkoutBranch(7, "legacy");
        byte[] literal = VersionObjectPointer.encode(new LocalVersionObjectStore.ObjectRef("1".repeat(64), 456));
        Path file = write("literal.txt", "");
        Files.write(file, literal);
        try (var rawRepo = new org.eclipse.jgit.storage.file.FileRepositoryBuilder()
                .setGitDir(service.gitDir(7).toFile()).setWorkTree(service.workTree(7).toFile()).build();
             var rawGit = new Git(rawRepo)) {
            rawGit.add().addFilepattern(".").call();
            rawGit.commit().setAuthor("Tester", "tester@example.test").setMessage("legacy format").call();
        }
        service.checkoutBranch(7, "master");
        write("main.txt", "new mainline");
        commit(service);
        assertTrue(service.merge(7, "legacy", "mixed format", "Tester", "tester@example.test").success());
        assertArrayEquals(literal, Files.readAllBytes(file));
        assertArrayEquals(literal, service.readBlobAtCommit(7, "HEAD", "literal.txt"));
        var escaped = VersionObjectPointer.parse(raw(service, "HEAD", "literal.txt"));
        assertNotNull(escaped);
        assertEquals(literal.length, escaped.size());
        service.objects().verify(7, escaped);
        assertTrue(service.pendingChanges(7).isEmpty());
    }

}
