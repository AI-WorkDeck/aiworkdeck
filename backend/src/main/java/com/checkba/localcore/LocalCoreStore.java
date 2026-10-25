// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.localcore;

import javax.sql.DataSource;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.NoSuchFileException;
import java.nio.file.Path;
import java.sql.Clob;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

/**
 * JDBC access to the existing desktop H2 authority; never creates or migrates a schema.
 * The caller owns the process/authority lease, repository lock and save journal. In particular,
 * Connection-taking methods neither commit nor acquire those locks. They must run after the lease
 * and repository lock have been acquired, using READ_COMMITTED rather than an earlier snapshot.
 * FileTarget is an internal capability description, not a JSON response (it contains disk paths).
 */
public final class LocalCoreStore {
    public static final String SELECTED_IDENTITY_KEY = "local.identity.selectedUserId";
    private static final List<String> TEST_PREFIXES = List.of("qa_bot_", "claude-e2e", "e2e_keepalive");
    private static final Set<String> USER_ROLES = Set.of("USER", "ADMIN", "CLIENT");
    private static final Set<String> MEMBER_ROLES = Set.of("ADMIN", "PARTICIPANT", "READ_ONLY", "CLIENT", "CLIENT_NAMED", "CLIENT_GENERIC");
    private static final String USER_COLUMNS = "id, username, display_name, avatar_url, role, subscription_type, phone, verified_email, totp_enabled";
    private static final String PROJECT_COLUMNS = "id, name, project_type, listed_company_name, target_company_name, listed_company_info_json, target_company_info_json, user_id, local_root, version_opt_out, created_at, updated_at, uid";
    private static final String FILE_COLUMNS = "id, project_id, parent_id, is_folder, name, file_type, file_size, file_path, external_path, wps_file_id, sort_order, user_id, client_visible, created_at, updated_at, is_deleted, uid, meta_json, deleted_at";
    private final DataSource dataSource;
    private final Path storageRoot;

    public LocalCoreStore(DataSource dataSource, Path storageRoot) {
        this.dataSource = Objects.requireNonNull(dataSource);
        if (storageRoot == null || !storageRoot.isAbsolute()) throw new IllegalArgumentException("An absolute storage root is required");
        this.storageRoot = storageRoot.normalize();
    }

    public record Actor(long id, String username, String displayName, String avatarUrl, String role,
                        String subscriptionType, String phoneMasked, String emailMasked, boolean totpEnabled) {}
    public record IdentityStatus(boolean localMode, boolean needsSelection, Long userId, String username, String displayName) {}
    public record IdentityCandidate(long userId, String username, String displayName, long projectCount, long fileCount) {}
    public record FileTarget(long id, long projectId, String uid, String storageKey, String externalPath,
                             Path path, Actor actor, boolean canWrite, String name, String fileType) {}

    public static final class LocalCoreException extends IllegalStateException {
        private final String code;
        private final int status;
        public LocalCoreException(String code, int status, String message) {
            super(message); this.code = code; this.status = status;
        }
        public String code() { return code; }
        public int status() { return status; }
    }

    /** Missing or stale selection never silently chooses another user's workspace. */
    public IdentityStatus identityStatus() throws SQLException {
        try (Connection c = dataSource.getConnection()) {
            Actor actor = selectedActor(c);
            return actor == null ? new IdentityStatus(true, true, null, null, null) : identityStatus(actor);
        }
    }

    public List<IdentityCandidate> identityCandidates() throws SQLException {
        try (Connection c = dataSource.getConnection()) {
            List<IdentityCandidate> result = new ArrayList<>();
            for (Map<String, Object> row : query(c, "SELECT u.id, u.username, u.display_name, "
                    + "(SELECT COUNT(*) FROM project p WHERE p.user_id=u.id) AS project_count, "
                    + "(SELECT COUNT(*) FROM project_file f WHERE f.user_id=u.id AND f.is_deleted=FALSE) AS file_count "
                    + "FROM app_users u")) {
                String username = string(row, "username");
                if (!isTestAccount(username)) result.add(new IdentityCandidate(number(row, "id"), username,
                        string(row, "displayName"), number(row, "projectCount"), number(row, "fileCount")));
            }
            result.sort(Comparator.comparingLong((IdentityCandidate candidate) -> candidate.projectCount() + candidate.fileCount())
                    .reversed().thenComparingLong(IdentityCandidate::userId));
            return result;
        }
    }

