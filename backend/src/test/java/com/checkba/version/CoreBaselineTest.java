// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.version;

import com.checkba.storage.ProjectStorageResolver;
import com.checkba.storage.StorageProperties;
import com.checkba.version.objects.LocalVersionObjectStore;
import com.checkba.version.objects.VersionObjectPointer;
import org.eclipse.jgit.revwalk.RevWalk;
import org.eclipse.jgit.treewalk.TreeWalk;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.BasicFileAttributes;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

class CoreBaselineTest {
    @TempDir Path root;

    @BeforeEach void canonicalRoot() throws IOException { root = root.toRealPath(); }

    private ProjectRepoService service(long threshold) {
        var properties = new StorageProperties();
        properties.getLocal().setRootPath(root.toString());
        var service = new ProjectRepoService(new ProjectStorageResolver(properties, null));
        service.setMaxTrackedFileSizeBytesForTest(threshold);
        return service;
    }

    private Path working(String path, byte[] bytes) throws IOException {
        Path file = root.resolve("projects/7").resolve(path);
        Files.createDirectories(file.getParent());
        Files.write(file, bytes);
        return file;
    }

    private Path before(String name, byte[] bytes) throws IOException {
        Path file = root.resolve("journal").resolve(name);
        Files.createDirectories(file.getParent());
        Files.write(file, bytes);
        return file;
    }

    private byte[] bytes(String value) { return value.getBytes(StandardCharsets.UTF_8); }

    private String baseline(ProjectRepoService service, String batch, Map<String, Path> images) throws Exception {
        return service.initWithCoreBaseline(7, "Tester", "tester@example.test", batch, images);
    }

    private byte[] raw(ProjectRepoService service, String ref, String path) throws Exception {
        try (var repo = service.open(7); var walk = new RevWalk(repo)) {
            try (var tree = TreeWalk.forPath(repo, path, walk.parseCommit(repo.resolve(ref)).getTree())) {
                return repo.open(tree.getObjectId(0)).getBytes();
            }
        }
    }

    @Test void firstBeforeBecomesBaselineWhileSameLengthLatestBytesStayDirtyAndCommitNext() throws Exception {
        var service = service(1024);
        Path file = working("文件夹/合同 [1].txt", bytes("AAAA"));
        Path first = before("first.before", bytes("AAAA"));
        Files.write(file, bytes("BBBB"));
        before("second.before", bytes("BBBB"));
        Files.write(file, bytes("CCCC"));
        var stat = Files.readAttributes(file, BasicFileAttributes.class);
        String initial = baseline(service, "batch-1", Map.of("文件夹/合同 [1].txt", first));
        assertArrayEquals(bytes("AAAA"), service.readBlobAtCommit(7, initial, "文件夹/合同 [1].txt"));
        assertArrayEquals(bytes("CCCC"), Files.readAllBytes(file));
        var after = Files.readAttributes(file, BasicFileAttributes.class);
        assertEquals(stat.fileKey(), after.fileKey());
        assertEquals(stat.lastModifiedTime(), after.lastModifiedTime());
        assertTrue(service.pendingChanges(7).stream().anyMatch(c -> c.path().equals("文件夹/合同 [1].txt")));
        String saved = service.commitAll(7, "saved", "auto", null, "Tester", "tester@example.test");
        assertNotNull(saved);
        assertArrayEquals(bytes("CCCC"), service.readBlobAtCommit(7, saved, "文件夹/合同 [1].txt"));
        assertArrayEquals(bytes("AAAA"), service.readBlobAtCommit(7, initial, "文件夹/合同 [1].txt"));
        assertTrue(service.pendingChanges(7).isEmpty());
    }

    @Test void existingHeadAndIndexArePreservedWithoutReadingOldJournalInputs() throws Exception {
        var service = service(1024);
        Path file = working("contract.txt", bytes("original"));
        service.init(7, "Tester", "tester@example.test");
        String head = service.resolveRef(7, "HEAD");
        byte[] index = Files.readAllBytes(service.gitDir(7).resolve("index"));
        Files.writeString(file, "current");
        assertEquals(head, baseline(service, "later-batch", Map.of("contract.txt", root.resolve("missing.before"))));
        assertArrayEquals(index, Files.readAllBytes(service.gitDir(7).resolve("index")));
        assertEquals(1, service.log(7, "HEAD", 10).size());
        assertEquals("current", Files.readString(file));
    }

