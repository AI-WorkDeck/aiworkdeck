// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.storage;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.nio.file.Files;

import static org.junit.jupiter.api.Assertions.*;

/**
 * 锁定 LocalFileStorageService 的路径遍历围栏：
 * 任何 normalize 后逃出存储根的 fileId 都必须被拒绝，而非读写/删除根外文件。
 */
class LocalFileStorageServiceTest {

    private LocalFileStorageService storage;
    private Path root;

    @BeforeEach
    void setUp(@TempDir Path tempDir) {
        root = tempDir;
        StorageProperties props = new StorageProperties();
        props.getLocal().setRootPath(tempDir.toAbsolutePath().toString());
        props.getLocal().setTemplatePath(tempDir.resolve("no-template.docx").toAbsolutePath().toString());
        storage = new LocalFileStorageService(new ProjectStorageResolver(props, null));
    }

    private ByteArrayInputStream bytes(String s) {
        return new ByteArrayInputStream(s.getBytes(StandardCharsets.UTF_8));
    }

    @Test
    void savesAndReadsNormalKeyWithinRoot() {
        storage.save("projects/1/note.txt", bytes("hello"));
        assertTrue(storage.exists("projects/1/note.txt"));
    }

    @Test
    void rejectsRelativeTraversalOnSave() {
        assertThrows(StorageException.class,
                () -> storage.save("../escape.txt", bytes("x")));
    }

    @Test
    void rejectsDeepTraversalOnExists() {
        assertThrows(StorageException.class,
                () -> storage.exists("projects/1/../../../../etc/passwd"));
    }

    @Test
    void rejectsTraversalOnDelete() {
        assertThrows(StorageException.class,
                () -> storage.delete("../../secret"));
    }
    @Test
    void createsEmptyTextFilesAndPreservesExistingContent(@TempDir Path tempDir) throws Exception {
        for (boolean withTemplate : new boolean[] { false, true }) {
            StorageProperties props = new StorageProperties();
            props.getLocal().setRootPath(tempDir.resolve("files-" + withTemplate).toString());
            Path template = tempDir.resolve("template-" + withTemplate + ".docx");
            if (withTemplate) Files.writeString(template, "Office template must not enter text files");
            props.getLocal().setTemplatePath(template.toString());
            LocalFileStorageService textStorage = new LocalFileStorageService(new ProjectStorageResolver(props, null));
            int index = 0;
            for (String extension : new String[] { "md", "txt", "MD", "TXT" }) {
                String key = "projects/1/note-" + index++ + "." + extension;
                textStorage.createFromTemplate(key);
                assertTrue(textStorage.exists(key));
                assertEquals(0, textStorage.load(key).contentLength());
                textStorage.save(key, bytes("中文笔记\n# hello"));
                textStorage.createFromTemplate(key);
                try (var input = textStorage.load(key).getInputStream()) {
                    assertEquals("中文笔记\n# hello", new String(input.readAllBytes(), StandardCharsets.UTF_8));
                }
            }
        }
    }

    @Test
    void failedManagedSaveKeepsOriginalAndLeavesNoTempFile() throws Exception {
        storage.save("projects/1/c.txt", bytes("original"));
        java.io.InputStream failing = new java.io.InputStream() {
            int n = 0;
            @Override
            public int read() throws java.io.IOException {
                if (n++ < 3) return 'x';
                throw new java.io.IOException("boom");
            }
        };
        assertThrows(StorageException.class, () -> storage.save("projects/1/c.txt", failing));
        Path dir = root.resolve("projects/1");
        assertEquals("original", Files.readString(dir.resolve("c.txt")));
        try (var list = Files.list(dir)) {
            assertEquals(1, list.count());
        }
    }

    @Test
    void managedSaveKeepsDefaultFilePermissions() throws Exception {
        Path dir = Files.createDirectories(root.resolve("projects/1"));
        var probe = Files.createFile(dir.resolve("probe.txt"));
        var view = Files.getFileAttributeView(probe, java.nio.file.attribute.PosixFileAttributeView.class);
        org.junit.jupiter.api.Assumptions.assumeTrue(view != null);
        storage.save("projects/1/d.txt", bytes("x"));
        assertEquals(Files.getPosixFilePermissions(probe), Files.getPosixFilePermissions(dir.resolve("d.txt")));
    }
}
