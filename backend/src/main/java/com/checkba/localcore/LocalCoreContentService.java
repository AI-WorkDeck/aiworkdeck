// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.localcore;

import com.fasterxml.jackson.databind.ObjectMapper;

import javax.sql.DataSource;
import java.io.IOException;
import java.io.InputStream;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.channels.SeekableByteChannel;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.nio.file.StandardCopyOption;
import java.nio.file.attribute.BasicFileAttributes;
import java.nio.file.attribute.BasicFileAttributeView;
import java.nio.file.attribute.AclFileAttributeView;
import java.nio.file.attribute.PosixFileAttributeView;
import java.nio.file.attribute.PosixFileAttributes;
import java.nio.file.attribute.PosixFilePermissions;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HexFormat;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.locks.ReentrantLock;
import java.util.concurrent.TimeUnit;

/**
 * Complete-file saves while the JDBC core exclusively owns the profile. The caller must hold a
 * CORE lease for the whole call and exclude other database-writing processes. Each fresh connection
 * enforces synchronous H2 commits before starting its transaction; it cannot inherit a caller's
 * transaction. One instance is shared by every core request in the profile. Its
 * publication mutex also covers overlapping local roots; JPA business writers must not start until
 * all core leases have drained. This class is not a second writer alongside live JPA services.
 *
 * Journal recovery never writes to the document path. A matching after-image permits finishing
 * metadata and its receipt; different external bytes are a conflict. Normal publication checks
 * content and parent/file identities immediately before an atomic rename, but this is NOT an atomic
 * compare-and-swap against arbitrary external editors that do not participate in our lock.
 */
public final class LocalCoreContentService {
    private static final String RECEIPT_PREFIX = "local.core.save.v1.";
    private static final String HANDOFF_PREFIX = "local.core.handoff.v1.";
    private static final String CANCEL_PREFIX = "local.core.cancel.v1.";
    private static final Set<java.nio.file.OpenOption> READ = Set.of(StandardOpenOption.READ, LinkOption.NOFOLLOW_LINKS);
    private static final Set<java.nio.file.OpenOption> CREATE = Set.of(StandardOpenOption.WRITE, StandardOpenOption.CREATE_NEW, LinkOption.NOFOLLOW_LINKS);
    private final DataSource database;
    private final LocalCoreStore store;
    private final Path journalRoot;
    private final String databaseIdentity;
    private final long maxBytes;
    private final ObjectMapper json = new ObjectMapper();
    private final ReentrantLock publication = new ReentrantLock();
    private final FaultInjector faults;

    public record SaveRequest(UUID operationId, long projectId, long fileId, String uid, long actorId,
                              String expectedSha256, long contentLength) {}
    public record SaveReceipt(SaveRequest request, String afterSha256, long size, String committedAt) {}
    @FunctionalInterface public interface Publication {
        SaveReceipt run() throws IOException, SQLException;
    }
    @FunctionalInterface public interface PublicationGuard {
        /** Synchronously invoke publication once, or reject before invoking it. Never retain it. */
        SaveReceipt run(Publication publication) throws IOException, SQLException;
    }
    public record OperationResult(SaveReceipt completed, SaveRequest cancelled) {
        public OperationResult {
            if ((completed == null) == (cancelled == null)) throw new IllegalArgumentException("Exactly one terminal result is required");
        }
    }
    @FunctionalInterface public interface Cancellation {
        OperationResult run() throws IOException, SQLException;
    }
    @FunctionalInterface public interface CancellationGuard {
        /** Synchronously invoke cancellation once, or reject before invoking it. Never retain it. */
        OperationResult run(Cancellation cancellation) throws IOException, SQLException;
    }
    public enum RecoveryState { COMPLETED, CANCELLED, RETRYABLE, CONFLICT }
    public record RecoveryItem(UUID operationId, RecoveryState state, String code) {}
    public record RecoveryReport(List<RecoveryItem> items) {}
    /** Internal handoff input only; these paths must never be exposed in an HTTP response. */
    public record BeforeImage(long receiptSequence, SaveRequest request, String storageKey, String externalPath,
                              String targetPath, String beforeSha256, long beforeSize, Path image) {}

    public static final class ContentException extends IOException {
        private final String code;
        private final boolean publicationMayHaveOccurred;
        ContentException(String code, boolean publicationMayHaveOccurred, Throwable cause) {
            super(code, cause); this.code = code; this.publicationMayHaveOccurred = publicationMayHaveOccurred;
        }
        public String code() { return code; }
        /**
         * Publication boundary of this invocation only. False does not prove the operation never
         * published: an earlier attempt may already have a journal or completed receipt.
         */
        public boolean publicationMayHaveOccurred() { return publicationMayHaveOccurred; }
    }

    enum FaultPoint { AFTER_MANIFEST, BEFORE_ATTRIBUTE_COPY, AFTER_ATTRIBUTE_COPY, BEFORE_ATOMIC_MOVE, AFTER_PUBLISH, AFTER_METADATA, AFTER_COMMIT, AFTER_CANCEL_COMMIT }
    @FunctionalInterface interface FaultInjector { void at(FaultPoint point) throws IOException; }
    private record Manifest(int version, String databaseIdentity, SaveRequest request, String storageKey,
                            String externalPath, String targetPath, String parentFileKey, String afterSha256, long beforeSize,
                            String updatedAt) {}
    private record StoredReceipt(String databaseIdentity, SaveReceipt receipt) {}
    private record StoredCancellation(String databaseIdentity, SaveRequest request, String cancelledAt) {}
    private record ReceiptRow(long sequence, SaveReceipt receipt) {}
    private record HandoffAck(String databaseIdentity, long receiptSequence, SaveRequest request,
                              String storageKey, String externalPath, String targetPath, String beforeSha256,
                              long beforeSize, String outcome) {}
    private record Image(String sha, long size, Object fileKey, PosixFileAttributes attributes) {}