    /** Explicit selection is the only identity write here; no user creation or display-name rewrite. */
    public IdentityStatus selectIdentity(long userId) throws SQLException {
        positive(userId);
        try (Connection c = dataSource.getConnection()) {
            c.setAutoCommit(false);
            try {
                Actor actor = actorById(c, userId);
                if (actor == null || isTestAccount(actor.username())) throw denied("INVALID_IDENTITY", 400);
                try (PreparedStatement s = c.prepareStatement("MERGE INTO system_setting(config_key, \"value\") KEY(config_key) VALUES (?, ?)")) {
                    s.setString(1, SELECTED_IDENTITY_KEY); s.setString(2, Long.toString(userId)); s.executeUpdate();
                }
                c.commit();
                return identityStatus(actor);
            } catch (SQLException | RuntimeException e) {
                c.rollback(); throw e;
            }
        }
    }

    public Actor currentActor() throws SQLException {
        try (Connection c = dataSource.getConnection()) { return currentActor(c); }
    }

    public Actor currentActor(Connection c) throws SQLException {
        Actor actor = selectedActor(c);
        if (actor == null) throw denied("IDENTITY_SELECTION_REQUIRED", 409);
        return actor;
    }

    /** All ProjectCardDTO fields, including actual profile values and latest file activity. */
    public List<Map<String, Object>> projectCards() throws SQLException {
        try (Connection c = dataSource.getConnection()) {
            Actor actor = currentActor(c);
            List<Map<String, Object>> result = new ArrayList<>();
            for (Map<String, Object> project : query(c, "SELECT " + PROJECT_COLUMNS + " FROM project p WHERE "
                    + "(p.user_id=? OR EXISTS (SELECT 1 FROM project_member m WHERE m.project_id=p.id AND m.user_id=?)) "
                    + "AND p.project_type <> 'LOOSE_FILES' "
                    + "AND NOT EXISTS (SELECT 1 FROM addin_project_link link WHERE link.user_id=? AND link.cloud_project_id=p.id) "
                    + "ORDER BY p.created_at DESC, p.id", actor.id(), actor.id(), actor.id())) {
                Access access = access(c, project, actor);
                Map<String, Object> card = new LinkedHashMap<>();
                for (String field : List.of("id", "name", "projectType", "listedCompanyName", "targetCompanyName", "userId", "createdAt", "updatedAt")) card.put(field, project.get(field));
                long projectId = number(project, "id");
                Map<String, Object> activity = one(c, "SELECT MAX(updated_at) AS latest FROM project_file WHERE project_id=? AND is_deleted=FALSE", projectId);
                card.put("lastActivityAt", activity.get("latest") == null ? project.get("updatedAt") : activity.get("latest"));
                Map<String, String> profile = new LinkedHashMap<>();
                for (Map<String, Object> field : query(c, "SELECT field_key, field_value FROM project_profile_field WHERE project_id=?", projectId)) {
                    String value = string(field, "fieldValue");
                    if (value != null && !value.isBlank()) profile.put(string(field, "fieldKey"), value);
                }
                card.put("profile", profile); card.put("myRole", access.role());
                Actor manager = actorById(c, number(project, "userId"));
                card.put("managerId", manager == null ? null : manager.id());
                card.put("managerName", manager == null ? null : manager.displayName());
                card.put("managerAvatarUrl", manager == null ? null : manager.avatarUrl());
                result.add(card);
            }
            return result;
        }
    }

