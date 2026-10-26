// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.localcore;

import com.checkba.service.DeviceTokenService;
import com.checkba.version.VersionException;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import javax.sql.DataSource;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.nio.file.attribute.BasicFileAttributes;
import java.nio.file.attribute.PosixFilePermissions;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.sql.Connection;
import java.sql.SQLException;
import java.util.Collections;
import java.util.HexFormat;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.function.LongFunction;
import java.util.regex.Pattern;

/**
 * Explicit, full-document protocol. The caller applies local admission, CORS, license/policy checks
 * and keeps its authority lease through handle(), including the final response stream. A JPA caller
 * supplies the existing repository lock via guardForProject, after network staging. This adapter
 * grants no alternative identity and does not arrange lifecycle ownership or enable JPA by itself.
 */
public final class LocalCoreContentHttp {
    public static final String PROTOCOL = "X-AWD-Content-Protocol";
    public static final String UID = "X-AWD-File-Uid";
    public static final String ACTOR = "X-AWD-Actor-Id";
    public static final String SHA256 = "X-AWD-SHA256";
    public static final String OPERATION = "X-AWD-Operation-Id";
    public static final String EXPECTED_SHA256 = "X-AWD-Expected-SHA256";
    public static final String ORIGINAL_LENGTH = "X-AWD-Content-Length";
    private static final Pattern ROUTE = Pattern.compile("/api/local-core/projects/([^/]+)/files/([^/]+)/content(?:/receipts/([^/]+))?");
    private final DataSource database;
    private final LocalCoreStore store;
    private final LocalCoreContentService content;
    private final ObjectMapper json;
    private final Path snapshots;
    private final Object snapshotDirectoryKey;
    private final long maxBytes;
    private final LongFunction<LocalCoreContentService.PublicationGuard> guardForProject;
    private final LongFunction<LocalCoreContentService.CancellationGuard> cancellationGuardForProject;
    private final ReceiptConfirmation confirmation;
    @FunctionalInterface public interface ReceiptConfirmation {
        /** Retry post-commit handoff/effects without rewriting any document bytes. */
        void confirm(LocalCoreContentService.SaveReceipt receipt) throws IOException, SQLException;
    }
    private final SnapshotHook snapshotHook;

    @FunctionalInterface interface SnapshotHook { void afterCopy() throws IOException; }
    private static final class HttpFailure extends Exception {
        final int status; final String reason;
        HttpFailure(int status, String reason) { this.status = status; this.reason = reason; }
    }

    /** snapshotDirectory is an existing, private, absolute directory owned by this profile. */
    public LocalCoreContentHttp(DataSource database, LocalCoreStore store, LocalCoreContentService content,
                                ObjectMapper json, Path snapshotDirectory, long maxBytes,
                                LongFunction<LocalCoreContentService.PublicationGuard> guardForProject) throws IOException {
        this(database, store, content, json, snapshotDirectory, maxBytes, guardForProject, () -> {});
    }

    public LocalCoreContentHttp(DataSource database, LocalCoreStore store, LocalCoreContentService content,
                                ObjectMapper json, Path snapshotDirectory, long maxBytes,
                                LongFunction<LocalCoreContentService.PublicationGuard> guardForProject,
                                LongFunction<LocalCoreContentService.CancellationGuard> cancellationGuardForProject,
                                ReceiptConfirmation confirmation) throws IOException {
        this(database, store, content, json, snapshotDirectory, maxBytes, guardForProject,
                cancellationGuardForProject, confirmation, () -> {});
    }

    LocalCoreContentHttp(DataSource database, LocalCoreStore store, LocalCoreContentService content,
                         ObjectMapper json, Path snapshotDirectory, long maxBytes,
                         LongFunction<LocalCoreContentService.PublicationGuard> guardForProject,
                         SnapshotHook snapshotHook) throws IOException {
        this(database, store, content, json, snapshotDirectory, maxBytes, guardForProject,
                project -> LocalCoreContentService.Cancellation::run, receipt -> {}, snapshotHook);
    }