    @Test void excludesAndGeneratedManifestKeepTheirExistingSemantics() throws Exception {
        var service = service(1024);
        working(".gitignore", bytes("ignored.txt\n"));
        working(".awd/tree.json", bytes("{\"version\":2,\"nodes\":[]}"));
        working("ignored.txt", bytes("after"));
        working("~$contract.docx", bytes("after"));
        working("nested/.awd/tree.json", bytes("after"));
        working("normal.txt", bytes("after"));
        Path image = before("original.before", bytes("before"));
        String head = baseline(service, "batch-excludes", Map.of("ignored.txt", image,
                "~$contract.docx", image, "nested/.awd/tree.json", image, "normal.txt", image));
        assertFalse(service.listPaths(7, head).contains("ignored.txt"));
        assertFalse(service.listPaths(7, head).contains("~$contract.docx"));
        assertFalse(service.listPaths(7, head).contains("nested/.awd/tree.json"));
        assertArrayEquals(bytes("before"), service.readBlobAtCommit(7, head, "normal.txt"));
        assertArrayEquals(bytes("{\"version\":2,\"nodes\":[]}"), service.readBlobAtCommit(7, head, ".awd/tree.json"));
        assertEquals("after", Files.readString(root.resolve("projects/7/ignored.txt")));
        assertFalse(service.listPaths(7, head).stream().anyMatch(p -> p.contains("core-baseline")));
    }

    @Test void unmarkedUnbornRemoteRepositoryIsNeverGivenAnInitialCommit() throws Exception {
        var service = service(1024);
        working("contract.txt", bytes("after"));
        service.initEmptyForReceive(7);
        Path image = before("original.before", bytes("before"));
        assertThrows(VersionException.class, () -> baseline(service, "batch-1", Map.of("contract.txt", image)));
        assertNull(service.resolveRef(7, "HEAD"));
        assertEquals("after", Files.readString(root.resolve("projects/7/contract.txt")));
    }

    @Test void failedOwnedInitializationRejectsDifferentInputsAndResumesTheMatchingBatch() throws Exception {
        var service = service(8);
        working("contract.txt", bytes("new"));
        Path image = before("original.before", bytes("a larger original"));
        Files.writeString(root.resolve("version-objects"), "block object storage");
        assertThrows(VersionException.class, () -> baseline(service, "batch-1", Map.of("contract.txt", image)));
        assertTrue(Files.isDirectory(service.gitDir(7).resolve("objects")));
        assertNull(service.resolveRef(7, "HEAD"));
        assertEquals("new", Files.readString(root.resolve("projects/7/contract.txt")));
        Files.delete(root.resolve("version-objects"));
        assertThrows(VersionException.class, () -> baseline(service, "other-batch", Map.of("contract.txt", image)));
        Path different = before("different.before", bytes("a changed original"));
        assertThrows(VersionException.class, () -> baseline(service, "batch-1", Map.of("contract.txt", different)));
        // Model a process interruption part way through repository creation, before config was saved.
        Files.delete(service.gitDir(7).resolve("config"));
        var reopened = service(8);
        String head = baseline(reopened, "batch-1", Map.of("contract.txt", image));
        assertArrayEquals(bytes("a larger original"), reopened.readBlobAtCommit(7, head, "contract.txt"));
        assertEquals("new", Files.readString(root.resolve("projects/7/contract.txt")));
        assertEquals(head, baseline(reopened, "batch-1", Map.of("contract.txt", image)));
        assertEquals(1, reopened.log(7, "HEAD", 10).size());
    }

