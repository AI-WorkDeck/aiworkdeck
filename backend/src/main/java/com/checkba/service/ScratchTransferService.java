// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service;

import com.checkba.model.entity.*;
import com.checkba.repository.*;
import com.checkba.service.ai.AgentInboxService;
import com.checkba.service.ai.AgentOrchestrator;
import com.checkba.service.mobile.CloudStorageQuotaService;
import com.checkba.storage.StorageServiceFactory;
import com.checkba.version.WorkSessionService;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.*;
import java.io.*;
import java.security.MessageDigest;
import java.util.*;

/** Copy into a new target folder; originals and their historical references remain intact. */
@Service
@RequiredArgsConstructor
public class ScratchTransferService {
    private final ProjectRepository projects;
    private final ProjectFileRepository files;
    private final ProjectAiMessageRepository messages;
    private final ProjectAiMessageAttachmentRepository attachments;
    private final ProjectFileService fileService;
    private final ProjectMemberService members;
    private final StorageServiceFactory storageFactory;
    private final CloudStorageQuotaService quota;
    private final WorkSessionService workSessions;
    private final AgentInboxService inbox;
    private final AgentOrchestrator orchestrator;
    private final PlatformTransactionManager transactions;

    public record Request(Long sourceProjectId, Long targetProjectId, List<Long> selectedFileIds,
                          List<String> conversationIds) {}
    public record Result(String mode, boolean sourcePreserved, Long sourceProjectId, Long targetProjectId,
                         Long folderId, Map<Long,Long> fileIdMap, Map<String,String> conversationIdMap) {}

    public Result copy(Long userId, Request request) {
        if (userId == null || request == null || request.sourceProjectId() == null || request.targetProjectId() == null
                || request.sourceProjectId().equals(request.targetProjectId())) throw invalid();
        var conversations = new TreeSet<String>();
        if (request.conversationIds() != null) {
            for (String id : request.conversationIds()) {
                if (id == null || id.isBlank() || id.length() > 64) throw invalid();
                conversations.add(id);
            }
        }
        if (conversations.size() > 50 || (request.selectedFileIds() != null && request.selectedFileIds().size() > 500)) throw invalid();
        Result[] result = new Result[1];
        lockConversations(new ArrayList<>(conversations), 0, () -> {
            for (String id : conversations) {
                if (orchestrator.activeRunId(id) != null || inbox.nextPending(id).isPresent())
                    throw new IllegalArgumentException(LangText.of("请等待对话完成后再转存", "Wait for conversations to finish before copying"));
            }
            long first = Math.min(request.sourceProjectId(), request.targetProjectId());
            long second = Math.max(request.sourceProjectId(), request.targetProjectId());
            workSessions.runLocked(first, () -> workSessions.runLocked(second, () ->
                    result[0] = new TransactionTemplate(transactions).execute(status -> copyLocked(userId, request, conversations))));
        });
        return result[0];
    }

    private void lockConversations(List<String> ids, int at, Runnable action) {
        if (at == ids.size()) { action.run(); return; }
        synchronized (inbox.conversationLock(ids.get(at))) { lockConversations(ids, at + 1, action); }
    }