    LocalCoreContentHttp(DataSource database, LocalCoreStore store, LocalCoreContentService content,
                         ObjectMapper json, Path snapshotDirectory, long maxBytes,
                         LongFunction<LocalCoreContentService.PublicationGuard> guardForProject,
                         LongFunction<LocalCoreContentService.CancellationGuard> cancellationGuardForProject,
                         ReceiptConfirmation confirmation, SnapshotHook snapshotHook) throws IOException {
        this.database = Objects.requireNonNull(database); this.store = Objects.requireNonNull(store);
        this.content = Objects.requireNonNull(content); this.json = Objects.requireNonNull(json);
        this.guardForProject = Objects.requireNonNull(guardForProject); this.snapshotHook = Objects.requireNonNull(snapshotHook);
        this.cancellationGuardForProject = Objects.requireNonNull(cancellationGuardForProject);
        this.confirmation = Objects.requireNonNull(confirmation);
        if (snapshotDirectory == null || !snapshotDirectory.isAbsolute() || !snapshotDirectory.equals(snapshotDirectory.normalize())
                || !snapshotDirectory.toRealPath().equals(snapshotDirectory) || maxBytes <= 0)
            throw new IllegalArgumentException("An existing absolute private snapshot directory and positive limit are required");
        var attributes = Files.readAttributes(snapshotDirectory, BasicFileAttributes.class, LinkOption.NOFOLLOW_LINKS);
        if (!attributes.isDirectory() || attributes.fileKey() == null) throw new IOException("Snapshot directory identity unavailable");
        snapshots = snapshotDirectory; snapshotDirectoryKey = attributes.fileKey(); this.maxBytes = maxBytes;
    }

    /** Unhandled routes leave the response and body untouched. Known routes never fall through. */
    public boolean handle(HttpServletRequest request, HttpServletResponse response) throws IOException {
        var route = ROUTE.matcher(request.getRequestURI());
        if (!route.matches()) return false;
        boolean head = "HEAD".equals(request.getMethod());
        response.setHeader(PROTOCOL, "1"); response.setHeader("Cache-Control", "no-store");
        response.setHeader("X-Content-Type-Options", "nosniff");
        response.setHeader("Access-Control-Expose-Headers", PROTOCOL + ", " + UID + ", " + ACTOR + ", " + SHA256 + ", Content-Length, ETag");
        try {
            if (!"1".equals(header(request, PROTOCOL, true))) throw new HttpFailure(400, "CONTENT_PROTOCOL_REQUIRED");
            rejectDeviceIdentity(request);
            if (request.getQueryString() != null && !request.getQueryString().isBlank()) throw new HttpFailure(400, "CONTENT_QUERY_UNSUPPORTED");
            long projectId = positive(route.group(1)); long fileId = positive(route.group(2));
            if (route.group(3) != null) {
                if (!"GET".equals(request.getMethod()) && !"DELETE".equals(request.getMethod())) throw new HttpFailure(405, "METHOD_NOT_ALLOWED");
                rejectReadBody(request);
                var save = saveRequest(request, projectId, fileId, length(header(request, ORIGINAL_LENGTH, true), false));
                if (!operation(route.group(3)).equals(save.operationId())) throw new HttpFailure(400, "OPERATION_ID_MISMATCH");
                LocalCoreContentService.OperationResult terminal;
                if ("DELETE".equals(request.getMethod())) {
                    // Same fresh access before the caller's guard; the service rechecks under its DB lock.
                    try (Connection c = readConnection()) { requireSaveTarget(store.fileTargetForWrite(c, projectId, fileId), save); }
                    terminal = content.cancel(save, Objects.requireNonNull(cancellationGuardForProject.apply(projectId)));
                } else terminal = content.operationResult(save).orElseThrow(() -> new HttpFailure(404, "RECEIPT_NOT_FOUND"));
                if (terminal.completed() != null) {
                    confirmation.confirm(terminal.completed());
                    receipt(response, terminal.completed());
                } else cancelled(response, terminal.cancelled());
            } else if ("GET".equals(request.getMethod()) || head) {
                rejectReadBody(request);
                if (request.getHeader("Range") != null) throw new HttpFailure(400, "CONTENT_RANGE_UNSUPPORTED");
                download(response, projectId, fileId, head);
            } else if ("PUT".equals(request.getMethod())) {
                if (request.getHeader("Transfer-Encoding") != null) throw new HttpFailure(400, "CONTENT_LENGTH_REQUIRED");
                long size = length(header(request, "Content-Length", true), true);
                if (request.getContentLengthLong() != size) throw new HttpFailure(400, "CONTENT_LENGTH_MISMATCH");
                String type = request.getContentType();
                if (type == null || !"application/octet-stream".equalsIgnoreCase(type.split(";", 2)[0].trim()))
                    throw new HttpFailure(415, "CONTENT_TYPE_UNSUPPORTED");
                var save = saveRequest(request, projectId, fileId, size);
                // No request stream is acquired before malformed requests and current ACLs fail.
                try (Connection c = readConnection()) { requireSaveTarget(store.fileTargetForWrite(c, projectId, fileId), save); }
                var guard = Objects.requireNonNull(guardForProject.apply(projectId));
                receipt(response, content.save(save, request.getInputStream(), guard));
            } else throw new HttpFailure(405, "METHOD_NOT_ALLOWED");
        } catch (HttpFailure failure) {
            error(response, head, failure.status, failure.reason);
        } catch (LocalCoreStore.LocalCoreException failure) {
            error(response, head, failure.status(), safeReason(failure.code(), "CONTENT_ACCESS_FAILED"));
        } catch (LocalCoreContentService.ContentException failure) {
            String reason = safeReason(failure.code(), "CONTENT_SAVE_FAILED");
            int status = switch (reason) {
                case "INVALID_SAVE_REQUEST", "CONTENT_LENGTH_MISMATCH" -> 400;
                case "CONTENT_TOO_LARGE" -> 413;
                case "OPERATION_REUSE", "OPERATION_CANCELLED", "CONTENT_CONFLICT", "IDENTITY_CHANGED", "LEGACY_UID_REQUIRED", "TARGET_CHANGED", "PENDING_SAVE_REQUIRES_RECOVERY" -> 409;
                default -> 500;
            };
            error(response, head, status, reason);
        } catch (VersionException failure) {
            error(response, head, "VERSION_BUSY".equals(failure.getKind()) ? 423 : 500,
                    "VERSION_BUSY".equals(failure.getKind()) ? "VERSION_BUSY" : "CONTENT_SAVE_FAILED");
        } catch (SQLException failure) {
            error(response, head, 500, "CONTENT_STORAGE_FAILED");
        } catch (IOException failure) {
            if (response.isCommitted()) throw failure;
            error(response, head, 500, "CONTENT_IO_FAILED");
        } catch (RuntimeException failure) {
            if (response.isCommitted()) throw failure;
            error(response, head, 500, "CONTENT_REQUEST_FAILED");
        }
        return true;
    }

