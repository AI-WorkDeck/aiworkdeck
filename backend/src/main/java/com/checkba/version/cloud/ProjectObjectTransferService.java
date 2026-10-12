// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.version.cloud;

import com.checkba.service.mobile.CloudStorageQuotaService;
import com.checkba.version.objects.LocalVersionObjectStore;
import com.checkba.version.objects.LocalVersionObjectStore.ObjectRef;
import org.springframework.stereotype.Service;

import java.io.*;
import java.nio.file.*;
import java.util.*;

/** Bounded, resumable transport for project-authorized collaboration replicas. */
@Service
public class ProjectObjectTransferService {
    public static final int PART_BYTES = 32 * 1024 * 1024;
    private final LocalVersionObjectStore objects;
    private final CloudStorageQuotaService quota;
    @org.springframework.beans.factory.annotation.Autowired(required = false)
    private org.springframework.transaction.PlatformTransactionManager transactions;

    public ProjectObjectTransferService(LocalVersionObjectStore objects, CloudStorageQuotaService quota) {
        this.objects = objects;
        this.quota = quota;
    }

    public static long partSize(ObjectRef ref, int part) {
        long offset = (long) part * PART_BYTES;
        if (part < 0 || (offset >= ref.size() && !(part == 0 && ref.size() == 0)))
            throw new IllegalArgumentException("Invalid object part");
        return Math.min(PART_BYTES, ref.size() - offset);
    }

    private Path parts(long projectId, ObjectRef ref) throws IOException {
        Path root = objects.path(projectId, ref.sha256()).getParent().getParent().getParent()
                .resolve("transfers").resolve(ref.sha256());
        // Match the store's boundary: /var may legitimately resolve to /private/var on macOS.
        Path storageRoot = objects.projectRoot(projectId).getParent().getParent();
        for (Path p = root; p != null && !p.equals(storageRoot); p = p.getParent()) {
            if (Files.isSymbolicLink(p)) throw new IOException("Invalid transfer directory");
        }
        return root;
    }

    public Map<String, Object> status(long projectId, ObjectRef ref) throws IOException {
        if (Files.exists(objects.path(projectId, ref.sha256()), LinkOption.NOFOLLOW_LINKS)) {
            try {
                objects.verify(projectId, ref);
                return Map.of("complete", true, "parts", List.of());
            } catch (IOException damaged) { /* A verified re-upload can repair a damaged replica. */ }
        }
        Path root = parts(projectId, ref);
        List<Integer> ready = new ArrayList<>();
        if (Files.isDirectory(root, LinkOption.NOFOLLOW_LINKS)) try (var files = Files.list(root)) {
            for (Path file : files.toList()) {
                String name = file.getFileName().toString();
                if (!name.matches("[0-9]{1,8}\\.part") || !Files.isRegularFile(file, LinkOption.NOFOLLOW_LINKS)) continue;
                int index = Integer.parseInt(name.substring(0, name.length() - 5));
                try { if (Files.size(file) == partSize(ref, index)) ready.add(index); }
                catch (IllegalArgumentException ignored) { }
            }
        }
        return Map.of("complete", false, "parts", ready);
    }

    /** Stream before acquiring a database connection; only quota reservation and publication hold the lock. */
    public void putPart(long projectId, ObjectRef ref, int part, String sha256, InputStream body) throws IOException {
        putPart(projectId, ref, part, sha256, body, Runnable::run);
    }

