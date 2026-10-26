// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.im;

import com.checkba.model.entity.ProjectFile;
import com.checkba.repository.ProjectRepository;
import com.checkba.service.ProjectFileService;
import com.checkba.service.ProjectFileAccessService;
import com.checkba.service.ProjectMemberService;
import com.checkba.service.mobile.ProjectCatalogService;
import com.checkba.storage.StorageServiceFactory;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.*;

/** Explicit, permission-checked copies into the ordinary project tree and its Git history. */
@Service
public class ImProjectFiles implements ImProjectActionHandler {
    static final int MAX_BYTES = 8 * 1024 * 1024;
    static final int MAX_ARCHIVE_BYTES = 16 * 1024 * 1024;
    private final ImGatewayService gateway;
    private final ProjectMemberService access;
    private final ProjectRepository projects;
    private final ProjectFileService files;
    private final ProjectFileAccessService fileAccess;
    private final ProjectCatalogService catalog;
    private final StorageServiceFactory storage;
    private final ObjectMapper json;

    public ImProjectFiles(ImGatewayService gateway, ProjectMemberService access, ProjectRepository projects,
            ProjectFileService files, ProjectFileAccessService fileAccess, ProjectCatalogService catalog, StorageServiceFactory storage, ObjectMapper json) {
        this.gateway = gateway; this.access = access; this.projects = projects; this.files = files;
        this.fileAccess = fileAccess; this.catalog = catalog; this.storage = storage; this.json = json;
    }

    @Override public boolean supports(String action) {
        return Set.of("import", "binding", "export", "sendFile").contains(action);
    }

    /** Reuse the identity carried with the project in Git, including after a clone gets a new local DB ID. */
    @Transactional(isolation = org.springframework.transaction.annotation.Isolation.READ_COMMITTED)
    public String ensureIdentity(Long userId, Long projectId, String accountScope) {
        if (userId == null || projectId == null || !access.hasReadPermission(projectId, userId))
            throw new IllegalArgumentException(com.checkba.service.LangText.of("没有当前项目的访问权限", "You do not have access to the current project"));
        gateway.assertAccountScope(accountScope);
        projects.lockForImWrite(projectId).orElseThrow(() -> new IllegalArgumentException(com.checkba.service.LangText.of("项目不存在", "Project not found")));
        String uid = identity(userId, projectId, accountScope);
        gateway.assertAccountScope(accountScope);
        return uid;
    }

    /** Replying with existing private context must never create project files. */
    public String readIdentity(Long userId, Long projectId, String accountScope) {
        if (userId == null || projectId == null || !access.hasReadPermission(projectId, userId))
            throw new IllegalArgumentException(com.checkba.service.LangText.of("没有当前项目的访问权限", "You do not have access to the current project"));
        gateway.assertAccountScope(accountScope);
        var file = files.findByRelativePath(projectId, "项目沟通/项目标识.json")
                .orElseThrow(() -> new IllegalArgumentException(com.checkba.service.LangText.of("项目尚未建立沟通标识", "Project communication identity has not been initialized yet")));
        String uid = uuid(parse(read(file, 64 * 1024)).get("projectUid"));
        gateway.assertAccountScope(accountScope);
        return uid;
    }

    private String identity(Long userId, Long projectId, String accountScope) {
        var identityFile = files.findByRelativePath(projectId, "项目沟通/项目标识.json");
        if (identityFile.isPresent()) return uuid(parse(read(identityFile.get(), 64 * 1024)).get("projectUid"));
        if (!access.hasWritePermission(projectId, userId) || fileAccess.isClient(projectId, userId))
            throw new IllegalArgumentException(com.checkba.service.LangText.of("请先由项目内部成员打开项目沟通，建立项目标识", "Please ask an internal project member to open Project IM first to initialize the project identity"));
        var project = projects.findById(projectId).orElseThrow(() -> new IllegalArgumentException(com.checkba.service.LangText.of("项目不存在", "Project not found")));
        String uid = catalog.ensureProjectUid(project);
        writeJson(accountScope, projectId, userId, "项目沟通", "项目标识.json", Map.of("schemaVersion", 1, "projectUid", uid));
        return uid;
    }