    /** journalRoot must already exist, be private to this profile, and contain no symbolic links. */
    public LocalCoreContentService(DataSource database, LocalCoreStore store, Path journalRoot,
                                   String databaseIdentity, long maxBytes) throws IOException {
        this(database, store, journalRoot, databaseIdentity, maxBytes, point -> {});
    }

    LocalCoreContentService(DataSource database, LocalCoreStore store, Path journalRoot,
                            String databaseIdentity, long maxBytes, FaultInjector faults) throws IOException {
        this.database = Objects.requireNonNull(database); this.store = Objects.requireNonNull(store);
        if (journalRoot == null || !journalRoot.isAbsolute() || !journalRoot.equals(journalRoot.normalize()))
            throw new IllegalArgumentException("An absolute normalized journal directory is required");
        if (databaseIdentity == null || databaseIdentity.isBlank() || databaseIdentity.length() > 256 || maxBytes <= 0)
            throw new IllegalArgumentException("A database identity and positive content limit are required");
        this.journalRoot = journalRoot; this.databaseIdentity = databaseIdentity; this.maxBytes = maxBytes;
        this.faults = Objects.requireNonNull(faults);
        try (var root = directory(journalRoot)) { sync(root); }
    }

    public SaveReceipt save(SaveRequest request, InputStream content) throws IOException, SQLException {
        return save(request, content, Publication::run);
    }

    /**
     * Optional caller lock after receiving the entire body: caller guard -> publication mutex -> DB.
     * The guard surrounds commit, rollback and uncertain-result propagation. It does not supply
     * authority leases, JPA authorization or handoff policy; those remain the integration's job.
     */
    public SaveReceipt save(SaveRequest request, InputStream content, PublicationGuard guard) throws IOException, SQLException {
        validate(request);
        if (request.contentLength() > maxBytes) throw failure("INVALID_SAVE_REQUEST");
        Objects.requireNonNull(content);
        Objects.requireNonNull(guard);
        // Receiving a slow HTTP body must not hold the publication mutex or the identity row lock.
        Path upload = Path.of(".upload-" + UUID.randomUUID());
        try (var root = directory(journalRoot)) {
            Image incoming;
            try (var output = root.newByteChannel(upload, CREATE, PosixFilePermissions.asFileAttribute(PosixFilePermissions.fromString("rw-------")))) {
                incoming = copy(content, output, request.contentLength());
                force(output);
            } catch (IOException | RuntimeException | Error failure) {
                removeTemporary(root, upload); throw failure;
            }
            try {
                return guard.run(() -> {
                    publication.lock();
                    try { return publish(root, upload, incoming, request); }
                    finally { publication.unlock(); }
                });
            } finally {
                removeTemporary(root, upload);
            }
        }
    }

    /** Read-only replay lookup. It still requires the exact request and fresh current write access. */
    public Optional<SaveReceipt> completedReceipt(SaveRequest request) throws IOException, SQLException {
        return operationResult(request).map(OperationResult::completed);
    }

    /** Exact-request terminal lookup, including durable cancellation; current write access is required. */
    public Optional<OperationResult> operationResult(SaveRequest request) throws IOException, SQLException {
        validate(request);
        publication.lock();
        try (Connection c = connection()) {
            authorize(c, request);
            ReceiptRow row = receipt(c, request.operationId());
            if (row != null) {
                requireRequest(row.receipt().request(), request);
                c.rollback(); return Optional.of(new OperationResult(row.receipt(), null));
            }
            StoredCancellation cancelled = cancellation(c, request.operationId());
            if (cancelled != null) requireRequest(cancelled.request(), request);
            c.rollback();
            return cancelled == null ? Optional.empty() : Optional.of(new OperationResult(null, cancelled.request()));
        } finally { publication.unlock(); }
    }

    public OperationResult cancel(SaveRequest request) throws IOException, SQLException {
        return cancel(request, Cancellation::run);
    }

    /**
     * Stops every future publication of this exact operation. Cancellation never writes document
     * bytes and does not assert that a previous attempt never published. If the current target still
     * matches a prepared after-image, finish its metadata/receipt instead of falsely cancelling it.
     * The integration supplies the same project guard as saves, before this profile mutex/DB lock.
     */
    public OperationResult cancel(SaveRequest request, CancellationGuard guard) throws IOException, SQLException {
        validate(request); Objects.requireNonNull(guard);
        return guard.run(() -> {
            publication.lock();
            try (var root = directory(journalRoot); Connection c = connection()) {
                try {
                    var target = authorize(c, request);
                    ReceiptRow prior = receipt(c, request.operationId());
                    if (prior != null) {
                        requireRequest(prior.receipt().request(), request);
                        c.rollback(); return new OperationResult(prior.receipt(), null);
                    }
                    StoredCancellation previous = cancellation(c, request.operationId());
                    if (previous != null) {
                        requireRequest(previous.request(), request);
                        c.rollback(); return new OperationResult(null, request);
                    }
                    Manifest manifest = manifest(root, request.operationId());
                    if (manifest != null) {
                        requireRequest(manifest.request(), request);
                        // A moved/rebuilt target cannot authorize completion from the old manifest.
                        // It can still be fenced: no branch here replays old bytes at either path.
                        boolean sameTarget;
                        try { requireTarget(manifest, target); sameTarget = true; }
                        catch (ContentException changed) {
                            if (!"TARGET_CHANGED".equals(changed.code())) throw changed;
                            sameTarget = false;
                        }
                        if (sameTarget) try (var parent = directory(target.path().getParent())) {
                            var attributes = parent.getFileAttributeView(target.path().getFileName(), PosixFileAttributeView.class,
                                    LinkOption.NOFOLLOW_LINKS).readAttributes();
                            if (attributes.isRegularFile() && attributes.size() == request.contentLength()
                                    && image(parent, target.path().getFileName(), null, request.contentLength()).sha().equals(manifest.afterSha256())) {
                                verifyImages(root, manifest);
                                SaveReceipt completed = complete(c, target, manifest);
                                c.commit(); faults.at(FaultPoint.AFTER_CANCEL_COMMIT);
                                return new OperationResult(completed, null);
                            }
                        }
                    }
                    try (PreparedStatement s = c.prepareStatement("INSERT INTO system_setting(config_key, \"value\") VALUES (?, ?)")) {
                        s.setString(1, CANCEL_PREFIX + request.operationId());
                        s.setString(2, json.writeValueAsString(new StoredCancellation(databaseIdentity, request, Instant.now().toString())));
                        s.executeUpdate();
                    }
                    c.commit(); faults.at(FaultPoint.AFTER_CANCEL_COMMIT);
                    return new OperationResult(null, request);
                } catch (IOException | SQLException | RuntimeException | Error failure) {
                    try { c.rollback(); } catch (SQLException rollback) { failure.addSuppressed(rollback); }
                    throw failure;
                }
            } finally { publication.unlock(); }
        });
    }