    public void putPart(long projectId, ObjectRef ref, int part, String sha256, InputStream body,
                        java.util.function.Consumer<Runnable> publicationLock) throws IOException {
        long size = partSize(ref, part);
        ObjectRef expectedPart = new ObjectRef(sha256, size);
        Path root = parts(projectId, ref);
        Path destination = root.resolve(part + ".part");
        if (Files.isRegularFile(destination, LinkOption.NOFOLLOW_LINKS)) {
            try (InputStream in = Files.newInputStream(destination)) {
                if (LocalVersionObjectStore.fingerprint(in).equals(expectedPart)) return;
            }
        }
        Path temporary = Files.createTempFile("awd-collab-part-", ".tmp");
        try {
            try (OutputStream out = Files.newOutputStream(temporary)) {
                long written = body.transferTo(new BoundedOutputStream(out, size));
                if (written != size) throw new IOException("Object part size mismatch");
            }
            try (InputStream in = Files.newInputStream(temporary)) {
                if (!LocalVersionObjectStore.fingerprint(in).equals(expectedPart)) throw new IOException("Object part checksum mismatch");
            }
            publicationLock.accept(() -> {
                Path replica = objects.path(projectId, ref.sha256());
                final boolean damagedReplica;
                try {
                    // Hash outside the database transaction, under the caller's project lock.
                    // A client-supplied size must never turn a valid object into repair credit.
                    if (Files.exists(replica, LinkOption.NOFOLLOW_LINKS)) {
                        ObjectRef actual;
                        try (InputStream in = objects.open(projectId, ref.sha256())) {
                            actual = LocalVersionObjectStore.fingerprint(in);
                        }
                        if (actual.sha256().equals(ref.sha256())) {
                            if (!actual.equals(ref)) throw new IOException("Object size mismatch");
                            return;
                        }
                        damagedReplica = true;
                    } else damagedReplica = false;
                } catch (IOException e) { throw new UncheckedIOException(e); }
                Runnable publish = () -> {
                    quota.lockProjectForWrite(projectId);
                    try {
                        // Discard only proven corrupt bytes, so repair does not require two copies
                        // of the user's quota. Temporary received bytes are not persistent storage.
                        if (damagedReplica) Files.delete(replica);
                        long previous = Files.isRegularFile(destination, LinkOption.NOFOLLOW_LINKS)
                                ? Files.size(destination) : 0;
                        quota.requireProjectCapacity(projectId, Math.max(0, size - previous));
                        Files.createDirectories(root);
                        try { Files.move(temporary, destination, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING); }
                        catch (AtomicMoveNotSupportedException e) { Files.move(temporary, destination, StandardCopyOption.REPLACE_EXISTING); }
                    } catch (IOException e) { throw new UncheckedIOException(e); }
                };
                if (transactions == null) publish.run();
                else new org.springframework.transaction.support.TransactionTemplate(transactions).executeWithoutResult(status -> publish.run());
            });
        } catch (UncheckedIOException e) { throw e.getCause(); }
        finally { Files.deleteIfExists(temporary); }
    }

    public void complete(long projectId, ObjectRef ref) throws IOException {
        if (Files.exists(objects.path(projectId, ref.sha256()), LinkOption.NOFOLLOW_LINKS)) {
            try {
                objects.verify(projectId, ref);
                clearParts(projectId, ref);
                return;
            } catch (IOException damaged) { /* Reassemble and atomically replace only after verification. */ }
        }
        Path root = parts(projectId, ref);
        int count = Math.toIntExact(Math.max(1, (ref.size() - 1) / PART_BYTES + 1));
        for (int i = 0; i < count; i++) {
            Path file = root.resolve(i + ".part");
            if (!Files.isRegularFile(file, LinkOption.NOFOLLOW_LINKS) || Files.size(file) != partSize(ref, i))
                throw new IOException("Object upload is incomplete");
        }
        // Open at most one part at a time, even for multi-gigabyte recordings.
        Enumeration<InputStream> streams = new Enumeration<>() {
            int index;
            public boolean hasMoreElements() { return index < count; }
            public InputStream nextElement() {
                try { return Files.newInputStream(root.resolve(index++ + ".part")); }
                catch (IOException e) { throw new UncheckedIOException(e); }
            }
        };
        try (InputStream in = new SequenceInputStream(streams)) { objects.importObject(projectId, ref, in); }
        catch (IOException | UncheckedIOException invalid) {
            // Do not advertise corrupt same-sized parts as ready forever on every retry.
            clearParts(projectId, ref);
            throw invalid;
        }
        clearParts(projectId, ref);
    }

    private void clearParts(long projectId, ObjectRef ref) throws IOException {
        Path root = parts(projectId, ref);
        if (!Files.isDirectory(root, LinkOption.NOFOLLOW_LINKS)) return;
        try (var files = Files.list(root)) {
            for (Path file : files.toList()) Files.deleteIfExists(file);
        }
        Files.deleteIfExists(root);
    }

    private static class BoundedOutputStream extends FilterOutputStream {
        private long remaining;
        BoundedOutputStream(OutputStream out, long max) { super(out); remaining = max; }
        @Override public void write(int b) throws IOException {
            if (remaining-- <= 0) throw new IOException("Object part is too large");
            out.write(b);
        }
        @Override public void write(byte[] b, int off, int len) throws IOException {
            if (len > remaining) throw new IOException("Object part is too large");
            remaining -= len; out.write(b, off, len);
        }
    }
}