    @Override @Transactional(isolation = org.springframework.transaction.annotation.Isolation.READ_COMMITTED)
    public Object execute(Long userId, Long projectId, String action, Map<String, Object> params) {
        if (projectId == null || userId == null || !("sendFile".equals(action)
                ? access.hasReadPermission(projectId, userId) : access.hasWritePermission(projectId, userId))) {
            throw new IllegalArgumentException(com.checkba.service.LangText.of("没有此项目的文件操作权限", "You do not have file operation permission in this project"));
        }
        String accountScope = gateway.captureAccountScope();
        String conversationId = uuid(params.get("conversationId"));
        // Membership is always rechecked remotely, even for a previously imported attachment.
        remote(userId, accountScope, "members", Map.of("conversationId", conversationId));
        // Serialize identity creation and imports so a losing transaction cannot remove a winner's files.
        projects.lockForImWrite(projectId)
                .orElseThrow(() -> new IllegalArgumentException(com.checkba.service.LangText.of("项目不存在", "Project not found")));
        return switch (action) {
            case "import" -> importAttachment(userId, projectId, conversationId, uuid(params.get("attachmentId")), accountScope);
            case "binding" -> bind(userId, projectId, conversationId, accountScope);
            case "export" -> export(userId, projectId, conversationId, accountScope);
            case "sendFile" -> sendFile(userId, projectId, conversationId, params, accountScope);
            default -> throw new IllegalArgumentException(com.checkba.service.LangText.of("不支持的项目操作", "Unsupported project action"));
        };
    }

    private Map<String, Object> bind(Long userId, Long projectId, String conversationId, String accountScope) {
        String dir = "项目沟通/" + conversationId;
        String path = dir + "/会话关联.json";
        var previous = files.findByRelativePath(projectId, path);
        if (previous.isPresent()) {
            Map<String, Object> manifest = parse(read(previous.get(), 64 * 1024));
            if (!conversationId.equals(manifest.get("conversationId"))) throw new IllegalArgumentException(com.checkba.service.LangText.of("会话关联文件不匹配", "Conversation binding file does not match"));
            // This identity travels in Git, while the host's numeric project ID stays device-local.
            String uid = uuid(manifest.get("projectUid"));
            return Map.of("projectUid", uid, "conversationId", conversationId, "path", path);
        }
        String uid = identity(userId, projectId, accountScope);
        Map<String, Object> manifest = Map.of("schemaVersion", 1, "projectUid", uid,
                "conversationId", conversationId, "createdAt", Instant.now().toString());
        writeJson(accountScope, projectId, userId, dir, "会话关联.json", manifest);
        return Map.of("projectUid", uid, "conversationId", conversationId, "path", path);
    }

    private Map<String, Object> importAttachment(Long userId, Long projectId, String conversationId, String attachmentId, String accountScope) {
        Map<String, Object> attachment = map(remote(userId, accountScope, "download",
                Map.of("conversationId", conversationId, "attachmentId", attachmentId)));
        byte[] bytes = decode(attachment.get("base64"));
        String expectedHash = String.valueOf(attachment.get("sha256"));
        if (!sha256(bytes).equals(expectedHash)) throw new IllegalArgumentException(com.checkba.service.LangText.of("附件校验失败，未保存", "Attachment checksum verification failed; file was not saved"));
        String name = safeName(attachment.get("name"));
        bind(userId, projectId, conversationId, accountScope);
        String dir = "项目沟通/" + conversationId + "/文件/" + attachmentId;
        String path = dir + "/" + name;
        var existing = files.findByRelativePath(projectId, path);
        // Preserve edits to a previously saved copy; reopening must never overwrite the user's work.
        ProjectFile file = existing.orElseGet(() -> write(accountScope, projectId, userId, dir, name, bytes));
        String sourceDir = "项目沟通/" + conversationId + "/来源";
        String sourcePath = sourceDir + "/" + attachmentId + ".json";
        if (files.findByRelativePath(projectId, sourcePath).isEmpty()) {
            writeJson(accountScope, projectId, userId, sourceDir, attachmentId + ".json", Map.of("schemaVersion", 1,
                    "conversationId", conversationId, "attachmentId", attachmentId,
                    "fileUid", catalog.ensureFileUid(file), "sha256", expectedHash, "name", name));
        }
        return describe(file, path);
    }