    private SaveReceipt publish(Directory root, Path upload, Image incoming,
                                SaveRequest request) throws IOException, SQLException {
        boolean published = false;
        try (Connection c = connection()) {
            try {
                var target = authorize(c, request);
                ReceiptRow prior = receipt(c, request.operationId());
                if (prior != null) {
                    requireRequest(prior.receipt().request(), request);
                    if (!prior.receipt().afterSha256().equals(incoming.sha())) throw failure("OPERATION_REUSE");
                    c.rollback();
                    return prior.receipt();
                }
                StoredCancellation cancelled = cancellation(c, request.operationId());
                if (cancelled != null) {
                    requireRequest(cancelled.request(), request);
                    throw failure("OPERATION_CANCELLED");
                }
                Manifest manifest = manifest(root, request.operationId());
                if (manifest != null) {
                    requireRequest(manifest.request(), request); requireTarget(manifest, target);
                    if (!manifest.afterSha256().equals(incoming.sha())) throw failure("OPERATION_REUSE");
                    verifyImages(root, manifest);
                }
                rejectOtherPending(root, c, target, request.operationId());
                try (var parent = directory(target.path().getParent())) {
                    Path name = target.path().getFileName();
                    Image current = image(parent, name, null);
                    // A previous attempt may have published and then lost its DB transaction.
                    if (manifest != null && current.sha().equals(manifest.afterSha256())) {
                        published = true;
                        SaveReceipt result = complete(c, target, manifest);
                        c.commit(); faults.at(FaultPoint.AFTER_COMMIT); return result;
                    }
                    if (!current.sha().equals(request.expectedSha256())) throw failure("CONTENT_CONFLICT");
                    if (manifest == null) {
                        Path before = name(request.operationId(), ".before");
                        // A crash before publishing the manifest may leave unreferenced image files.
                        // They are not a durable operation or a baseline; unlink only these owned names.
                        removeOrphan(root, before); removeOrphan(root, name(request.operationId(), ".after"));
                        Image copied;
                        try (var output = root.newByteChannel(before, CREATE, PosixFilePermissions.asFileAttribute(PosixFilePermissions.fromString("rw-------")))) {
                            copied = image(parent, name, output); force(output);
                        }
                        if (!copied.sha().equals(current.sha()) || !Objects.equals(copied.fileKey(), current.fileKey()))
                            throw failure("CONTENT_CONFLICT");
                        root.move(upload, root, name(request.operationId(), ".after"));
                        manifest = new Manifest(1, databaseIdentity, request, target.storageKey(), target.externalPath(),
                                target.path().toString(), parent.fileKey.toString(), incoming.sha(), copied.size(), LocalDateTime.now().toString());
                        writeManifest(root, manifest); // image data and directory entries precede the manifest.
                        faults.at(FaultPoint.AFTER_MANIFEST);
                    }
                    // Never use a manifest path as authority: re-read the live target and DD/ACL now.
                    requireTarget(manifest, authorize(c, request));
                    Image beforePublish = image(parent, name, null);
                    if (!beforePublish.sha().equals(request.expectedSha256()) || !Objects.equals(beforePublish.fileKey(), current.fileKey()))
                        throw failure("CONTENT_CONFLICT");
                    // A failed directory fsync may occur after rename. Conservatively classify the
                    // entire replacement attempt as uncertain rather than claiming no bytes changed.
                    published = true;
                    replace(root, parent, name, manifest, beforePublish.attributes());
                    faults.at(FaultPoint.AFTER_PUBLISH);
                    SaveReceipt result = complete(c, target, manifest);
                    c.commit(); faults.at(FaultPoint.AFTER_COMMIT); return result;
                }
            } catch (IOException | SQLException | RuntimeException | Error failure) {
                try { c.rollback(); } catch (SQLException rollback) { failure.addSuppressed(rollback); }
                if (published && !(failure instanceof Error)) throw new ContentException("SAVE_UNCERTAIN", true, failure);
                throw failure;
            }
        }
    }

