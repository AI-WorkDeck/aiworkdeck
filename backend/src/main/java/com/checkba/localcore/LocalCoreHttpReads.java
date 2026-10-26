// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.localcore;

import com.checkba.service.DeviceTokenService;
import com.checkba.service.LicenseService;
import com.checkba.service.account.AccountService;
import com.checkba.service.document.DocumentGeneratorSettings;
import com.checkba.service.site.SiteProfileService;
import com.checkba.util.ProductIdentity;

import javax.sql.DataSource;
import java.net.URLDecoder;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.function.UnaryOperator;
import java.util.regex.Pattern;

/**
 * Read-only business adapter for existing desktop routes, without starting Spring or an HTTP server.
 * The caller must apply local-mode admission/CORS and hold the authority lease through serialization
 * and file streaming. bodyFile is an internal path, NEVER a JSON field or a reusable capability.
 * The outer transport owns Range handling and any file snapshot/version protocol. HEAD performs the
 * same validation as GET here; the transport suppresses its response body. Unknown routes/methods
 * return empty, which means "not handled", never permission to bypass the ownership gate into JPA.
 */
public final class LocalCoreHttpReads {
    /** Advertised to the desktop scheduler; this does not grant access to any of these routes. */
    public static final List<String> READ_PATHS = List.of("/api/license/status", "/api/local-identity/status",
            "/api/local-identity/candidates", "/api/auth/me", "/api/projects/my", "/api/projects/:id",
            "/api/projects/:id/members", "/api/projects/:id/files", "/api/files/:id/download",
            "/api/document/generator/settings");
    private static final Pattern PROJECT = Pattern.compile("/api/projects/([^/]+)(?:/(members|files))?");
    private static final Pattern DOWNLOAD = Pattern.compile("/api/files/([^/]+)/download");
    private final LocalCoreStore store;
    private final DataSource database;
    private final LicenseService license;
    private final AccountService account;
    private final SiteProfileService site;
    private final AuthFlags auth;
    private final UnaryOperator<String> displayNameForUi;

    /** Values must come from the same effective configuration as the eventual Spring services. */
    public record AuthFlags(boolean allowAllUsers, boolean smsAuthEnabled, boolean mailAuthEnabled) {}
    public record Request(String method, String path, String rawQuery, Map<String, List<String>> headers) {
        public Request {
            Objects.requireNonNull(method); Objects.requireNonNull(path); Objects.requireNonNull(headers);
            Map<String, List<String>> copy = new LinkedHashMap<>();
            headers.forEach((key, values) -> copy.put(key, List.copyOf(values)));
            headers = Map.copyOf(copy);
        }
    }
    public record Response(int status, Map<String, String> headers, Object jsonBody, Path bodyFile) {
        public Response {
            headers = Map.copyOf(headers);
            if ((jsonBody == null) == (bodyFile == null)) throw new IllegalArgumentException("Exactly one response body is required");
        }
    }

    public LocalCoreHttpReads(LocalCoreStore store, DataSource database, LicenseService license,
                              AccountService account, SiteProfileService site, AuthFlags auth,
                              UnaryOperator<String> displayNameForUi) {
        this.store = Objects.requireNonNull(store); this.database = Objects.requireNonNull(database);
        this.license = Objects.requireNonNull(license); this.account = Objects.requireNonNull(account);
        this.site = Objects.requireNonNull(site); this.auth = Objects.requireNonNull(auth);
        this.displayNameForUi = Objects.requireNonNull(displayNameForUi);
        if (!license.isLocalMode()) throw new IllegalArgumentException("The early core requires local mode");
    }