    public Map<String, Object> projectDetail(long projectId) throws SQLException {
        try (Connection c = dataSource.getConnection()) {
            Map<String, Object> project = project(c, projectId);
            Access access = access(c, project, currentActor(c));
            if (access.client()) project.remove("localRoot");
            return project;
        }
    }

    /** Account binding is included; current machine-account fallback/remote avatar enrichment belongs to the HTTP adapter. */
    public List<Map<String, Object>> projectMembers(long projectId) throws SQLException {
        try (Connection c = dataSource.getConnection()) {
            Map<String, Object> project = project(c, projectId);
            access(c, project, currentActor(c));
            List<Map<String, Object>> result = query(c, "SELECT id, user_id, role, joined_at FROM project_member WHERE project_id=? ORDER BY id", projectId);
            long owner = number(project, "userId");
            if (result.stream().noneMatch(m -> number(m, "userId") == owner) && actorById(c, owner) != null) {
                Map<String, Object> entry = new LinkedHashMap<>();
                entry.put("id", 0L); entry.put("userId", owner); entry.put("role", "ADMIN"); entry.put("joinedAt", null);
                result.add(0, entry);
            }
            for (Map<String, Object> member : result) {
                Actor user = actorById(c, number(member, "userId"));
                if (user == null) continue;
                member.put("username", user.username()); member.put("displayName", user.displayName());
                member.put("avatarUrl", user.avatarUrl());
                Map<String, Object> binding = one(c, "SELECT external_account_id FROM account_binding WHERE user_id=?", user.id());
                member.put("accountId", binding == null ? null : binding.get("externalAccountId"));
            }
            return result;
        }
    }

    /** Matches the Explorer endpoint: customers cannot enumerate even their visible files. */
    public List<Map<String, Object>> files(long projectId, Long parentId, boolean tree, List<Long> ids) throws SQLException {
        try (Connection c = dataSource.getConnection()) {
            Access access = access(c, project(c, projectId), currentActor(c));
            if (access.client()) throw denied("EXPLORER_FORBIDDEN", 403);
            String sql = "SELECT " + FILE_COLUMNS + " FROM project_file WHERE project_id=? AND is_deleted=FALSE";
            List<Object> parameters = new ArrayList<>(); parameters.add(projectId);
            if (ids != null) {
                if (ids.size() > 200) throw denied("INVALID_FILE_IDS", 400);
                if (ids.isEmpty()) return List.of();
                for (Long id : ids) { if (id == null) throw denied("INVALID_FILE_IDS", 400); positive(id); parameters.add(id); }
                sql += " AND id IN (" + placeholders(ids.size()) + ")";
            } else if (!tree) {
                sql += parentId == null ? " AND parent_id IS NULL" : " AND parent_id=?";
                if (parentId != null) {
                    positive(parentId);
                    Map<String, Object> parent = file(c, projectId, parentId);
                    if (!Boolean.TRUE.equals(parent.get("isFolder"))) throw denied("INVALID_PARENT", 400);
                    parameters.add(parentId);
                }
            }
            List<Map<String, Object>> result = query(c, sql + " ORDER BY sort_order, id", parameters.toArray());
            Map<Long, List<Map<String, Object>>> tags = ids == null ? tags(c, projectId, result) : Map.of();
            for (Map<String, Object> row : result) {
                row.remove("externalPath");
                row.put("clientVisible", Boolean.TRUE.equals(row.get("clientVisible")));
                row.put("tags", ids == null ? tags.getOrDefault(number(row, "id"), List.of()) : null);
            }
            return result;
        }
    }

    public FileTarget fileTargetForRead(Connection c, long projectId, long fileId) throws SQLException {
        return fileTarget(c, projectId, fileId, false);
    }

    /** Read-only preflight; it does not keep identity stable through a later publication or commit. */
    public FileTarget fileTargetForWrite(Connection c, long projectId, long fileId) throws SQLException {
        return fileTarget(c, projectId, fileId, true);
    }