    @Test void snapshotsUseRealPathMediaSizeAndLiteralPointerEncodingAndHistoricalReads() throws Exception {
        var service = service(8);
        byte[] pointerText = VersionObjectPointer.encode(new LocalVersionObjectStore.ObjectRef("0".repeat(64), 3));
        var values = Map.of("合同 大文件.bin", bytes("123456789"), "voice.MP3", bytes("sound"),
                "literal.txt", pointerText, "small.txt", bytes("old"));
        var images = new java.util.LinkedHashMap<String, Path>();
        int sequence = 0;
        for (var entry : values.entrySet()) {
            working(entry.getKey(), bytes("now"));
            images.put(entry.getKey(), before(++sequence + ".before", entry.getValue()));
        }
        String head = baseline(service, "batch-objects", images);
        for (var entry : values.entrySet()) {
            assertArrayEquals(entry.getValue(), service.readBlobAtCommit(7, head, entry.getKey()));
            Path exported = root.resolve("export-" + entry.getKey());
            try (var input = service.openBlobAtCommit(7, head, entry.getKey())) { Files.copy(input, exported); }
            assertArrayEquals(entry.getValue(), Files.readAllBytes(exported));
            if (!entry.getKey().equals("small.txt")) assertNotNull(VersionObjectPointer.parse(raw(service, head, entry.getKey())));
            assertEquals("now", Files.readString(root.resolve("projects/7").resolve(entry.getKey())));
        }
        assertArrayEquals(bytes("old"), raw(service, head, "small.txt"));
        assertEquals(3, service.objectPointersAt(7, head, true).size());
        assertNotNull(service.commitAll(7, "saved", "auto", null, "Tester", "tester@example.test"));
        assertTrue(service.pendingChanges(7).isEmpty());
    }

    @Test void invalidRelativePathsDoNotCreateRepositoryMetadata() throws Exception {
        var service = service(1024);
        working("contract.txt", bytes("after"));
        Path image = before("original.before", bytes("before"));
        for (String path : new String[]{"../outside", "/absolute", "a//b", "a/./b", "a\\b", ".git/config"}) {
            assertThrows(VersionException.class, () -> baseline(service, "batch-1", Map.of(path, image)), path);
            assertFalse(Files.exists(service.gitDir(7)));
        }
    }

    @Test void symbolicBeforeImageAndTargetAreRejectedWithoutRewritingAnything() throws Exception {
        var service = service(1024);
        Path target = working("contract.txt", bytes("after"));
        Path image = before("original.before", bytes("before"));
        Path linkedImage = image.resolveSibling("linked.before");
        Files.createSymbolicLink(linkedImage, image);
        assertThrows(VersionException.class, () -> baseline(service, "batch-1", Map.of("contract.txt", linkedImage)));
        Files.delete(target);
        Files.createSymbolicLink(target, image);
        assertThrows(VersionException.class, () -> baseline(service, "batch-1", Map.of("contract.txt", image)));
        assertEquals("before", Files.readString(image));
        assertFalse(Files.exists(service.gitDir(7)));
    }

    @Test void repositoryMetadataInsideAChosenLocalRootIsRejected() throws Exception {
        var properties = new StorageProperties();
        properties.getLocal().setRootPath(root.toString());
        var service = new ProjectRepoService(new ProjectStorageResolver(properties, null)) {
            @Override public Path workTree(long projectId) { return root; }
        };
        Files.writeString(root.resolve("contract.txt"), "after");
        Path image = before("original.before", bytes("before"));
        assertThrows(VersionException.class, () -> baseline(service, "batch-1", Map.of("contract.txt", image)));
        assertFalse(Files.exists(root.resolve("repos")));
        assertEquals("after", Files.readString(root.resolve("contract.txt")));
    }

    @Test void aDanglingHeadIsNotMistakenForAnAlreadyCompletedBaseline() throws Exception {
        var service = service(1024);
        working("contract.txt", bytes("after"));
        service.init(7, "Tester", "tester@example.test");
        String branch;
        try (var repo = service.open(7)) { branch = repo.getFullBranch(); }
        Files.writeString(service.gitDir(7).resolve(branch), "f".repeat(40) + "\n");
        Path image = before("original.before", bytes("before"));
        assertThrows(VersionException.class, () -> baseline(service, "batch-1", Map.of("contract.txt", image)));
        assertEquals("after", Files.readString(root.resolve("projects/7/contract.txt")));
        assertEquals("f".repeat(40), Files.readString(service.gitDir(7).resolve(branch)).trim());
    }
}