    public Optional<Response> handle(Request request) throws SQLException {
        if (!"GET".equals(request.method()) && !"HEAD".equals(request.method())) return Optional.empty();
        String path = request.path();
        var project = PROJECT.matcher(path);
        var download = DOWNLOAD.matcher(path);
        boolean anonymous = List.of("/api/license/status", "/api/local-identity/status", "/api/local-identity/candidates",
                "/api/document/generator/settings").contains(path);
        if (!anonymous && !path.equals("/api/auth/me") && !path.equals("/api/projects/my")
                && !project.matches() && !download.matches()) return Optional.empty();
        try {
            Map<String, String> query = query(request.rawQuery());
            if (!anonymous) {
                String session = header(request, "X-Session-Id");
                if ((session == null || session.isBlank()) && download.matches()) session = query.get("token");
                if (session != null && session.startsWith(DeviceTokenService.TOKEN_PREFIX)) {
                    return Optional.of(error(503, "DEVICE_AUTH_STARTING"));
                }
            }
            if (path.equals("/api/license/status")) return Optional.of(json(200, licenseStatus()));
            if (path.equals("/api/local-identity/status")) return Optional.of(json(200, identityStatus()));
            if (path.equals("/api/local-identity/candidates")) return Optional.of(json(200, identityCandidates()));
            if (path.equals("/api/document/generator/settings")) return Optional.of(json(200, generatorSettings()));
            if (path.equals("/api/auth/me")) return Optional.of(json(200, Map.of("code", 0, "data", currentUser())));
            if (path.equals("/api/projects/my")) {
                List<Map<String, Object>> cards = store.projectCards();
                cards.forEach(card -> card.computeIfPresent("managerName", (key, name) -> displayNameForUi.apply((String) name)));
                return Optional.of(json(200, cards));
            }
            if (download.matches()) return Optional.of(download(id(download.group(1), 404)));
            long projectId = id(project.group(1), 400);
            String child = project.group(2);
            if (child == null) return Optional.of(json(200, store.projectDetail(projectId)));
            if (child.equals("members")) return Optional.of(json(200, Map.of("code", 0, "data", members(projectId))));
            Long parentId = query.containsKey("parentId") ? id(query.get("parentId"), 400) : null;
            boolean tree = booleanQuery(query.get("tree"));
            List<Long> ids = null;
            if (query.containsKey("ids")) {
                ids = new ArrayList<>();
                if (!query.get("ids").isBlank()) {
                    String[] values = query.get("ids").split(",", -1);
                    if (values.length > 200) throw invalid("INVALID_FILE_IDS", 400);
                    for (String value : values) ids.add(id(value.trim(), 400));
                }
            }
            return Optional.of(json(200, store.files(projectId, parentId, tree, ids)));
        } catch (LocalCoreStore.LocalCoreException e) {
            return Optional.of(error(e.status(), e.code()));
        }
    }

    private Map<String, Object> generatorSettings() throws SQLException {
        // Saving already uses the core content protocol. Its optional metadata setting must not
        // pull that save back behind JPA; retain DocumentGeneratorSettings' null/default semantics.
        String value = null;
        try (var c = database.getConnection(); var s = c.prepareStatement("SELECT \"value\" FROM system_setting WHERE config_key=?")) {
            s.setString(1, DocumentGeneratorSettings.KEY_ENABLED);
            try (var r = s.executeQuery()) { if (r.next()) value = r.getString(1); }
        }
        return Map.of("code", 0, "enabled", Boolean.parseBoolean(value == null ? "true" : value),
                "application", ProductIdentity.applicationName());
    }

    private Map<String, Object> licenseStatus() {
        Map<String, Object> result = new LinkedHashMap<>(license.status());
        boolean connected;
        try { connected = account.isConnected(); }
        catch (RuntimeException ignored) { connected = false; } // Same display-only fallback as LicenseController.
        String mode = String.valueOf(result.get("mode"));
        result.put("accountConnected", connected);
        result.put("edition", connected || "account".equals(mode) ? "paid" : "trial".equals(mode) ? "trial" : "none");
        result.put("site", site.currentSite()); result.put("siteDisplayName", site.displayName()); result.put("multiSite", site.multiSite());
        return result;
    }