    private Object sendFile(Long userId, Long projectId, String conversationId, Map<String, Object> params, String accountScope) {
        String path = String.valueOf(params.getOrDefault("path", ""));
        ProjectFile file = files.findByRelativePath(projectId, path)
                .filter(f -> !Boolean.TRUE.equals(f.getIsFolder()))
                .orElseThrow(() -> new IllegalArgumentException(com.checkba.service.LangText.of("项目文件不存在", "Project file not found")));
        fileAccess.requireRead(file, userId);
        byte[] bytes = read(file, MAX_BYTES);
        var identity = files.findByRelativePath(projectId, "项目沟通/项目标识.json");
        String projectUid;
        if (identity.isPresent()) projectUid = uuid(parse(read(identity.get(), 64 * 1024)).get("projectUid"));
        else {
            if (!access.hasWritePermission(projectId, userId) || fileAccess.isClient(projectId, userId))
                throw new IllegalArgumentException(com.checkba.service.LangText.of("请先由项目内部成员关联当前项目，再引用文件", "Please ask an internal project member to bind this project before referencing files"));
            projectUid = (String) bind(userId, projectId, conversationId, accountScope).get("projectUid");
        }
        Map<String, Object> uploaded = map(remote(userId, accountScope, "upload", Map.of(
                "conversationId", conversationId, "name", file.getName(), "base64", Base64.getEncoder().encodeToString(bytes),
                "clientMessageId", params.get("clientMessageId"),
                "source", Map.of("projectUid", projectUid, "fileUid", catalog.ensureFileUid(file)))));
        Map<String, Object> send = new LinkedHashMap<>();
        send.put("conversationId", conversationId);
        send.put("attachmentId", uploaded.get("id"));
        send.put("clientMessageId", params.get("clientMessageId"));
        send.put("text", params.getOrDefault("text", ""));
        return remote(userId, accountScope, "send", send);
    }

    private Map<String, Object> export(Long userId, Long projectId, String conversationId, String accountScope) {
        Map<String, Object> binding = bind(userId, projectId, conversationId, accountScope);
        List<Object> messages = new ArrayList<>();
        long cursor = 0;
        int encodedBytes = 1024;
        // Explicit bounded snapshot, never silently claim a truncated archive is complete.
        for (int page = 0; page < 100; page++) {
            Map<String, Object> response = map(remote(userId, accountScope, "messages", Map.of(
                    "conversationId", conversationId, "afterId", cursor, "limit", 100)));
            Object raw = response.get("messages");
            if (!(raw instanceof List<?> batch)) throw new IllegalStateException(com.checkba.service.LangText.of("聊天记录响应无效", "Invalid chat history response"));
            if (batch.isEmpty()) break;
            try { encodedBytes += json.writeValueAsBytes(batch).length; }
            catch (IOException e) { throw new IllegalStateException(com.checkba.service.LangText.of("聊天记录格式无效", "Invalid chat history format"), e); }
            if (encodedBytes > MAX_ARCHIVE_BYTES) throw new IllegalArgumentException(com.checkba.service.LangText.of("聊天记录超过单次归档上限（16 MiB），未生成归档", "Chat history exceeds the single-archive limit (16 MiB); archive was not created"));
            messages.addAll(batch);
            long next = ((Number) map(batch.get(batch.size() - 1)).get("id")).longValue();
            if (next <= cursor) throw new IllegalStateException(com.checkba.service.LangText.of("聊天记录分页无效", "Invalid chat history pagination"));
            cursor = next;
            if (!Boolean.TRUE.equals(response.get("hasMore"))) break;
            if (page == 99) throw new IllegalArgumentException(com.checkba.service.LangText.of("聊天记录超过单次归档上限（10000 条），未生成归档", "Chat history exceeds the single-archive limit (10,000 messages); archive was not created"));
        }
        Map<String, Object> archive = new LinkedHashMap<>();
        archive.put("schemaVersion", 1); archive.put("projectUid", binding.get("projectUid"));
        archive.put("conversationId", conversationId); archive.put("exportedAt", Instant.now().toString());
        archive.put("throughMessageId", cursor); archive.put("messages", messages);
        String dir = "项目沟通/" + conversationId;
        String name = "聊天记录-" + UUID.randomUUID() + ".json";
        ProjectFile file = writeJson(accountScope, projectId, userId, dir, name, archive);
        Map<String, Object> result = new LinkedHashMap<>(describe(file, dir + "/" + file.getName()));
        result.put("messageCount", messages.size());
        return result;
    }

    private ProjectFile writeJson(String accountScope, Long projectId, Long userId, String dir, String name, Object value) {
        try {
            byte[] bytes = json.writeValueAsBytes(value);
            if (bytes.length > MAX_ARCHIVE_BYTES) throw new IllegalArgumentException(com.checkba.service.LangText.of("项目记录超过16 MiB，未保存", "Project record exceeds 16 MiB; not saved"));
            return write(accountScope, projectId, userId, dir, name, bytes);
        }
        catch (IOException e) { throw new IllegalStateException(com.checkba.service.LangText.of("无法生成项目记录", "Failed to generate project record"), e); }
    }