    /**
     * Classify every durable operation; only an already-published matching after-image may complete
     * metadata. Before-images remain retryable. No branch writes, deletes, or renames the live file.
     * Completed records need no current-actor grant for this internal classification; they are not
     * returned as user-visible receipts. Pending completion always reauthorizes the pinned actor.
     */
    public RecoveryReport recoverPending() throws IOException, SQLException {
        publication.lock();
        try (var root = directory(journalRoot)) {
            List<RecoveryItem> results = new ArrayList<>();
            for (Manifest manifest : manifests(root)) {
                UUID id = manifest.request().operationId();
                try (Connection c = connection()) {
                    try {
                        ReceiptRow row = receipt(c, id);
                        if (row != null) {
                            requireReceipt(manifest, row.receipt());
                            HandoffAck ack = acknowledgement(c, id);
                            if (ack != null) {
                                if (!ack.equals(acknowledgement(beforeImage(row, manifest), ack.outcome()))) throw failure("HANDOFF_ACK_INVALID");
                            } else verifyImages(root, manifest);
                            results.add(new RecoveryItem(id, RecoveryState.COMPLETED, "ALREADY_COMPLETED"));
                            c.rollback();
                            continue;
                        }
                        StoredCancellation cancelled = cancellation(c, id);
                        if (cancelled != null) {
                            requireRequest(manifest.request(), cancelled.request());
                            results.add(new RecoveryItem(id, RecoveryState.CANCELLED, "OPERATION_CANCELLED"));
                            c.rollback(); continue;
                        }
                        verifyImages(root, manifest);
                        var target = authorize(c, manifest.request()); requireTarget(manifest, target);
                        try (var parent = directory(target.path().getParent())) {
                            Image current = image(parent, target.path().getFileName(), null,
                                    Math.max(manifest.beforeSize(), manifest.request().contentLength()));
                            if (current.sha().equals(manifest.afterSha256())) {
                                complete(c, target, manifest); c.commit();
                                results.add(new RecoveryItem(id, RecoveryState.COMPLETED, "METADATA_COMPLETED"));
                            } else if (current.sha().equals(manifest.request().expectedSha256())) {
                                results.add(new RecoveryItem(id, RecoveryState.RETRYABLE, "NOT_PUBLISHED"));
                            } else results.add(new RecoveryItem(id, RecoveryState.CONFLICT, "CONTENT_CONFLICT"));
                        }
                        c.rollback();
                    } catch (IOException | LocalCoreStore.LocalCoreException problem) {
                        c.rollback();
                        String code = problem instanceof ContentException content ? content.code()
                                : problem instanceof LocalCoreStore.LocalCoreException access ? access.code() : "JOURNAL_IO_FAILURE";
                        results.add(new RecoveryItem(id, RecoveryState.CONFLICT, code));
                    }
                }
            }
            return new RecoveryReport(List.copyOf(results));
        } finally { publication.unlock(); }
    }

    /** Validated, completed before-images in durable receipt order; caller chooses each UID's first. */
    public List<BeforeImage> beforeImagesForHandoff() throws IOException, SQLException {
        publication.lock();
        try (var root = directory(journalRoot); Connection c = connection()) {
            List<BeforeImage> result = new ArrayList<>();
            for (Manifest manifest : manifests(root)) {
                ReceiptRow row = receipt(c, manifest.request().operationId());
                if (row == null) continue;
                requireReceipt(manifest, row.receipt());
                BeforeImage before = beforeImage(row, manifest);
                HandoffAck ack = acknowledgement(c, manifest.request().operationId());
                if (ack != null) {
                    if (!ack.equals(acknowledgement(before, ack.outcome()))) throw failure("HANDOFF_ACK_INVALID");
                    continue;
                }
                verifyImages(root, manifest);
                result.add(before);
            }
            result.sort(Comparator.comparingLong(BeforeImage::receiptSequence));
            return List.copyOf(result);
        } finally { publication.unlock(); }
    }

    /**
     * Internal handoff only: call after Git succeeds or the caller deliberately applies a SKIP
     * policy. This durable, atomic batch records no more than 200 exact before-images and never
     * changes document files or removes the journal. Receipts remain available for old retries.
     */
    public void acknowledgeHandoff(List<BeforeImage> images, String outcome) throws IOException, SQLException {
        if (images == null || images.size() > 200 || !validOutcome(outcome)) throw failure("INVALID_HANDOFF_ACK");
        var operations = new java.util.HashSet<UUID>();
        for (BeforeImage image : images) {
            if (image == null || image.request() == null || image.request().operationId() == null
                    || !operations.add(image.request().operationId())) throw failure("INVALID_HANDOFF_ACK");
        }
        publication.lock();
        try (var root = directory(journalRoot); Connection c = connection()) {
            try {
                for (BeforeImage supplied : images) {
                    UUID id = supplied.request().operationId();
                    Manifest manifest = manifest(root, id); ReceiptRow receipt = receipt(c, id);
                    if (manifest == null || receipt == null) throw failure("HANDOFF_NOT_COMPLETED");
                    requireReceipt(manifest, receipt.receipt()); verifyImages(root, manifest);
                    if (!supplied.equals(beforeImage(receipt, manifest))) throw failure("HANDOFF_IMAGE_CHANGED");
                    HandoffAck expected = acknowledgement(supplied, outcome);
                    HandoffAck previous = acknowledgement(c, id);
                    if (previous != null) {
                        if (!previous.equals(expected)) throw failure("HANDOFF_ACK_CHANGED");
                        continue;
                    }
                    try (PreparedStatement statement = c.prepareStatement("INSERT INTO system_setting(config_key, \"value\") VALUES (?, ?)")) {
                        statement.setString(1, HANDOFF_PREFIX + id); statement.setString(2, json.writeValueAsString(expected));
                        statement.executeUpdate();
                    }
                }
                c.commit();
            } catch (IOException | SQLException | RuntimeException | Error failure) {
                try { c.rollback(); } catch (SQLException rollback) { failure.addSuppressed(rollback); }
                throw failure;
            }
        } finally { publication.unlock(); }
    }

    private BeforeImage beforeImage(ReceiptRow receipt, Manifest manifest) {
        return new BeforeImage(receipt.sequence(), manifest.request(), manifest.storageKey(), manifest.externalPath(),
                manifest.targetPath(), manifest.request().expectedSha256(), manifest.beforeSize(),
                journalRoot.resolve(name(manifest.request().operationId(), ".before")));
    }

    private HandoffAck acknowledgement(BeforeImage image, String outcome) {
        return new HandoffAck(databaseIdentity, image.receiptSequence(), image.request(), image.storageKey(), image.externalPath(),
                image.targetPath(), image.beforeSha256(), image.beforeSize(), outcome);
    }

