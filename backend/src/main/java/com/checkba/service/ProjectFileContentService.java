// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service;

import com.checkba.model.entity.ProjectFile;
import com.checkba.repository.ProjectFileRepository;
import com.checkba.service.mobile.CloudStorageQuotaService;
import com.checkba.storage.ProjectStorageResolver;
import com.checkba.storage.StorageException;
import com.checkba.storage.StorageService;
import com.checkba.storage.StorageServiceFactory;
import com.checkba.version.WorkSessionService;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.util.StringUtils;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.time.LocalDateTime;
import java.util.Objects;
import java.util.function.Consumer;
import java.util.function.UnaryOperator;

/**
 * Coordinates HTTP content uploads and text_* writes with version snapshots. JPA remains authoritative.
 * Structural operations, watcher reconciliation and other internal writers are not covered by this entry.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class ProjectFileContentService {
    private final ProjectFileRepository files;
    private final StorageServiceFactory storageFactory;
    private final ProjectMemberService members;
    private final ProjectFileAccessService access;
    private final ProjectStorageResolver storageResolver;
    private final WorkSessionService sessions;
    private final PlatformTransactionManager transactionManager;
    private final CloudStorageQuotaService quota;
    @PersistenceContext private EntityManager entityManager;
    @Value("${storage.subscription-quota.enabled:false}") private boolean subscriptionQuotaEnabled;

    public record UploadResult(ProjectFile file, String path, boolean complete, boolean postProcess) {}
    public record TextResult(ProjectFile file, String before, String after, boolean changed) {}

    public static class ContentWriteException extends RuntimeException {
        private final int status;
        private final String reason;
        public ContentWriteException(int status, String reason, String message) {
            super(message); this.status = status; this.reason = reason;
        }
        public int status() { return status; }
        public String reason() { return reason; }
    }

    /** Receive each complete HTTP request outside the repository lock and outside a DB transaction. */
    public UploadResult upload(long fileId, long projectId, Long actor, InputStream input, long incoming,
                               Long offset, boolean mustExist, String totalSize) throws IOException {
        requireNoTransaction();
        if (subscriptionQuotaEnabled && incoming < 0) throw new IllegalArgumentException("Cloud uploads require Content-Length");
        Path staged = Files.createTempFile("awd-content-upload-", ".tmp");
        try {
            Files.copy(input, staged, StandardCopyOption.REPLACE_EXISTING);
            return withContentLock(projectId, () -> {
                UploadResult result;
                if (subscriptionQuotaEnabled) {
                    // Same order as project deletion: repo -> transaction -> quota owner. The owner
                    // lock survives the local publication and the strict quota metadata update.
                    result = transaction().execute(status -> {
                        freshContext();
                        ProjectFile file = uploadTarget(fileId, projectId, actor, offset, mustExist);
                        Long checkedOwner = entityManager.find(com.checkba.model.entity.Project.class, projectId).getUserId();
                        quota.requireFileCapacity(file, incoming, offset != null && offset > 0);
                        // Quota may wait for its owner row or balance lookup. Its refresh(file) does
                        // not refresh cached project/member/user ACLs. Keep the checked file identity,
                        // clear the read context (DB locks remain), then authorize the actual target.
                        String checkedPath = file.getFilePath();
                        Long checkedSize = file.getFileSize();
                        freshContext();
                        file = uploadTarget(fileId, projectId, actor, offset, mustExist);
                        Long currentOwner = entityManager.find(com.checkba.model.entity.Project.class, projectId).getUserId();
                        if (!Objects.equals(checkedOwner, currentOwner)
                                || !Objects.equals(checkedPath, file.getFilePath())
                                || !Objects.equals(checkedSize, file.getFileSize())) {
                            throw new ContentWriteException(400, "WRITE_CONTEXT_CHANGED", LangText.of(
                                    "文件或项目状态已变化，请重试保存", "The file or project changed; please retry saving"));
                        }
                        String path = uploadPath(file);
                        UploadResult published = publishUpload(file, path, staged, offset, totalSize);
                        int count = files.updateContentMetadataIfCurrent(fileId, projectId, path,
                                storage().getSize(path), null);
                        if (count != 1) throw new IllegalStateException("Uploaded bytes could not be recorded for quota accounting");
                        return published;
                    });
                } else {
                    ProjectFile file = transaction().execute(status -> {
                        freshContext();
                        ProjectFile current = uploadTarget(fileId, projectId, actor, offset, mustExist);
                        uploadPath(current);
                        return current;
                    });
                    result = publishUpload(file, file.getFilePath(), staged, offset, totalSize);
                }
                if (result.complete()) {
                    Long size = null;
                    try { long measured = storage().getSize(result.path()); if (measured > 0) size = measured; }
                    catch (Exception ignored) { /* Preserve upload's existing best-effort size refresh. */ }
                    touch(result.file(), result.path(), size);
                }
                return result;
            });
        } finally {
            try { Files.deleteIfExists(staged); }
            catch (Exception e) { log.warn("未能清理上传暂存文件: {}", staged, e); }
        }
    }

    /** The fresh read, pure transformation and publication share the snapshot lock. Null means no change. */
    public TextResult mutateText(long fileId, long projectId, Long actor, Consumer<ProjectFile> validate,
                                 boolean readExisting, UnaryOperator<String> transform, long maximumBytes) {
        requireNoTransaction();
        return withContentLock(projectId, () -> {
            ProjectFile file = transaction().execute(status -> {
                freshContext();
                ProjectFile current = authorizedFile(fileId, projectId, actor);
                validate.accept(current);
                return current;
            });
            if (!StringUtils.hasText(file.getFilePath())) throw new IllegalStateException("文件没有存储路径: " + fileId);
            String before = "";
            if (readExisting) {
                try (InputStream in = storage().load(file.getFilePath()).getInputStream()) {
                    byte[] bytes = in.readNBytes(Math.toIntExact(maximumBytes + 1));
                    if (bytes.length > maximumBytes) throw new IllegalStateException("文件过大，拒绝整篇改写。");
                    before = new String(bytes, StandardCharsets.UTF_8);
                } catch (IOException e) { throw new StorageException("读取文本失败", e); }
            }
            String after = transform.apply(before);
            if (after == null) return new TextResult(file, before, before, false);
            byte[] bytes = after.getBytes(StandardCharsets.UTF_8);
            if (bytes.length > maximumBytes) throw new IllegalStateException("内容过大，拒绝写入。");
            storage().save(file.getFilePath(), new ByteArrayInputStream(bytes));
            touch(file, file.getFilePath(), (long) bytes.length);
            return new TextResult(file, before, after, true);
        });
    }

    private ProjectFile uploadTarget(long id, long projectId, Long actor, Long offset, boolean mustExist) {
        ProjectFile file = authorizedFile(id, projectId, actor);
        Long total = files.sumSizeByProjectId(projectId);
        if (storageResolver.exceedsProjectSizeLimit(projectId, total, 0L)) {
            throw new ContentWriteException(400, null, storageResolver.projectSizeLimitMessage());
        }
        if (mustExist && (offset == null || offset == 0)
                && (Boolean.TRUE.equals(file.getIsDeleted())
                || (StringUtils.hasText(file.getFilePath()) && !storage().exists(file.getFilePath())))) {
            throw new ContentWriteException(409, "FILE_MOVED", LangText.of(
                    "文件已被移动、改名或删除，本次改动尚未保存",
                    "The file was moved, renamed or deleted; your changes have not been saved"));
        }
        return file;
    }

    private ProjectFile authorizedFile(long id, long projectId, Long actor) {
        ProjectFile file = files.findById(id).orElseThrow(() -> new ContentWriteException(
                404, null, LangText.of("文件不存在", "File not found")));
        if (!Objects.equals(file.getProjectId(), projectId) || actor == null
                || !members.hasWritePermission(projectId, actor) || access.isClient(projectId, actor)) {
            throw new ContentWriteException(403, null, LangText.of("无权上传到该文件", "You do not have permission to upload to this file"));
        }
        return file;
    }

    private UploadResult publishUpload(ProjectFile file, String path, Path staged, Long offset, String totalSize) {
        String saved;
        try (InputStream input = Files.newInputStream(staged)) {
            saved = offset != null && offset > 0 ? storage().append(path, input) : storage().save(path, input);
        } catch (IOException e) { throw new StorageException("读取上传临时文件失败", e); }
        boolean complete = true;
        boolean postProcess = offset == null || offset == 0;
        if (StringUtils.hasText(totalSize)) {
            complete = false;
            try { complete = storage().getSize(saved) >= Long.parseLong(totalSize); }
            catch (Exception e) { log.warn("Failed to check upload completion", e); }
            postProcess = complete;
        }
        return new UploadResult(file, saved, complete, postProcess);
    }

    /** The disk write has already succeeded: optional metadata failure must not turn it into a failed save. */
    private void touch(ProjectFile file, String path, Long size) {
        try {
            Integer count = transaction().execute(status -> {
                freshContext();
                return files.updateContentMetadataIfCurrent(file.getId(), file.getProjectId(), path, size, LocalDateTime.now());
            });
            if (!Integer.valueOf(1).equals(count)) {
                log.warn("内容已发布，但文件位置/状态已改变，未覆盖元数据: fileId={}", file.getId());
            }
        } catch (Exception e) { log.warn("内容已发布，回写文件元数据失败: fileId={}", file.getId(), e); }
    }

    private String uploadPath(ProjectFile file) {
        if (StringUtils.hasText(file.getFilePath())) return file.getFilePath();
        String name = StringUtils.hasText(file.getName()) ? file.getName() : String.valueOf(file.getId());
        if (file.getFileType() != null && !name.endsWith("." + file.getFileType())) name += "." + file.getFileType();
        StringBuilder parentPath = new StringBuilder();
        ProjectFile current = file;
        int depth = 0;
        while (current.getParentId() != null && depth++ < 20) {
            current = files.findById(current.getParentId()).orElse(null);
            if (current == null) break;
            if (!parentPath.isEmpty()) parentPath.insert(0, "/");
            parentPath.insert(0, current.getName());
        }
        String path = "projects/" + file.getProjectId() + "/" + (parentPath.isEmpty() ? "" : parentPath + "/") + name;
        file.setFilePath(path);
        files.save(file);
        return path;
    }

    private void freshContext() {
        // Only entered in our own transaction, after rejecting callers with pending writes. An OSIV
        // context may still contain the upload preflight's file, owner, global role and membership.
        entityManager.clear();
    }
    private TransactionTemplate transaction() { return new TransactionTemplate(transactionManager); }
    private StorageService storage() { return storageFactory.getStorageService(); }
    private <T> T withContentLock(long projectId, java.util.function.Supplier<T> body) {
        boolean[] entered = {false};
        try {
            return sessions.withFileContentWriteLock(projectId, () -> { entered[0] = true; return body.get(); });
        } catch (com.checkba.version.VersionException e) {
            if (!entered[0] && "VERSION_BUSY".equals(e.getKind())) {
                throw new ContentWriteException(423, "VERSION_BUSY", e.getMessage());
            }
            if (!entered[0] && e.isUserFacing() && e.getKind() == null) {
                throw new ContentWriteException(404, "FILE_MOVED", e.getMessage());
            }
            throw e;
        }
    }
    private void requireNoTransaction() {
        if (TransactionSynchronizationManager.isActualTransactionActive()) {
            throw new IllegalStateException("Content writes cannot enter with an active database transaction");
        }
    }
}