    private ProjectFile write(String accountScope, Long projectId, Long userId, String dir, String name, byte[] bytes) {
        gateway.assertAccountScope(accountScope);
        ProjectFile folder = files.ensureFolderPath(projectId, userId, List.of(dir.split("/")));
        int dot = name.lastIndexOf('.');
        String type = dot < 0 ? "bin" : name.substring(dot + 1).toLowerCase(Locale.ROOT);
        String expectedPath = "projects/" + projectId + "/" + dir + "/" + name;
        if (storage.getStorageService().exists(expectedPath)) throw new IllegalArgumentException(com.checkba.service.LangText.of("目标位置已有未登记文件，请先在项目中检查", "An unregistered file already exists at the target location; please check the project first"));
        ProjectFile file = files.createFile(projectId, folder.getId(), name, type, (long) bytes.length,
                null, null, userId, ProjectFileService.ConflictPolicy.FAIL);
        var blob = storage.getStorageService();
        if (org.springframework.transaction.support.TransactionSynchronizationManager.isSynchronizationActive()) {
            org.springframework.transaction.support.TransactionSynchronizationManager.registerSynchronization(
                new org.springframework.transaction.support.TransactionSynchronization() {
                    @Override public void afterCompletion(int status) {
                        if (status != STATUS_COMMITTED) blob.delete(file.getFilePath());
                    }
                });
        }
        String temporary = file.getFilePath() + ".im-" + UUID.randomUUID() + ".tmp";
        try {
            blob.save(temporary, new ByteArrayInputStream(bytes));
            gateway.assertAccountScope(accountScope);
            blob.move(temporary, file.getFilePath());
            gateway.assertAccountScope(accountScope);
        } finally { if (blob.exists(temporary)) blob.delete(temporary); }
        return file;
    }

    private Object remote(Long userId, String accountScope, String action, Map<String, Object> params) {
        gateway.assertAccountScope(accountScope);
        Object result = gateway.executeWithinScope(userId, accountScope, action, params);
        gateway.assertAccountScope(accountScope);
        return result;
    }

    private Map<String, Object> describe(ProjectFile file, String path) {
        return Map.of("id", file.getId(), "uid", catalog.ensureFileUid(file), "path", path,
                "name", file.getName(), "size", file.getFileSize());
    }

    private byte[] read(ProjectFile file, int limit) {
        try (var in = storage.getStorageService().load(file.getFilePath()).getInputStream()) {
            byte[] bytes = in.readNBytes(limit + 1);
            if (bytes.length > limit) throw new IllegalArgumentException(com.checkba.service.LangText.of("文件超过大小限制", "File exceeds size limit"));
            return bytes;
        } catch (IOException e) { throw new IllegalStateException(com.checkba.service.LangText.of("无法读取项目文件", "Failed to read project file"), e); }
    }

    private Map<String, Object> parse(byte[] bytes) {
        try { return json.readValue(bytes, new TypeReference<>() {}); }
        catch (IOException e) { throw new IllegalArgumentException(com.checkba.service.LangText.of("项目关联文件无法读取", "Failed to read project binding file"), e); }
    }
    private Map<String, Object> map(Object value) { return json.convertValue(value, new TypeReference<>() {}); }
    static String uuid(Object value) {
        String uid = ProjectCatalogService.validUid(value == null ? null : value.toString());
        if (uid == null) throw new IllegalArgumentException(com.checkba.service.LangText.of("无效的会话或文件标识", "Invalid conversation or file identifier"));
        return uid;
    }
    static String safeName(Object value) {
        String name = value == null ? "" : value.toString();
        if (name.isBlank() || name.length() > 180 || name.matches(".*[\\\\/:*?\"<>|\\p{Cntrl}].*")
                || name.equals(".") || name.equals("..")) {
            throw new IllegalArgumentException(com.checkba.service.LangText.of("无效或保留的附件文件名", "Invalid or reserved attachment file name"));
        }
        return name;
    }
    static byte[] decode(Object value) {
        if (!(value instanceof String encoded) || encoded.length() > ((MAX_BYTES + 2) / 3) * 4)
            throw new IllegalArgumentException(com.checkba.service.LangText.of("附件超过 8 MB 限制", "Attachment exceeds the 8 MB limit"));
        byte[] bytes = Base64.getDecoder().decode(encoded);
        if (bytes.length > MAX_BYTES) throw new IllegalArgumentException(com.checkba.service.LangText.of("附件超过 8 MB 限制", "Attachment exceeds the 8 MB limit"));
        return bytes;
    }
    static String sha256(byte[] bytes) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes)); }
        catch (java.security.NoSuchAlgorithmException e) { throw new IllegalStateException(e); }
    }
}