    /**
     * Pin the selected identity before actual publication, then freshly authorize the target.
     * The caller must already hold its core lease and repository lock, use this same READ_COMMITTED
     * transaction for publication/metadata, and commit or roll back before releasing those guards.
     * selectIdentity's MERGE waits on this row until that transaction ends. This method never commits.
     * If a request has an earlier preflight target, compare its actor and target identity with this
     * returned target BEFORE writing bytes; locking does not make an earlier capability current.
     */
    public FileTarget lockFileTargetForWrite(Connection c, long projectId, long fileId) throws SQLException {
        if (c.getAutoCommit()) throw new IllegalArgumentException("Content publication requires the caller's transaction");
        if (c.getTransactionIsolation() != Connection.TRANSACTION_READ_COMMITTED) throw new IllegalArgumentException("A fresh READ_COMMITTED connection is required");
        if (one(c, "SELECT \"value\" FROM system_setting WHERE config_key=? FOR UPDATE", SELECTED_IDENTITY_KEY) == null) {
            throw denied("IDENTITY_SELECTION_REQUIRED", 409);
        }
        return fileTargetForWrite(c, projectId, fileId);
    }

    /**
     * Only content metadata changes. A changed target returns zero; identity/permission changes are
     * explicit errors. Actual byte publication must first call lockFileTargetForWrite on this same
     * connection and retain that transaction through commit. This update does not acquire that lock
     * itself, and a rejected update does not mean previously published bytes were rolled back.
     */
    public int updateContentMetadata(Connection c, FileTarget expected, long size, LocalDateTime updatedAt) throws SQLException {
        if (c.getAutoCommit()) throw new IllegalArgumentException("Content metadata requires the caller's transaction");
        if (size < 0 || updatedAt == null) throw new IllegalArgumentException("Invalid content metadata");
        FileTarget current = fileTargetForWrite(c, expected.projectId(), expected.id());
        if (current.actor().id() != expected.actor().id()) throw denied("IDENTITY_CHANGED", 409);
        if (!Objects.equals(current.uid(), expected.uid()) || !Objects.equals(current.storageKey(), expected.storageKey())
                || !Objects.equals(current.externalPath(), expected.externalPath()) || !current.path().equals(expected.path())) return 0;
        try (PreparedStatement s = c.prepareStatement("UPDATE project_file SET file_size=?, updated_at=? "
                + "WHERE id=? AND project_id=? AND uid IS NOT DISTINCT FROM ? AND file_path=? "
                + "AND external_path IS NOT DISTINCT FROM ? AND is_deleted=FALSE AND is_folder=FALSE "
                + "AND EXISTS (SELECT 1 FROM system_setting WHERE config_key=? AND \"value\"=?)")) {
            s.setLong(1, size); s.setObject(2, updatedAt); s.setLong(3, expected.id()); s.setLong(4, expected.projectId());
            s.setString(5, expected.uid()); s.setString(6, expected.storageKey()); s.setString(7, expected.externalPath());
            s.setString(8, SELECTED_IDENTITY_KEY); s.setString(9, Long.toString(expected.actor().id()));
            return s.executeUpdate();
        }
    }

    private FileTarget fileTarget(Connection c, long projectId, long fileId, boolean write) throws SQLException {
        if (c.getTransactionIsolation() != Connection.TRANSACTION_READ_COMMITTED) throw new IllegalArgumentException("A fresh READ_COMMITTED connection is required");
        Actor actor = currentActor(c);
        Map<String, Object> project = project(c, projectId);
        Access access = access(c, project, actor);
        Map<String, Object> file = file(c, projectId, fileId);
        if (!Boolean.FALSE.equals(file.get("isFolder"))) throw denied("NOT_A_FILE", 400);
        if (access.client() && number(file, "userId") != actor.id() && !Boolean.TRUE.equals(file.get("clientVisible"))) throw denied("FILE_FORBIDDEN", 403);
        Path path = resolvePath(project, file);
        boolean canWrite = access.writable() && !protectedOriginal(c, project, file, path);
        if (write && !canWrite) throw denied("FILE_READ_ONLY", 403);
        return new FileTarget(fileId, projectId, string(file, "uid"), string(file, "filePath"),
                string(file, "externalPath"), path, actor, canWrite, string(file, "name"), string(file, "fileType"));
    }