    private HandoffAck acknowledgement(Connection c, UUID operation) throws SQLException, IOException {
        try (PreparedStatement statement = c.prepareStatement("SELECT \"value\" FROM system_setting WHERE config_key=?")) {
            statement.setString(1, HANDOFF_PREFIX + operation);
            try (ResultSet rows = statement.executeQuery()) {
                if (!rows.next()) return null;
                HandoffAck ack = json.readValue(rows.getString(1), HandoffAck.class);
                if (ack == null || !validOutcome(ack.outcome())) throw failure("HANDOFF_ACK_INVALID");
                return ack;
            }
        }
    }

    private static boolean validOutcome(String outcome) {
        return outcome != null && (outcome.matches("SKIP:[A-Z][A-Z0-9_]{0,63}")
                || outcome.matches("(?:EXISTING_HEAD|CREATED):[0-9a-f]{40}"));
    }

    private SaveReceipt complete(Connection c, LocalCoreStore.FileTarget target, Manifest manifest) throws SQLException, IOException {
        if (store.updateContentMetadata(c, target, manifest.request().contentLength(), LocalDateTime.parse(manifest.updatedAt())) != 1)
            throw failure("TARGET_CHANGED");
        faults.at(FaultPoint.AFTER_METADATA);
        SaveReceipt result = new SaveReceipt(manifest.request(), manifest.afterSha256(), manifest.request().contentLength(), Instant.now().toString());
        try (PreparedStatement s = c.prepareStatement("INSERT INTO system_setting(config_key, \"value\") VALUES (?, ?)")) {
            s.setString(1, RECEIPT_PREFIX + manifest.request().operationId());
            s.setString(2, json.writeValueAsString(new StoredReceipt(databaseIdentity, result))); s.executeUpdate();
        }
        return result;
    }

    private LocalCoreStore.FileTarget authorize(Connection c, SaveRequest request) throws SQLException, IOException {
        var target = store.lockFileTargetForWrite(c, request.projectId(), request.fileId());
        if (target.actor().id() != request.actorId()) throw failure("IDENTITY_CHANGED");
        if (target.uid() == null || target.uid().isBlank()) throw failure("LEGACY_UID_REQUIRED");
        if (!target.uid().equals(request.uid())) throw failure("TARGET_CHANGED");
        return target;
    }

    private Connection connection() throws SQLException {
        Connection c = database.getConnection();
        try {
            // H2 SET may commit, so reject an inherited transaction before any settings/isolation
            // change. Opening a file database can restore the default delay despite a prior SET.
            if (!c.getAutoCommit()) throw new SQLException("Core content requires a fresh auto-commit connection");
            try (var statement = c.createStatement()) { statement.execute("SET WRITE_DELAY 0"); }
            c.setTransactionIsolation(Connection.TRANSACTION_READ_COMMITTED);
            c.setAutoCommit(false);
            return c;
        }
        catch (SQLException failure) { c.close(); throw failure; }
    }

    private ReceiptRow receipt(Connection c, UUID id) throws SQLException, IOException {
        try (PreparedStatement s = c.prepareStatement("SELECT id, \"value\" FROM system_setting WHERE config_key=?")) {
            s.setString(1, RECEIPT_PREFIX + id);
            try (ResultSet r = s.executeQuery()) {
                if (!r.next()) return null;
                StoredReceipt stored = json.readValue(r.getString(2), StoredReceipt.class);
                if (stored == null || !databaseIdentity.equals(stored.databaseIdentity()) || stored.receipt() == null || stored.receipt().request() == null
                        || !id.equals(stored.receipt().request().operationId())) throw failure("RECEIPT_INVALID");
                validate(stored.receipt().request());
                if (!sha(stored.receipt().afterSha256()) || stored.receipt().size() != stored.receipt().request().contentLength()
                        || stored.receipt().committedAt() == null) throw failure("RECEIPT_INVALID");
                try { Instant.parse(stored.receipt().committedAt()); } catch (RuntimeException invalid) { throw failure("RECEIPT_INVALID"); }
                return new ReceiptRow(r.getLong(1), stored.receipt());
            }
        }
    }

    private StoredCancellation cancellation(Connection c, UUID id) throws SQLException, IOException {
        try (PreparedStatement s = c.prepareStatement("SELECT \"value\" FROM system_setting WHERE config_key=?")) {
            s.setString(1, CANCEL_PREFIX + id);
            try (ResultSet rows = s.executeQuery()) {
                if (!rows.next()) return null;
                StoredCancellation result = json.readValue(rows.getString(1), StoredCancellation.class);
                if (result == null || !databaseIdentity.equals(result.databaseIdentity()) || result.request() == null
                        || !id.equals(result.request().operationId())) throw failure("CANCELLATION_INVALID");
                validate(result.request());
                try { Instant.parse(result.cancelledAt()); } catch (RuntimeException invalid) { throw failure("CANCELLATION_INVALID"); }
                return result;
            }
        }
    }

    private void rejectOtherPending(Directory root, Connection c, LocalCoreStore.FileTarget target, UUID own) throws IOException, SQLException {
        for (Manifest candidate : manifests(root)) {
            if (!candidate.request().operationId().equals(own)
                    && (candidate.targetPath().equals(target.path().toString()) || candidate.request().uid().equals(target.uid()))
                    && receipt(c, candidate.request().operationId()) == null) {
                StoredCancellation cancelled = cancellation(c, candidate.request().operationId());
                if (cancelled == null) throw failure("PENDING_SAVE_REQUIRES_RECOVERY");
                requireRequest(candidate.request(), cancelled.request());
            }
        }
    }