    private Map<String, Object> identityStatus() throws SQLException {
        var status = store.identityStatus();
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("localMode", status.localMode()); result.put("needsSelection", status.needsSelection()); result.put("userId", status.userId());
        if (!status.needsSelection()) {
            result.put("username", status.username()); result.put("displayName", displayNameForUi.apply(status.displayName()));
        }
        return result;
    }

    private Map<String, Object> identityCandidates() throws SQLException {
        var status = store.identityStatus();
        List<Map<String, Object>> candidates = new ArrayList<>();
        for (var candidate : store.identityCandidates()) {
            Map<String, Object> entry = new LinkedHashMap<>();
            entry.put("userId", candidate.userId()); entry.put("username", candidate.username());
            entry.put("displayName", displayNameForUi.apply(candidate.displayName()));
            entry.put("projectCount", candidate.projectCount()); entry.put("fileCount", candidate.fileCount());
            candidates.add(entry);
        }
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("localMode", true); result.put("needsSelection", status.needsSelection());
        result.put("currentUserId", status.needsSelection() ? null : status.userId()); result.put("candidates", candidates);
        return result;
    }

    private Map<String, Object> currentUser() throws SQLException {
        var actor = store.currentActor();
        Map<String, Object> user = new LinkedHashMap<>();
        user.put("id", actor.id()); user.put("username", actor.username()); user.put("displayName", displayNameForUi.apply(actor.displayName()));
        user.put("avatarUrl", actor.avatarUrl() == null ? "" : actor.avatarUrl()); user.put("role", actor.role());
        user.put("subscriptionType", actor.subscriptionType());
        user.put("isAdmin", auth.allowAllUsers() || "admin".equalsIgnoreCase(actor.username()));
        user.put("smsAuthEnabled", auth.smsAuthEnabled()); user.put("phoneMasked", actor.phoneMasked());
        user.put("mailAuthEnabled", auth.mailAuthEnabled()); user.put("emailMasked", actor.emailMasked()); user.put("totpEnabled", actor.totpEnabled());
        return user;
    }

    private List<Map<String, Object>> members(long projectId) throws SQLException {
        long callerId = store.currentActor().id();
        List<Map<String, Object>> members = store.projectMembers(projectId);
        for (var member : members) {
            if (!member.containsKey("username")) continue;
            member.put("displayName", displayNameForUi.apply((String) member.get("displayName")));
            String bound = (String) member.get("accountId");
            String avatar = (String) member.get("avatarUrl");
            if (avatar == null || avatar.isBlank()) {
                String base = site.baseUrl();
                member.put("avatarUrl", bound == null ? null : (base.endsWith("/") ? base.substring(0, base.length() - 1) : base) + "/api/avatar/" + bound);
            }
            if ((bound == null || bound.isBlank()) && ((Number) member.get("userId")).longValue() == callerId) {
                try { member.put("accountId", account.currentAccountIdOrNull()); }
                catch (RuntimeException ignored) { member.put("accountId", null); }
            }
        }
        if (store.currentActor().id() != callerId) throw invalid("IDENTITY_CHANGED", 409);
        return members;
    }

    private Response download(long fileId) throws SQLException {
        LocalCoreStore.FileTarget target;
        try (Connection c = database.getConnection()) {
            // The URL carries a file id, never a client-supplied project or disk path.
            try (var s = c.prepareStatement("SELECT project_id FROM project_file WHERE id=? AND is_deleted=FALSE")) {
                s.setLong(1, fileId);
                try (var r = s.executeQuery()) {
                    if (!r.next()) throw invalid("FILE_NOT_FOUND", 404);
                    long projectId = r.getLong(1);
                    if (r.wasNull() || r.next()) throw invalid("INVALID_STORED_IDENTITY", 409);
                    target = store.fileTargetForRead(c, projectId, fileId);
                }
            }
        } catch (LocalCoreStore.LocalCoreException e) {
            if (e.code().equals("FILE_MOVED")) return error(404, "FILE_NOT_FOUND");
            throw e;
        }
        String name = target.name();
        if (name == null || name.isBlank()) name = fileId + ".docx";
        else if (target.fileType() != null && !target.fileType().isBlank()
                && !name.toLowerCase(Locale.ROOT).endsWith("." + target.fileType().toLowerCase(Locale.ROOT))) name += "." + target.fileType();
        String encoded = URLEncoder.encode(name, StandardCharsets.UTF_8).replace("+", "%20");
        return new Response(200, Map.of("Content-Type", mediaType(name), "Content-Disposition", "attachment; filename=\"" + encoded + "\"",
                "Cache-Control", "no-store"), null, target.path());
    }