    private LocalCoreContentService.SaveRequest saveRequest(HttpServletRequest request, long projectId, long fileId, long size) throws HttpFailure {
        String uid = header(request, UID, true);
        if (!uid.matches("[A-Za-z0-9._:-]{1,128}")) throw new HttpFailure(400, "INVALID_FILE_UID");
        String expected = header(request, EXPECTED_SHA256, true);
        if (!expected.matches("[0-9a-f]{64}")) throw new HttpFailure(400, "INVALID_CONTENT_SHA");
        return new LocalCoreContentService.SaveRequest(operation(header(request, OPERATION, true)), projectId, fileId, uid,
                positive(header(request, ACTOR, true)), expected, size);
    }

    private static void requireSaveTarget(LocalCoreStore.FileTarget target, LocalCoreContentService.SaveRequest request) throws HttpFailure {
        if (target.actor().id() != request.actorId()) throw new HttpFailure(409, "IDENTITY_CHANGED");
        if (target.uid() == null || target.uid().isBlank()) throw new HttpFailure(409, "LEGACY_UID_REQUIRED");
        if (!target.uid().equals(request.uid())) throw new HttpFailure(409, "TARGET_CHANGED");
    }

    private void download(HttpServletResponse response, long projectId, long fileId, boolean head) throws IOException, SQLException, HttpFailure {
        LocalCoreStore.FileTarget target;
        try (Connection c = readConnection()) { target = store.fileTargetForRead(c, projectId, fileId); }
        if (target.uid() == null || target.uid().isBlank()) throw new HttpFailure(409, "LEGACY_UID_REQUIRED");
        Path snapshot = snapshots.resolve("content-" + UUID.randomUUID() + ".tmp");
        checkSnapshotDirectory();
        try (FileChannel copy = FileChannel.open(snapshot, Set.of(StandardOpenOption.CREATE_NEW, StandardOpenOption.READ,
                StandardOpenOption.WRITE, LinkOption.NOFOLLOW_LINKS), PosixFilePermissions.asFileAttribute(PosixFilePermissions.fromString("rw-------")))) {
            var before = fileAttributes(target.path());
            Object parentKey = directoryKey(target.path().getParent());
            if (before.size() > maxBytes) throw new HttpFailure(413, "CONTENT_TOO_LARGE");
            MessageDigest digest = digest(); long copied = 0;
            try (FileChannel input = FileChannel.open(target.path(), StandardOpenOption.READ, LinkOption.NOFOLLOW_LINKS)) {
                ByteBuffer buffer = ByteBuffer.allocate(64 * 1024);
                while (input.read(buffer) != -1) {
                    buffer.flip(); copied += buffer.remaining();
                    if (copied > maxBytes) throw new HttpFailure(413, "CONTENT_TOO_LARGE");
                    digest.update(buffer.asReadOnlyBuffer());
                    while (buffer.hasRemaining()) copy.write(buffer);
                    buffer.clear();
                }
            }
            var after = fileAttributes(target.path());
            if (!Objects.equals(before.fileKey(), after.fileKey()) || before.size() != copied || after.size() != copied
                    || !before.lastModifiedTime().equals(after.lastModifiedTime()) || !Objects.equals(parentKey, directoryKey(target.path().getParent())))
                throw new HttpFailure(409, "CONTENT_CHANGED");
            snapshotHook.afterCopy();
            try (Connection c = readConnection()) {
                var current = store.fileTargetForRead(c, projectId, fileId);
                if (current.actor().id() != target.actor().id()) throw new HttpFailure(409, "IDENTITY_CHANGED");
                if (!Objects.equals(current.uid(), target.uid()) || !current.path().equals(target.path())
                        || !Objects.equals(current.storageKey(), target.storageKey()) || !Objects.equals(current.externalPath(), target.externalPath()))
                    throw new HttpFailure(409, "TARGET_CHANGED");
            }
            checkSnapshotDirectory();
            String sha = HexFormat.of().formatHex(digest.digest());
            response.setStatus(200); response.setContentType("application/octet-stream"); response.setContentLengthLong(copied);
            response.setHeader(UID, target.uid()); response.setHeader(ACTOR, Long.toString(target.actor().id()));
            response.setHeader(SHA256, sha); response.setHeader("ETag", "\"sha256:" + sha + "\"");
            response.flushBuffer();
            if (!head) {
                copy.position(0); ByteBuffer buffer = ByteBuffer.allocate(64 * 1024);
                while (copy.read(buffer) != -1) {
                    response.getOutputStream().write(buffer.array(), 0, buffer.position()); buffer.clear();
                }
            }
        } finally { removeSnapshot(snapshot); }
    }