    private void requireTarget(Manifest manifest, LocalCoreStore.FileTarget target) throws IOException {
        if (!Objects.equals(manifest.storageKey(), target.storageKey()) || !Objects.equals(manifest.externalPath(), target.externalPath())
                || !manifest.targetPath().equals(target.path().toString())) throw failure("TARGET_CHANGED");
        try (var parent = directory(target.path().getParent())) {
            if (!manifest.parentFileKey().equals(parent.fileKey.toString())) throw failure("TARGET_CHANGED");
        }
    }
    private void requireRequest(SaveRequest expected, SaveRequest actual) throws IOException {
        if (!expected.equals(actual)) throw failure("OPERATION_REUSE");
    }
    private void requireReceipt(Manifest manifest, SaveReceipt receipt) throws IOException {
        requireRequest(manifest.request(), receipt.request());
        if (!manifest.afterSha256().equals(receipt.afterSha256())) throw failure("RECEIPT_INVALID");
    }

    private Manifest manifest(Directory root, UUID id) throws IOException {
        Path file = name(id, ".json");
        try (var input = root.newByteChannel(file, READ)) {
            if (input.size() > 64 * 1024) throw failure("JOURNAL_INVALID");
            Manifest manifest = json.readValue(java.nio.channels.Channels.newInputStream(input), Manifest.class);
            if (manifest == null || manifest.version() != 1 || !databaseIdentity.equals(manifest.databaseIdentity()) || manifest.request() == null
                    || !id.equals(manifest.request().operationId()) || manifest.targetPath() == null || manifest.storageKey() == null
                    || manifest.parentFileKey() == null || !sha(manifest.afterSha256()) || manifest.beforeSize() < 0)
                throw failure("JOURNAL_INVALID");
            validate(manifest.request());
            try { LocalDateTime.parse(manifest.updatedAt()); } catch (RuntimeException badDate) { throw failure("JOURNAL_INVALID"); }
            return manifest;
        } catch (java.nio.file.NoSuchFileException absent) { return null; }
    }

    private List<Manifest> manifests(Directory root) throws IOException {
        List<Manifest> result = new ArrayList<>();
        root.check();
        try (var entries = Files.newDirectoryStream(root.path)) {
            for (Path entry : entries) {
                String file = entry.getFileName().toString();
                if (!file.endsWith(".json")) continue;
                UUID id;
                try { id = UUID.fromString(file.substring(0, file.length() - 5)); }
                catch (IllegalArgumentException invalid) { throw failure("JOURNAL_INVALID"); }
                if (!file.equals(id + ".json")) throw failure("JOURNAL_INVALID");
                Manifest manifest = manifest(root, id);
                if (manifest == null) throw failure("JOURNAL_INVALID");
                result.add(manifest);
            }
        }
        root.check();
        result.sort(Comparator.comparing(m -> m.request().operationId()));
        return result;
    }

    private void verifyImages(Directory root, Manifest manifest) throws IOException {
        Image before = image(root, name(manifest.request().operationId(), ".before"), null, manifest.beforeSize());
        Image after = image(root, name(manifest.request().operationId(), ".after"), null, manifest.request().contentLength());
        if (!before.sha().equals(manifest.request().expectedSha256()) || before.size() != manifest.beforeSize()
                || !after.sha().equals(manifest.afterSha256()) || after.size() != manifest.request().contentLength())
            throw failure("JOURNAL_IMAGE_INVALID");
    }

    private void writeManifest(Directory root, Manifest manifest) throws IOException {
        sync(root);
        Path temporary = Path.of(".manifest-" + UUID.randomUUID());
        try {
            try (var channel = root.newByteChannel(temporary, CREATE, PosixFilePermissions.asFileAttribute(PosixFilePermissions.fromString("rw-------")))) {
                ByteBuffer bytes = ByteBuffer.wrap(json.writeValueAsBytes(manifest));
                while (bytes.hasRemaining()) channel.write(bytes);
                force(channel);
            }
            root.move(temporary, root, name(manifest.request().operationId(), ".json")); sync(root);
        } finally { removeTemporary(root, temporary); }
    }

    private void replace(Directory root, Directory parent, Path name,
                         Manifest manifest, PosixFileAttributes permissions) throws IOException {
        Path temporary = Path.of(".awd-core-save-" + UUID.randomUUID());
        try {
            Object temporaryKey = prepareReplacement(parent, name, temporary, permissions);
            try (var source = root.newByteChannel(name(manifest.request().operationId(), ".after"), READ);
                 var output = parent.newByteChannel(temporary, Set.of(StandardOpenOption.WRITE, StandardOpenOption.TRUNCATE_EXISTING, LinkOption.NOFOLLOW_LINKS))) {
                Image copied = copy(java.nio.channels.Channels.newInputStream(source), output, manifest.request().contentLength());
                if (!copied.sha().equals(manifest.afterSha256())) throw failure("JOURNAL_IMAGE_INVALID");
                requireRegularIdentity(parent, temporary, temporaryKey);
                // macOS cp -p retains ACL/xattrs but can substitute the old mtime for birthtime.
                Files.getFileAttributeView(parent.resolve(temporary), BasicFileAttributeView.class, LinkOption.NOFOLLOW_LINKS)
                        .setTimes(null, null, permissions.creationTime());
                if (!Files.readAttributes(parent.resolve(temporary), BasicFileAttributes.class, LinkOption.NOFOLLOW_LINKS)
                        .creationTime().equals(permissions.creationTime())) throw failure("FILE_ATTRIBUTES_NOT_PRESERVED");
                force(output);
            }
            // No non-atomic fallback: unsupported atomic replacement leaves the journal retryable.
            // These checks detect ordinary Finder moves/replacements, not adversarial last-instant
            // directory swaps. The same external-writer CAS limitation is stated at class level.
            faults.at(FaultPoint.BEFORE_ATOMIC_MOVE);
            parent.check();
            Image current = image(parent, name, null);
            if (!current.sha().equals(manifest.request().expectedSha256())
                    || !Objects.equals(current.fileKey(), permissions.fileKey())) throw failure("CONTENT_CONFLICT");
            requireRegularIdentity(parent, temporary, temporaryKey);
            parent.move(temporary, parent, name); sync(parent);
            if (!Objects.equals(temporaryKey, Files.readAttributes(parent.resolve(name), BasicFileAttributes.class, LinkOption.NOFOLLOW_LINKS).fileKey()))
                throw failure("CONTENT_CONFLICT");
            parent.check();
        } finally { removeTemporary(parent, temporary); }
    }