    private Result copyLocked(Long user, Request request, Set<String> conversationIds) {
        Project source = projects.findById(request.sourceProjectId()).orElseThrow(ScratchTransferService::invalid);
        Project target = projects.findById(request.targetProjectId()).orElseThrow(ScratchTransferService::invalid);
        if (!source.isScratchWorkspace() || !user.equals(source.getUserId()) || !user.equals(target.getUserId())
                || target.isScratchWorkspace() || target.isLooseFileWorkspace()
                || !members.hasWritePermission(source.getId(), user) || !members.hasWritePermission(target.getId(), user)) throw invalid();
        quota.lockProjectForWrite(target.getId());
        Map<Long,ProjectFile> sourceFiles = new LinkedHashMap<>();
        for (ProjectFile file : files.findByProjectIdAndIsDeletedFalseOrderBySortOrderAsc(source.getId())) sourceFiles.put(file.getId(), file);
        Set<Long> selected = new LinkedHashSet<>();
        if (request.selectedFileIds() != null) for (Long id : request.selectedFileIds()) include(id, sourceFiles, selected);
        Map<String,List<ProjectAiMessage>> histories = new LinkedHashMap<>();
        Map<Long,List<ProjectAiMessageAttachment>> attached = new HashMap<>();
        for (String id : conversationIds) {
            var rows = messages.findByConversationIdOrderByCreatedAtAsc(id);
            if (rows.isEmpty() || rows.stream().anyMatch(m -> !source.getId().equals(m.getProjectId()) || !user.equals(m.getUserId()))) throw invalid();
            histories.put(id, rows);
            for (var row : rows) {
                for (String text : Arrays.asList(row.getContent(), row.getDisplayContent())) {
                    if (text == null) continue;
                    var references = FILE_REFERENCE.matcher(text);
                    while (references.find()) {
                        try { include(Long.valueOf(references.group(2)), sourceFiles, selected); }
                        catch (NumberFormatException invalid) { throw invalid(); }
                    }
                }
            }
            for (var attachment : attachments.findByMessageIdInOrderByIdAsc(rows.stream().map(ProjectAiMessage::getId).toList())) {
                Long fileId;
                try { fileId = Long.valueOf(attachment.getFileId()); }
                catch (Exception unsupported) { throw new IllegalArgumentException(LangText.of("此对话含无法转存的临时附件，请先将附件保存为项目文件", "Save temporary attachments as project files before copying this conversation")); }
                include(fileId, sourceFiles, selected);
                attached.computeIfAbsent(attachment.getMessageId(), ignored -> new ArrayList<>()).add(attachment);
            }
        }
        if (selected.isEmpty() && histories.isEmpty()) throw invalid();
        // Preserve ancestor folders when files from different subfolders share a name.
        for (Long id : new ArrayList<>(selected)) {
            Set<Long> seen = new HashSet<>();
            ProjectFile current = sourceFiles.get(id);
            while (current != null && current.getParentId() != null) {
                if (!seen.add(current.getId())) throw invalid();
                current = sourceFiles.get(current.getParentId());
                if (current == null || !Boolean.TRUE.equals(current.getIsFolder())) throw invalid();
                selected.add(current.getId());
                if (selected.size() > 500) throw invalid();
            }
        }
        var storage = storageFactory.getStorageService();
        List<String> newPaths = new ArrayList<>();
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override public void afterCompletion(int status) {
                if (status == STATUS_COMMITTED) return;
                for (int i = newPaths.size() - 1; i >= 0; i--) {
                    try { storage.delete(newPaths.get(i)); }
                    catch (Exception e) { org.slf4j.LoggerFactory.getLogger(ScratchTransferService.class).error("Scratch copy rollback cleanup failed: {}", newPaths.get(i), e); }
                }
            }
        });
        Map<Long,Long> fileMap = new LinkedHashMap<>();
        Long folderId = null;
        String folderPath = null;
        if (!selected.isEmpty()) {
            String folderName = LangText.of("默认工作区转存-", "Default workspace copy-") + UUID.randomUUID();
            folderPath = "projects/" + target.getId() + "/" + folderName;
            if (storage.exists(folderPath)) throw invalid();
            newPaths.add(folderPath);
            folderId = fileService.createFolder(target.getId(), null, folderName, user).getId();
            for (Long id : selected) copyFile(id, sourceFiles, selected, fileMap, target.getId(), folderId, folderPath, user, newPaths);
        }
        Map<String,String> conversationMap = new LinkedHashMap<>();
        for (var history : histories.entrySet()) {
            String newId = "conv-" + UUID.randomUUID();
            conversationMap.put(history.getKey(), newId);
            for (ProjectAiMessage message : history.getValue()) {
                ProjectAiMessage copied = new ProjectAiMessage();
                copied.setProjectId(target.getId()); copied.setUserId(user); copied.setConversationId(newId);
                copied.setRole(message.getRole()); copied.setContent(remapReferences(message.getContent(), fileMap));
                copied.setDisplayContent(remapReferences(message.getDisplayContent(), fileMap)); copied.setReasoning(message.getReasoning());
                copied.setConversationTitle(message.getConversationTitle()); copied.setConversationScope(message.getConversationScope());
                copied.setCreatedAt(message.getCreatedAt());
                ProjectAiMessage saved = messages.save(copied);
                for (var attachment : attached.getOrDefault(message.getId(), List.of())) {
                    var clone = new ProjectAiMessageAttachment();
                    clone.setMessageId(saved.getId()); clone.setFileId(fileMap.get(Long.valueOf(attachment.getFileId())).toString());
                    clone.setName(attachment.getName()); clone.setKind(attachment.getKind()); clone.setFileType(attachment.getFileType());
                    clone.setVisionUsed(attachment.getVisionUsed()); clone.setCreatedAt(attachment.getCreatedAt());
                    attachments.save(clone);
                }
            }
        }
        quota.requireCurrentProjectUsage(target.getId());
        return new Result("copy", true, source.getId(), target.getId(), folderId, fileMap, conversationMap);
    }

    private void include(Long id, Map<Long,ProjectFile> files, Set<Long> selected) {
        ProjectFile file = files.get(id);
        if (file == null || file.getName() == null || file.getName().contains("/") || file.getName().contains("\\")
                || file.getName().equals(".") || file.getName().equals("..")) throw invalid();
        if (!selected.add(id)) return;
        if (selected.size() > 500) throw invalid();
        if (Boolean.TRUE.equals(file.getIsFolder()))
            for (var child : files.values()) if (id.equals(child.getParentId())) include(child.getId(), files, selected);
    }

    private void copyFile(Long id, Map<Long,ProjectFile> source, Set<Long> selected, Map<Long,Long> copied,
                          Long target, Long root, String rootPath, Long user, List<String> newPaths) {
        if (copied.containsKey(id)) return;
        ProjectFile file = source.get(id);
        Long parent = root;
        String parentPath = rootPath;
        if (file.getParentId() != null && selected.contains(file.getParentId())) {
            copyFile(file.getParentId(), source, selected, copied, target, root, rootPath, user, newPaths);
            parent = copied.get(file.getParentId());
            parentPath = pathFor(file.getParentId(), source, selected, rootPath);
        }
        String path = parentPath + "/" + file.getName();
        var storage = storageFactory.getStorageService();
        if (storage.exists(path)) throw invalid();
        if (Boolean.TRUE.equals(file.getIsFolder())) {
            newPaths.add(path);
            copied.put(id, fileService.createFolder(target, parent, file.getName(), user).getId());
        } else {
            try {
                long size = storage.getSize(file.getFilePath());
                quota.requireProjectCapacity(target, size);
                String staging = rootPath + "/.copy-" + UUID.randomUUID() + ".tmp";
                newPaths.add(staging);
                MessageDigest original = MessageDigest.getInstance("SHA-256");
                try (InputStream input = new java.security.DigestInputStream(storage.load(file.getFilePath()).getInputStream(), original)) {
                    storage.save(staging, input);
                }
                MessageDigest stored = MessageDigest.getInstance("SHA-256");
                try (InputStream input = new java.security.DigestInputStream(storage.load(staging).getInputStream(), stored)) { input.transferTo(OutputStream.nullOutputStream()); }
                if (storage.getSize(staging) != size || !Arrays.equals(original.digest(), stored.digest())) throw new IOException("Copy verification failed");
                storage.moveNew(staging, path);
                newPaths.add(path);
                ProjectFile newFile = new ProjectFile();
                newFile.setProjectId(target); newFile.setParentId(parent); newFile.setUserId(user);
                newFile.setName(file.getName()); newFile.setFileType(file.getFileType()); newFile.setFileSize(size);
                newFile.setFilePath(path); newFile.setUid(UUID.randomUUID().toString());
                newFile.setIsFolder(false); newFile.setSortOrder(file.getSortOrder());
                newFile.setCreatedAt(java.time.LocalDateTime.now()); newFile.setUpdatedAt(newFile.getCreatedAt());
                copied.put(id, files.save(newFile).getId());
            } catch (Exception e) { throw new IllegalStateException(LangText.of("转存失败，原件仍保留", "Copy failed; originals are preserved"), e); }
        }
    }

    private String pathFor(Long id, Map<Long,ProjectFile> files, Set<Long> selected, String root) {
        ProjectFile file = files.get(id);
        return (file.getParentId() != null && selected.contains(file.getParentId()) ? pathFor(file.getParentId(), files, selected, root) : root) + "/" + file.getName();
    }
    private static final java.util.regex.Pattern FILE_REFERENCE = java.util.regex.Pattern.compile(
            "(/api/files/|\"fileId\"\\s*:\\s*\"?)([0-9]+)(?=[/\",}\\s]|$)");

    private static String remapReferences(String text, Map<Long,Long> files) {
        if (text == null) return null;
        // Rewrite only structured file references; ordinary numbers in historic prose stay intact.
        var matcher = FILE_REFERENCE.matcher(text);
        StringBuffer result = new StringBuffer();
        while (matcher.find()) {
            Long replacement;
            try { replacement = files.get(Long.valueOf(matcher.group(2))); }
            catch (NumberFormatException invalid) { replacement = null; }
            matcher.appendReplacement(result, java.util.regex.Matcher.quoteReplacement(
                    replacement == null ? matcher.group() : matcher.group(1) + replacement));
        }
        matcher.appendTail(result);
        return result.toString();
    }
    private static IllegalArgumentException invalid() {
        return new IllegalArgumentException(LangText.of("无法转存所选内容，请核对默认工作区、目标项目及权限", "Cannot copy this selection; check the default workspace, target project and permissions"));
    }
}