    private Connection readConnection() throws SQLException {
        Connection c = database.getConnection();
        try {
            if (!c.getAutoCommit()) throw new SQLException("Fresh connection required");
            c.setTransactionIsolation(Connection.TRANSACTION_READ_COMMITTED); return c;
        } catch (SQLException failure) { c.close(); throw failure; }
    }

    private BasicFileAttributes fileAttributes(Path path) throws IOException, HttpFailure {
        var attributes = Files.readAttributes(path, BasicFileAttributes.class, LinkOption.NOFOLLOW_LINKS);
        if (!attributes.isRegularFile() || attributes.fileKey() == null || !path.toRealPath().equals(path)) throw new HttpFailure(409, "CONTENT_CHANGED");
        return attributes;
    }
    private static Object directoryKey(Path path) throws IOException {
        var attributes = Files.readAttributes(path, BasicFileAttributes.class, LinkOption.NOFOLLOW_LINKS);
        if (!attributes.isDirectory() || attributes.fileKey() == null || !path.toRealPath().equals(path)) throw new IOException("Directory changed");
        return attributes.fileKey();
    }
    private void checkSnapshotDirectory() throws IOException {
        if (!snapshotDirectoryKey.equals(directoryKey(snapshots))) throw new IOException("Snapshot directory changed");
    }
    private void removeSnapshot(Path path) {
        try { checkSnapshotDirectory(); Files.deleteIfExists(path); }
        catch (IOException failure) { System.getLogger(LocalCoreContentHttp.class.getName()).log(System.Logger.Level.WARNING, "Could not clean document snapshot"); }
    }