    private Object prepareReplacement(Directory parent, Path original, Path temporary, PosixFileAttributes sourceAttributes) throws IOException {
        parent.check(); requireRegularIdentity(parent, original, sourceAttributes.fileKey());
        if (System.getProperty("os.name").startsWith("Mac")) {
            // -P applies to the source only. Reserve and verify the destination inode ourselves;
            // this detects ordinary replacements, not an adversarial race inside cp itself.
            try (var reserved = parent.newByteChannel(temporary, CREATE,
                    PosixFilePermissions.asFileAttribute(PosixFilePermissions.fromString("rw-------")))) { force(reserved); }
            Object temporaryKey = Files.readAttributes(parent.resolve(temporary), BasicFileAttributes.class, LinkOption.NOFOLLOW_LINKS).fileKey();
            faults.at(FaultPoint.BEFORE_ATTRIBUTE_COPY);
            requireRegularIdentity(parent, original, sourceAttributes.fileKey());
            requireRegularIdentity(parent, temporary, temporaryKey);
            ProcessBuilder command = new ProcessBuilder("/bin/cp", "-pP", parent.resolve(original).toString(), parent.resolve(temporary).toString())
                    .redirectOutput(ProcessBuilder.Redirect.DISCARD).redirectError(ProcessBuilder.Redirect.DISCARD);
            command.environment().remove("COPYFILE_DISABLE");
            awaitAttributeCopy(command.start(), Duration.ofSeconds(10));
            faults.at(FaultPoint.AFTER_ATTRIBUTE_COPY);
            requireRegularIdentity(parent, original, sourceAttributes.fileKey());
            requireRegularIdentity(parent, temporary, temporaryKey);
            return temporaryKey;
        }
        // Do not treat a missing ACL view as an empty ACL on an unverified provider.
        var sourceAcl = Files.getFileAttributeView(parent.resolve(original), AclFileAttributeView.class, LinkOption.NOFOLLOW_LINKS);
        if (sourceAcl == null) throw failure("FILE_ATTRIBUTES_UNSUPPORTED");
        Files.copy(parent.resolve(original), parent.resolve(temporary), StandardCopyOption.COPY_ATTRIBUTES, LinkOption.NOFOLLOW_LINKS);
        var targetAcl = Files.getFileAttributeView(parent.resolve(temporary), AclFileAttributeView.class, LinkOption.NOFOLLOW_LINKS);
        if (targetAcl == null) throw failure("FILE_ATTRIBUTES_UNSUPPORTED");
        targetAcl.setAcl(sourceAcl.getAcl());
        if (!targetAcl.getAcl().equals(sourceAcl.getAcl())) throw failure("FILE_ATTRIBUTES_NOT_PRESERVED");
        requireRegularIdentity(parent, original, sourceAttributes.fileKey());
        Object temporaryKey = Files.readAttributes(parent.resolve(temporary), BasicFileAttributes.class, LinkOption.NOFOLLOW_LINKS).fileKey();
        requireRegularIdentity(parent, temporary, temporaryKey);
        return temporaryKey;
    }

    /** Testable process boundary: no caller may clean the destination while cp is still running. */
    static void awaitAttributeCopy(Process process, Duration timeout) throws IOException {
        try {
            if (!process.waitFor(timeout.toMillis(), TimeUnit.MILLISECONDS)) {
                terminateAttributeCopy(process);
                throw failure("ATTRIBUTE_COPY_TIMEOUT");
            }
            if (process.exitValue() != 0) throw failure("ATTRIBUTE_COPY_FAILED");
        } catch (InterruptedException interrupted) {
            terminateAttributeCopy(process);
            Thread.currentThread().interrupt();
            throw new IOException("Attribute copy interrupted", interrupted);
        }
    }

    private static void terminateAttributeCopy(Process process) {
        process.destroyForcibly();
        boolean interrupted = false;
        for (;;) {
            try { process.waitFor(); break; }
            catch (InterruptedException waitInterrupted) { interrupted = true; }
        }
        if (interrupted) Thread.currentThread().interrupt();
    }

    private static void requireRegularIdentity(Directory parent, Path file, Object expectedKey) throws IOException {
        parent.check();
        var current = Files.readAttributes(parent.resolve(file), BasicFileAttributes.class, LinkOption.NOFOLLOW_LINKS);
        if (!current.isRegularFile() || expectedKey == null || !expectedKey.equals(current.fileKey())) throw failure("FILE_IDENTITY_CHANGED");
    }

    private Image image(Directory directory, Path name, SeekableByteChannel copyTo) throws IOException {
        return image(directory, name, copyTo, maxBytes);
    }

    private Image image(Directory directory, Path name, SeekableByteChannel copyTo, long limit) throws IOException {
        var view = directory.getFileAttributeView(name, PosixFileAttributeView.class, LinkOption.NOFOLLOW_LINKS);
        if (view == null) throw failure("FILE_PERMISSIONS_UNSUPPORTED");
        PosixFileAttributes before = view.readAttributes();
        if (!before.isRegularFile() || before.fileKey() == null || before.size() > limit) throw failure("INVALID_IMAGE");
        MessageDigest digest = digest(); long size = 0;
        try (var channel = directory.newByteChannel(name, READ)) {
            ByteBuffer buffer = ByteBuffer.allocate(64 * 1024);
            while (channel.read(buffer) != -1) {
                buffer.flip(); size += buffer.remaining();
                if (size > limit) throw failure("CONTENT_TOO_LARGE");
                digest.update(buffer.asReadOnlyBuffer());
                if (copyTo != null) while (buffer.hasRemaining()) copyTo.write(buffer);
                buffer.clear();
            }
        }
        directory.check();
        PosixFileAttributes after = view.readAttributes();
        if (!Objects.equals(before.fileKey(), after.fileKey()) || before.size() != size || after.size() != size
                || !before.lastModifiedTime().equals(after.lastModifiedTime())) throw failure("CONTENT_CONFLICT");
        return new Image(HexFormat.of().formatHex(digest.digest()), size, before.fileKey(), before);
    }

