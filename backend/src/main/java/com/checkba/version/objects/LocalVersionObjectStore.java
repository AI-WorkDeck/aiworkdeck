// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.version.objects;

import com.checkba.storage.ProjectStorageResolver;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;

/** Immutable, project-scoped snapshots. Cloud backup is a separate, opt-in consumer. */
@Component
public class LocalVersionObjectStore {
    public record ObjectRef(String sha256, long size) {
        public ObjectRef {
            if (sha256 == null || !sha256.matches("[0-9a-f]{64}") || size < 0) {
                throw new IllegalArgumentException("Invalid version object reference");
            }
        }
    }

    private final ProjectStorageResolver storage;

    public LocalVersionObjectStore(ProjectStorageResolver storage) { this.storage = storage; }

    public Path path(long projectId, String sha256) {
        new ObjectRef(sha256, 0);
        return projectRoot(projectId).resolve("sha256").resolve(sha256.substring(0, 2)).resolve(sha256);
    }

    public Path projectRoot(long projectId) {
        if (projectId < 0) throw new IllegalArgumentException("Invalid project id");
        return storage.globalRoot().resolve("version-objects").resolve("project-" + projectId);
    }

    public InputStream open(long projectId, String sha256) throws IOException {
        Path object = path(projectId, sha256);
        requireRegular(object);
        return Files.newInputStream(object);
    }

    public ObjectRef put(long projectId, InputStream source) throws IOException {
        return write(projectId, null, source);
    }

    public void importObject(long projectId, ObjectRef expected, InputStream source) throws IOException {
        write(projectId, expected, source);
    }

    private ObjectRef write(long projectId, ObjectRef expected, InputStream source) throws IOException {
        Path root = path(projectId, "0".repeat(64)).getParent().getParent();
        requireSafeParents(root);
        Files.createDirectories(root);
        Path temporary = Files.createTempFile(root, ".incoming-", ".tmp");
        try {
            MessageDigest digest = digest();
            long size = 0;
            try (OutputStream out = Files.newOutputStream(temporary)) {
                byte[] buffer = new byte[64 * 1024];
                int n;
                while ((n = source.read(buffer)) != -1) {
                    size += n;
                    if (expected != null && size > expected.size()) throw new IOException("Version object size mismatch");
                    digest.update(buffer, 0, n);
                    out.write(buffer, 0, n);
                }
            }
            ObjectRef actual = new ObjectRef(HexFormat.of().formatHex(digest.digest()), size);
            if (expected != null && !expected.equals(actual)) throw new IOException("Version object checksum mismatch");
            try (var channel = java.nio.channels.FileChannel.open(temporary, java.nio.file.StandardOpenOption.WRITE)) {
                channel.force(true);
            }
            Path destination = path(projectId, actual.sha256());
            requireSafeParents(destination.getParent());
            Files.createDirectories(destination.getParent());
            boolean publish = true;
            if (Files.exists(destination, LinkOption.NOFOLLOW_LINKS)) {
                requireRegular(destination);
                try { verify(projectId, actual); publish = false; }
                catch (IOException corrupt) { /* Verified incoming bytes can repair a damaged local cache. */ }
            }
            if (publish) {
                try {
                    Files.move(temporary, destination, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
                } catch (java.nio.file.AtomicMoveNotSupportedException e) {
                    Files.move(temporary, destination, StandardCopyOption.REPLACE_EXISTING);
                }
            }
            return actual;
        } finally {
            Files.deleteIfExists(temporary);
        }
    }

    public void verify(long projectId, ObjectRef object) throws IOException {
        Path file = path(projectId, object.sha256());
        requireRegular(file);
        if (Files.size(file) != object.size()) throw new IOException("Version object size mismatch");
        try (InputStream in = Files.newInputStream(file)) {
            if (!fingerprint(in).equals(object)) throw new IOException("Version object checksum mismatch");
        }
    }

    public List<ObjectRef> list(long projectId) throws IOException {
        Path root = path(projectId, "0".repeat(64)).getParent().getParent();
        if (!Files.isDirectory(root, LinkOption.NOFOLLOW_LINKS)) return List.of();
        List<ObjectRef> result = new ArrayList<>();
        try (var paths = Files.walk(root, 2)) {
            for (Path file : paths.filter(p -> Files.isRegularFile(p, LinkOption.NOFOLLOW_LINKS)).toList()) {
                String name = file.getFileName().toString();
                if (name.matches("[0-9a-f]{64}") && file.equals(path(projectId, name))) {
                    result.add(new ObjectRef(name, Files.size(file)));
                }
            }
        }
        return List.copyOf(result);
    }

    public List<Long> projectIds() throws IOException {
        Path root = storage.globalRoot().resolve("version-objects");
        if (!Files.isDirectory(root, LinkOption.NOFOLLOW_LINKS)) return List.of();
        try (var paths = Files.list(root)) {
            return paths.filter(p -> Files.isDirectory(p, LinkOption.NOFOLLOW_LINKS))
                    .map(p -> p.getFileName().toString()).filter(n -> n.matches("project-[0-9]+"))
                    .map(n -> Long.parseLong(n.substring(8))).toList();
        }
    }

    public long usageBytes(long projectId) throws IOException {
        Path root = path(projectId, "0".repeat(64)).getParent().getParent().getParent();
        if (!Files.isDirectory(root, LinkOption.NOFOLLOW_LINKS)) return 0;
        long total = 0;
        try (var paths = Files.walk(root)) {
            for (Path file : paths.filter(p -> Files.isRegularFile(p, LinkOption.NOFOLLOW_LINKS)).toList()) {
                total = Math.addExact(total, Files.size(file));
            }
        }
        return total;
    }

    /** Only used by an explicit project/history deletion or failed-clone compensation. */
    public void deleteProject(long projectId) throws IOException {
        Path root = path(projectId, "0".repeat(64)).getParent().getParent().getParent();
        requireSafeParents(root);
        if (!Files.exists(root, LinkOption.NOFOLLOW_LINKS)) return;
        try (var paths = Files.walk(root)) {
            for (Path path : paths.sorted(java.util.Comparator.reverseOrder()).toList()) Files.delete(path);
        }
    }

    public static ObjectRef fingerprint(InputStream source) throws IOException {
        MessageDigest digest = digest();
        long size = 0;
        byte[] buffer = new byte[64 * 1024];
        int n;
        while ((n = source.read(buffer)) != -1) {
            digest.update(buffer, 0, n);
            size += n;
        }
        return new ObjectRef(HexFormat.of().formatHex(digest.digest()), size);
    }

    private static MessageDigest digest() {
        try { return MessageDigest.getInstance("SHA-256"); }
        catch (java.security.NoSuchAlgorithmException e) { throw new IllegalStateException(e); }
    }

    private void requireRegular(Path path) throws IOException {
        if (!Files.isRegularFile(path, LinkOption.NOFOLLOW_LINKS)) throw new IOException("Version object is unavailable");
        requireSafeParents(path.getParent());
    }

    private void requireSafeParents(Path directory) throws IOException {
        for (Path p = directory; p != null && !p.equals(storage.globalRoot()); p = p.getParent()) {
            if (Files.isSymbolicLink(p)) throw new IOException("Version object path is a symbolic link");
        }
    }
}