    private record Access(String role, boolean client, boolean writable) {}

    /** Mirrors ProjectMemberService and ProjectFileAccessService, without loading their JPA dependencies. */
    private Access access(Connection c, Map<String, Object> project, Actor actor) throws SQLException {
        String role;
        if (number(project, "userId") == actor.id()) role = "OWNER";
        else {
            Map<String, Object> member = one(c, "SELECT role FROM project_member WHERE project_id=? AND user_id=?", number(project, "id"), actor.id());
            if (member == null) throw denied("PROJECT_FORBIDDEN", 403);
            role = string(member, "role");
            if (!MEMBER_ROLES.contains(role == null ? "" : role)) throw denied("UNKNOWN_MEMBER_ROLE", 403);
        }
        boolean client = "CLIENT".equalsIgnoreCase(actor.role()) || role.startsWith("CLIENT");
        return new Access(role, client, !client && Set.of("OWNER", "ADMIN", "PARTICIPANT").contains(role));
    }

    private Map<String, Object> project(Connection c, long id) throws SQLException {
        positive(id);
        Map<String, Object> row = one(c, "SELECT " + PROJECT_COLUMNS + " FROM project WHERE id=?", id);
        if (row == null) throw denied("PROJECT_NOT_FOUND", 404);
        return row;
    }

    private Map<String, Object> file(Connection c, long projectId, long id) throws SQLException {
        positive(id);
        Map<String, Object> row = one(c, "SELECT " + FILE_COLUMNS + " FROM project_file WHERE id=? AND project_id=? AND is_deleted=FALSE", id, projectId);
        if (row == null) throw denied("FILE_NOT_FOUND", 404);
        return row;
    }

    private Actor selectedActor(Connection c) throws SQLException {
        Map<String, Object> selected = one(c, "SELECT \"value\" FROM system_setting WHERE config_key=?", SELECTED_IDENTITY_KEY);
        if (selected == null) return null;
        try {
            long id = Long.parseLong(string(selected, "value"));
            if (id <= 0) return null;
            Actor actor = actorById(c, id);
            return actor == null || isTestAccount(actor.username()) ? null : actor;
        } catch (NumberFormatException e) { return null; }
    }

    private Actor actorById(Connection c, long id) throws SQLException {
        Map<String, Object> row = one(c, "SELECT " + USER_COLUMNS + " FROM app_users WHERE id=?", id);
        if (row == null) return null;
        String role = string(row, "role");
        if (!USER_ROLES.contains(role == null ? "" : role.toUpperCase(Locale.ROOT))) throw denied("UNKNOWN_USER_ROLE", 403);
        String phone = string(row, "phone"); String email = string(row, "verifiedEmail");
        String maskedPhone = phone == null || phone.length() < 7 ? "" : phone.substring(0, 3) + "****" + phone.substring(phone.length() - 4);
        int at = email == null ? -1 : email.indexOf('@');
        String maskedEmail = at < 0 ? "" : (at <= 1 ? "***" : email.charAt(0) + "***") + email.substring(at);
        return new Actor(id, string(row, "username"), string(row, "displayName"), string(row, "avatarUrl"), role,
                string(row, "subscriptionType"), maskedPhone, maskedEmail, Boolean.TRUE.equals(row.get("totpEnabled")));
    }

    private record MappedPath(Path base, Path path, boolean external) {}