    private void receipt(HttpServletResponse response, LocalCoreContentService.SaveReceipt receipt) throws IOException {
        writeJson(response, false, 200, Map.of("code", 0, "data", Map.of("operationId", receipt.request().operationId().toString(),
                "uid", receipt.request().uid(), "actorId", receipt.request().actorId(), "sha256", receipt.afterSha256(), "size", receipt.size())));
    }
    private void error(HttpServletResponse response, boolean head, int status, String reason) throws IOException {
        // A previous retry may already have published, even when this invocation failed preflight.
        writeJson(response, head, status, Map.of("code", -1, "reason", reason, "message", "文档请求未完成，请检查后重试", "writeState", "unknown"));
    }
    private void writeJson(HttpServletResponse response, boolean head, int status, Object value) throws IOException {
        byte[] bytes = json.writeValueAsBytes(value);
        response.setStatus(status); response.setContentType("application/json;charset=UTF-8"); response.setContentLength(bytes.length);
        if (!head) response.getOutputStream().write(bytes);
    }
    private void cancelled(HttpServletResponse response, LocalCoreContentService.SaveRequest request) throws IOException {
        writeJson(response, false, 200, Map.of("code", 0, "data", Map.of("state", "cancelled",
                "operationId", request.operationId().toString(), "uid", request.uid(), "actorId", request.actorId())));
    }
    private long length(String value, boolean admission) throws HttpFailure {
        if (value == null || !value.matches("0|[1-9][0-9]{0,18}")) throw new HttpFailure(400, "INVALID_CONTENT_LENGTH");
        try {
            long size = Long.parseLong(value);
            if (admission && size > maxBytes) throw new HttpFailure(413, "CONTENT_TOO_LARGE");
            return size;
        } catch (NumberFormatException invalid) { throw new HttpFailure(400, "INVALID_CONTENT_LENGTH"); }
    }
    private static long positive(String value) throws HttpFailure {
        if (value == null || !value.matches("[1-9][0-9]{0,18}")) throw new HttpFailure(400, "INVALID_ID");
        try { return Long.parseLong(value); } catch (NumberFormatException invalid) { throw new HttpFailure(400, "INVALID_ID"); }
    }
    private static UUID operation(String value) throws HttpFailure {
        try {
            UUID id = UUID.fromString(value);
            if (!id.toString().equals(value)) throw new IllegalArgumentException();
            return id;
        } catch (IllegalArgumentException | NullPointerException invalid) { throw new HttpFailure(400, "INVALID_OPERATION_ID"); }
    }
    private static String header(HttpServletRequest request, String name, boolean required) throws HttpFailure {
        var values = request.getHeaders(name);
        var all = values == null ? java.util.List.<String>of() : Collections.list(values);
        if (all.size() > 1) throw new HttpFailure(400, "DUPLICATE_HEADER");
        String value = all.isEmpty() ? null : all.get(0);
        if (required && (value == null || value.isBlank())) throw new HttpFailure(400, "REQUIRED_HEADER_MISSING");
        return value;
    }
    private static void rejectDeviceIdentity(HttpServletRequest request) throws HttpFailure {
        String session = header(request, "X-Session-Id", false);
        String authorization = header(request, "Authorization", false);
        if (deviceCredential(session) || deviceCredential(authorization))
            throw new HttpFailure(503, "DEVICE_AUTH_STARTING");
    }
    private static boolean deviceCredential(String value) {
        if (value == null) return false;
        String credential = value.trim();
        if (credential.length() > 6 && credential.regionMatches(true, 0, "Bearer", 0, 6)
                && Character.isWhitespace(credential.charAt(6))) credential = credential.substring(6).trim();
        return credential.startsWith(DeviceTokenService.TOKEN_PREFIX);
    }
    private static void rejectReadBody(HttpServletRequest request) throws HttpFailure {
        if (request.getContentLengthLong() > 0 || request.getHeader("Transfer-Encoding") != null) throw new HttpFailure(400, "READ_BODY_UNSUPPORTED");
    }
    private static String safeReason(String reason, String fallback) { return reason != null && reason.matches("[A-Z0-9_]{1,80}") ? reason : fallback; }
    private static MessageDigest digest() {
        try { return MessageDigest.getInstance("SHA-256"); } catch (NoSuchAlgorithmException impossible) { throw new IllegalStateException(impossible); }
    }
}