    private static String mediaType(String name) {
        String extension = name.substring(name.lastIndexOf('.') + 1).toLowerCase(Locale.ROOT);
        return switch (extension) {
            case "doc", "docx" -> "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
            case "pdf" -> "application/pdf";
            case "png" -> "image/png";
            case "jpg", "jpeg" -> "image/jpeg";
            case "gif" -> "image/gif";
            case "txt" -> "text/plain";
            case "mp4" -> "video/mp4";
            case "webm" -> "video/webm";
            case "ogv" -> "video/ogg";
            case "mov" -> "video/quicktime";
            case "m4v" -> "video/x-m4v";
            case "mkv" -> "video/x-matroska";
            case "avi" -> "video/x-msvideo";
            case "mp3" -> "audio/mpeg";
            case "ogg", "opus" -> "audio/ogg";
            case "m4a" -> "audio/mp4";
            case "wav" -> "audio/wav";
            case "flac" -> "audio/flac";
            case "aac" -> "audio/aac";
            default -> "application/octet-stream";
        };
    }

    private static Map<String, String> query(String raw) {
        Map<String, String> result = new LinkedHashMap<>();
        if (raw == null || raw.isEmpty()) return result;
        for (String pair : raw.split("&", -1)) {
            if (pair.isEmpty()) continue;
            String[] parts = pair.split("=", 2);
            try {
                String key = URLDecoder.decode(parts[0], StandardCharsets.UTF_8);
                String value = parts.length == 1 ? "" : URLDecoder.decode(parts[1], StandardCharsets.UTF_8);
                if (result.putIfAbsent(key, value) != null) throw invalid("DUPLICATE_QUERY_PARAMETER", 400);
            } catch (IllegalArgumentException e) { throw invalid("INVALID_QUERY", 400); }
        }
        return result;
    }

    private static String header(Request request, String name) {
        List<String> values = new ArrayList<>();
        request.headers().forEach((key, entries) -> { if (key.equalsIgnoreCase(name)) values.addAll(entries); });
        if (values.size() > 1) throw invalid("DUPLICATE_AUTH_HEADER", 400);
        return values.isEmpty() ? null : values.get(0);
    }
    private static boolean booleanQuery(String value) {
        if (value == null) return false;
        if (value.equalsIgnoreCase("true") || value.equalsIgnoreCase("on") || value.equalsIgnoreCase("yes") || value.equals("1")) return true;
        if (value.equalsIgnoreCase("false") || value.equalsIgnoreCase("off") || value.equalsIgnoreCase("no") || value.equals("0")) return false;
        throw invalid("INVALID_BOOLEAN", 400);
    }
    private static long id(String value, int status) {
        try { long id = Long.parseLong(value); if (id > 0) return id; }
        catch (NumberFormatException ignored) { }
        throw invalid("INVALID_ID", status);
    }
    private static LocalCoreStore.LocalCoreException invalid(String code, int status) {
        return new LocalCoreStore.LocalCoreException(code, status, code);
    }
    private static Response error(int status, String reason) { return json(status, Map.of("code", -1, "reason", reason, "message", reason)); }
    private static Response json(int status, Object body) { return new Response(status, Map.of("Content-Type", "application/json", "Cache-Control", "no-store"), body, null); }
}