    /** Mapping does not require the file to exist; submitted-original identities survive external moves. */
    private MappedPath mapPath(Map<String, Object> project, Map<String, Object> file) {
        String key = string(file, "filePath");
        if (key == null || key.isBlank()) throw denied("INVALID_FILE_PATH", 409);
        String normalized = key.replace('\\', '/');
        String prefix = "projects/" + number(project, "id") + "/";
        if (!normalized.startsWith(prefix)) throw denied("INVALID_FILE_PATH", 409);
        String relative = normalized.substring(prefix.length());
        Path path;
        Path base;
        boolean isExternal = "LOOSE_FILES".equals(project.get("projectType")) && relative.startsWith("loose/");
        if (isExternal) {
            String external = string(file, "externalPath");
            if (external == null || external.isBlank()) throw denied("INVALID_FILE_PATH", 409);
            path = Path.of(external);
            if (!path.isAbsolute() || !path.equals(path.normalize())) throw denied("INVALID_FILE_PATH", 409);
            base = path.getParent();
        } else {
            if (file.get("externalPath") != null) throw denied("INVALID_FILE_PATH", 409);
            String localRoot = string(project, "localRoot");
            base = localRoot == null || localRoot.isBlank() ? storageRoot.resolve("projects").resolve(Long.toString(number(project, "id"))) : Path.of(localRoot);
            if (!base.isAbsolute()) throw denied("INVALID_FILE_PATH", 409);
            base = base.normalize();
            Path remainder = Path.of(relative);
            if (remainder.isAbsolute() || remainder.getNameCount() == 0) throw denied("INVALID_FILE_PATH", 409);
            path = base.resolve(remainder).normalize();
            if (path.equals(base) || !path.startsWith(base)) throw denied("INVALID_FILE_PATH", 409);
        }
        return new MappedPath(base, path, isExternal);
    }

    private Path resolvePath(Map<String, Object> project, Map<String, Object> file) {
        MappedPath mapped = mapPath(project, file);
        Path path = mapped.path(); Path base = mapped.base();
        try {
            if (!Files.isRegularFile(path, LinkOption.NOFOLLOW_LINKS)) throw denied("FILE_MOVED", 409);
            Path realBase = base.toRealPath();
            Path realPath = path.toRealPath();
            if (!realPath.equals(realBase.resolve(base.relativize(path)))) throw denied("FILE_MOVED", 409);
            // A loose-file grant is to the exact path, including its parent chain.
            if (mapped.external() && !realPath.equals(path)) throw denied("FILE_MOVED", 409);
            return realPath;
        } catch (IOException e) { throw denied("FILE_MOVED", 409); }
    }

    /** DdOriginalGuard also protects another row resolving to the same submitted bytes. */
    private boolean protectedOriginal(Connection c, Map<String, Object> project, Map<String, Object> targetFile, Path target) throws SQLException {
        Set<Long> protectedIds = new LinkedHashSet<>();
        for (Map<String, Object> row : query(c, "SELECT file_ids_json FROM dd_submission WHERE project_id=?", number(project, "id"))) {
            String json = string(row, "fileIdsJson");
            if (json == null) continue;
            if (!json.matches("\\s*\\[\\s*(?:[1-9][0-9]*\\s*(?:,\\s*[1-9][0-9]*\\s*)*)?]\\s*")) throw denied("INVALID_SUBMISSION", 409);
            String content = json.substring(json.indexOf('[') + 1, json.lastIndexOf(']')).trim();
            if (!content.isEmpty()) for (String value : content.split(",")) {
                try { protectedIds.add(Long.parseLong(value.trim())); }
                catch (NumberFormatException e) { throw denied("INVALID_SUBMISSION", 409); }
            }
        }
        if (protectedIds.contains(number(targetFile, "id"))) return true;
        Path mappedTarget = mapPath(project, targetFile).path();
        for (long id : protectedIds) {
            Map<String, Object> original = one(c, "SELECT " + FILE_COLUMNS + " FROM project_file WHERE id=? AND project_id=?", id, number(project, "id"));
            if (original == null || original.get("filePath") == null) continue;
            Path originalPath = mapPath(project, original).path();
            if (originalPath.startsWith(mappedTarget)) return true;
            try {
                if (originalPath.toRealPath().startsWith(target)) return true;
            } catch (NoSuchFileException e) {
                // A missing, unrelated original does not make this existing target unreadable.
                // The lexical identity comparison above still protects its normalized aliases.
            } catch (IOException e) { throw denied("FILE_MOVED", 409); }
        }
        return false;
    }