    private Image copy(InputStream input, SeekableByteChannel output, long expected) throws IOException {
        MessageDigest digest = digest(); long count = 0; byte[] bytes = new byte[64 * 1024];
        int n;
        while ((n = input.read(bytes, 0, expected - count >= bytes.length ? bytes.length : (int) (expected - count + 1))) != -1) {
            count += n;
            if (count > expected || count > maxBytes) throw failure("CONTENT_LENGTH_MISMATCH");
            digest.update(bytes, 0, n); ByteBuffer buffer = ByteBuffer.wrap(bytes, 0, n);
            while (buffer.hasRemaining()) output.write(buffer);
        }
        if (count != expected) throw failure("CONTENT_LENGTH_MISMATCH");
        return new Image(HexFormat.of().formatHex(digest.digest()), count, null, null);
    }

    /** Path checks intentionally do not claim protection from adversarial concurrent directory swaps. */
    private static final class Directory implements AutoCloseable {
        final Path path;
        final Object fileKey;
        Directory(Path path, Object fileKey) { this.path = path; this.fileKey = fileKey; }
        void check() throws IOException {
            BasicFileAttributes attributes = Files.readAttributes(path, BasicFileAttributes.class, LinkOption.NOFOLLOW_LINKS);
            if (!attributes.isDirectory() || !Objects.equals(fileKey, attributes.fileKey()) || !path.toRealPath().equals(path))
                throw failure("DIRECTORY_CHANGED");
        }
        Path resolve(Path name) throws IOException {
            if (name.isAbsolute() || name.getNameCount() != 1 || name.toString().equals("..")) throw failure("INVALID_JOURNAL_NAME");
            return path.resolve(name);
        }
        SeekableByteChannel newByteChannel(Path name, Set<? extends java.nio.file.OpenOption> options,
                                          java.nio.file.attribute.FileAttribute<?>... attributes) throws IOException {
            check();
            SeekableByteChannel channel = Files.newByteChannel(resolve(name), options, attributes);
            try { check(); return channel; }
            catch (IOException | RuntimeException failure) { channel.close(); throw failure; }
        }
        PosixFileAttributeView getFileAttributeView(Path name, Class<PosixFileAttributeView> type, LinkOption option) throws IOException {
            check(); return Files.getFileAttributeView(resolve(name), type, option);
        }
        void move(Path from, Directory to, Path name) throws IOException {
            check(); to.check();
            Files.move(resolve(from), to.resolve(name), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
            check(); to.check();
        }
        void deleteFile(Path name) throws IOException {
            check();
            Path file = resolve(name);
            if (Files.isDirectory(file, LinkOption.NOFOLLOW_LINKS)) throw failure("INVALID_JOURNAL_NAME");
            Files.delete(file); check();
        }
        @Override public void close() { /* No directory descriptor is retained by the macOS provider. */ }
    }

    private static Directory directory(Path absolute) throws IOException {
        if (!absolute.isAbsolute() || !absolute.equals(absolute.normalize()) || !absolute.toRealPath().equals(absolute))
            throw failure("DIRECTORY_CHANGED");
        BasicFileAttributes attributes = Files.readAttributes(absolute, BasicFileAttributes.class, LinkOption.NOFOLLOW_LINKS);
        if (!attributes.isDirectory() || attributes.fileKey() == null) throw failure("FILE_IDENTITY_UNSUPPORTED");
        return new Directory(absolute, attributes.fileKey());
    }

    private static void sync(Directory directory) throws IOException {
        try (var channel = directory.newByteChannel(Path.of("."), READ)) { force(channel); }
        directory.check();
    }
    private static void force(SeekableByteChannel channel) throws IOException {
        if (!(channel instanceof FileChannel file)) throw failure("DURABLE_FILES_UNSUPPORTED");
        file.force(true);
    }
    private static void removeTemporary(Directory directory, Path name) {
        try { directory.deleteFile(name); }
        catch (java.nio.file.NoSuchFileException absent) { /* Already moved into its durable name. */ }
        catch (IOException cleanup) {
            System.getLogger(LocalCoreContentService.class.getName()).log(System.Logger.Level.WARNING, "Could not remove core save temporary file", cleanup);
        }
    }
    private static void removeOrphan(Directory directory, Path name) throws IOException {
        try { directory.deleteFile(name); } catch (java.nio.file.NoSuchFileException absent) { /* No orphan. */ }
    }
    private void validate(SaveRequest request) throws IOException {
        if (request == null || request.operationId() == null || request.projectId() <= 0 || request.fileId() <= 0 || request.actorId() <= 0
                || request.uid() == null || request.uid().isBlank() || request.uid().length() > 128 || !sha(request.expectedSha256())
                || request.contentLength() < 0) throw failure("INVALID_SAVE_REQUEST");
    }
    private static boolean sha(String value) { return value != null && value.matches("[0-9a-f]{64}"); }
    private static Path name(UUID id, String suffix) { return Path.of(id + suffix); }
    private static MessageDigest digest() {
        try { return MessageDigest.getInstance("SHA-256"); }
        catch (NoSuchAlgorithmException impossible) { throw new IllegalStateException(impossible); }
    }
    private static ContentException failure(String code) { return new ContentException(code, false, null); }
}