    private Map<Long, List<Map<String, Object>>> tags(Connection c, long projectId, List<Map<String, Object>> files) throws SQLException {
        Map<Long, List<Map<String, Object>>> result = new LinkedHashMap<>();
        for (int start = 0; start < files.size(); start += 200) {
            List<Object> parameters = new ArrayList<>(); parameters.add(projectId);
            for (Map<String, Object> file : files.subList(start, Math.min(start + 200, files.size()))) parameters.add(number(file, "id"));
            for (Map<String, Object> tag : query(c, "SELECT ft.file_id, t.id, t.project_id, t.name, t.color, t.is_system, t.type, t.description, t.created_at, t.updated_at "
                    + "FROM project_tag t JOIN project_file_tag ft ON ft.tag_id=t.id WHERE t.project_id=? AND ft.file_id IN ("
                    + placeholders(parameters.size() - 1) + ") ORDER BY t.id", parameters.toArray())) {
                long fileId = number(tag, "fileId"); tag.remove("fileId");
                result.computeIfAbsent(fileId, ignored -> new ArrayList<>()).add(tag);
            }
        }
        return result;
    }

    private static IdentityStatus identityStatus(Actor actor) { return new IdentityStatus(true, false, actor.id(), actor.username(), actor.displayName()); }
    private static boolean isTestAccount(String username) { return username != null && TEST_PREFIXES.stream().anyMatch(username.toLowerCase(Locale.ROOT)::startsWith); }
    private static void positive(long id) { if (id <= 0) throw denied("INVALID_ID", 400); }
    private static LocalCoreException denied(String code, int status) { return new LocalCoreException(code, status, code); }
    private static String string(Map<String, Object> row, String key) { Object value = row.get(key); return value == null ? null : value.toString(); }
    private static long number(Map<String, Object> row, String key) { Object value = row.get(key); if (!(value instanceof Number n)) throw denied("INVALID_STORED_ID", 409); return n.longValue(); }
    private static String placeholders(int count) { return String.join(",", java.util.Collections.nCopies(count, "?")); }

    private static Map<String, Object> one(Connection c, String sql, Object... parameters) throws SQLException {
        List<Map<String, Object>> rows = query(c, sql, parameters);
        if (rows.size() > 1) throw denied("AMBIGUOUS_STORED_IDENTITY", 409);
        return rows.isEmpty() ? null : rows.get(0);
    }

    private static List<Map<String, Object>> query(Connection c, String sql, Object... parameters) throws SQLException {
        try (PreparedStatement s = c.prepareStatement(sql)) {
            for (int i = 0; i < parameters.length; i++) s.setObject(i + 1, parameters[i]);
            try (ResultSet r = s.executeQuery()) {
                List<Map<String, Object>> rows = new ArrayList<>();
                while (r.next()) {
                    Map<String, Object> row = new LinkedHashMap<>();
                    for (int i = 1; i <= r.getMetaData().getColumnCount(); i++) {
                        Object value = r.getObject(i);
                        if (value instanceof Clob) value = r.getString(i);
                        if (value instanceof Timestamp time) value = time.toLocalDateTime();
                        row.put(camelCase(r.getMetaData().getColumnLabel(i)), value);
                    }
                    rows.add(row);
                }
                return rows;
            }
        }
    }

    private static String camelCase(String column) {
        StringBuilder result = new StringBuilder(); boolean upper = false;
        for (char ch : column.toLowerCase(Locale.ROOT).toCharArray()) {
            if (ch == '_') upper = true;
            else { result.append(upper ? Character.toUpperCase(ch) : ch); upper = false; }
        }
        return result.toString();
    }
}
