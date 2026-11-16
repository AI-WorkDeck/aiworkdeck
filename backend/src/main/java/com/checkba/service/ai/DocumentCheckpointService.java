// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ai;

import com.checkba.model.entity.ProjectFile;
import com.checkba.service.ProjectFileService;
import com.checkba.storage.StorageService;
import com.checkba.storage.StorageServiceFactory;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 文档检查点服务（run 级快照，Cursor/Cline checkpoint 模式的文件级最简实现）。
 *
 * 每轮 Agent 运行在第一个"修改类"文档工具执行前，把目标文件在存储中的当前内容
 * 复制一份到 checkpoints/ 目录；模型把文档改乱且 doc_undo 无法逐步退回时，
 * 可用 doc_restore_checkpoint 恢复到本轮开始前的状态（恢复后编辑器自动重载）。
 *
 * 局限（已在工具描述中告知模型）：快照取自最近一次保存到存储的内容，
 * 编辑器中未保存的改动不在快照里；且 AI 修改本身走修订模式，常规纠错优先 doc_undo。
 */
@Service
@RequiredArgsConstructor
public class DocumentCheckpointService {

    private static final org.slf4j.Logger log = org.slf4j.LoggerFactory.getLogger(DocumentCheckpointService.class);

    private final ProjectFileService projectFileService;
    private final StorageServiceFactory storageServiceFactory;
    private final EditorBridgeService editorBridgeService;
    private final com.fasterxml.jackson.databind.ObjectMapper objectMapper;

    /**
     * conversationId -> (fileId -> 本轮快照信息)。
     *
     * <p>此前 key 只有 conversationId、幂等判据也只看 conversationId 是否已有快照——
     * 同一轮里 doc_open_file 切换活跃文档后（guard.activeFileId 变了），第二个文件的
     * 修改类工具执行前 ensureCheckpoint 直接因为「本会话已有快照」短路跳过，第二个文件
     * 从未被快照过。doc_restore_checkpoint 恢复时用的还是第一个文件的快照：覆盖 A、
     * 对 A 发 reload，却告诉用户「已恢复，本轮所有修改已丢弃」——用户这一轮真正改的是 B，
     * B 的修改一个都没回退，且用户会误以为已经恢复干净。
     * 按 (conversationId, fileId) 存快照才能让同一轮里碰过的每个文件都能被独立恢复。
     */
    private final Map<String, Map<Long, Checkpoint>> checkpoints = new ConcurrentHashMap<>();

    // Registered before prepare is emitted. Removed only after the path that may
    // write storage exits; editor ACKs and run-state cancellation are not proof.
    private record RestoreWrite(String conversationId, Long fileId) {}
    private final Map<String, RestoreWrite> restoreWrites = new ConcurrentHashMap<>();

    public boolean restoreMayWrite(String conversationId, Long fileId, String restoreId) {
        RestoreWrite write = restoreWrites.get(restoreId);
        // An identity mismatch must never be interpreted as permission to unlock.
        if (write != null && (!write.conversationId().equals(conversationId) || !write.fileId().equals(fileId))) {
            throw new IllegalArgumentException("恢复操作归属不匹配");
        }
        return write != null;
    }

    private record Checkpoint(Long fileId, String checkpointKey, long createdAt) {}

    /** 快照最长保留时长：最后一轮会话的检查点在 clearForNewRun 不会被清，靠 TTL 兜底回收。 */
    static final long CHECKPOINT_TTL_MS = 24 * 60 * 60 * 1000L;

    /**
     * 清理过期快照：某 conversationId 下所有快照都已超过 TTL（或已为空）时，
     * 原子移除该会话条目并删除底层存储 blob。返回删除的快照文件数。
     */
    public int cleanupExpiredCheckpoints(long nowMillis) {
        int deleted = 0;
        for (Map.Entry<String, Map<Long, Checkpoint>> entry : checkpoints.entrySet()) {
            String conversationId = entry.getKey();
            Map<Long, Checkpoint> perFile = entry.getValue();
            boolean allExpired = perFile.isEmpty() || perFile.values().stream()
                    .allMatch(cp -> nowMillis - cp.createdAt() >= CHECKPOINT_TTL_MS);
            if (!allExpired) continue;
            // 原子移除：只有真正摘掉条目的线程才负责删 blob，并发调用不会重复删
            Map<Long, Checkpoint> removed = checkpoints.remove(conversationId);
            if (removed == null || removed.isEmpty()) {
                if (removed != null) checkpoints.putIfAbsent(conversationId, removed);
                continue;
            }
            StorageService storage = storageServiceFactory.getStorageService();
            for (Checkpoint cp : removed.values()) {
                try {
                    storage.delete(cp.checkpointKey());
                    deleted++;
                } catch (Exception e) {
                    log.warn("Failed to delete expired document checkpoint blob: conv={}, fileId={}, key={}",
                            conversationId, cp.fileId(), cp.checkpointKey(), e);
                }
            }
        }
        return deleted;
    }

    @org.springframework.scheduling.annotation.Scheduled(fixedDelay = 3600_000L)
    void scheduledCleanup() {
        cleanupExpiredCheckpoints(System.currentTimeMillis());
    }

    /**
     * 为指定文件创建本轮快照（幂等：同一会话同一文件已有快照则跳过；不同文件各自独立）。
     * 任何失败只记日志、不阻断工具执行——快照是保险，不是主流程。
     */
    public void ensureCheckpoint(String conversationId, Long fileId) {
        if (conversationId == null || fileId == null) return;
        Map<Long, Checkpoint> perFile = checkpoints.computeIfAbsent(conversationId, k -> new ConcurrentHashMap<>());
        if (perFile.containsKey(fileId)) return;
        try {
            ProjectFile file = projectFileService.getFile(fileId);
            if (file == null || file.getFilePath() == null) return;
            byte[] bytes = projectFileService.getFileBytes(fileId);
            if (bytes == null || bytes.length == 0) return;

            String checkpointKey = "checkpoints/" + conversationId + "/" + fileId + "_" + System.currentTimeMillis();
            StorageService storage = storageServiceFactory.getStorageService();
            storage.save(checkpointKey, new ByteArrayInputStream(bytes));
            perFile.put(fileId, new Checkpoint(fileId, checkpointKey, System.currentTimeMillis()));
            log.info("Document checkpoint created: conv={}, fileId={}, key={}, size={}",
                    conversationId, fileId, checkpointKey, bytes.length);
        } catch (Exception e) {
            log.warn("Failed to create document checkpoint for conv={}, fileId={}", conversationId, fileId, e);
        }
    }

    /** 一个文件没能恢复的原因。missing=true 表示文件已被删除（没有可写回的位置）。 */
    public record RestoreFailure(Long fileId, String name, String error, boolean missing) {}

    /** 一次恢复的结果：恢复成功的文件名（按快照登记序）与失败清单。 */
    public record RestoreOutcome(java.util.List<String> restored, java.util.List<RestoreFailure> failures) {}

    /** 本会话当前快照覆盖的文件（fileId + 文件名），给「撤销本次 AI 修改」的确认框列清单用。 */
    public java.util.List<Map<String, Object>> describeCheckpoint(String conversationId) {
        Map<Long, Checkpoint> perFile = checkpoints.get(conversationId);
        if (perFile == null || perFile.isEmpty()) return java.util.List.of();
        java.util.List<Map<String, Object>> files = new java.util.ArrayList<>();
        for (Checkpoint cp : perFile.values()) {
            ProjectFile file = projectFileService.getFile(cp.fileId());
            if (file == null) continue;
            files.add(Map.of("fileId", cp.fileId(), "name", file.getName() == null ? "" : file.getName()));
        }
        return files;
    }

    /**
     * 恢复本轮快照：把本轮碰过的<b>全部</b>文件的快照内容写回原存储路径，并逐个通知编辑器重载。
     * 返回给模型的结果描述（多文件时合并成一条，个别文件失败不影响其余文件继续恢复）。
     */
    public String restore(String conversationId) {
        RestoreOutcome outcome = restoreAll(conversationId);
        if (outcome == null) {
            return "Error: 本轮没有可恢复的文档快照（本轮尚未执行过修改类工具，或快照创建失败）。请改用 doc_undo 逐步撤销。";
        }
        java.util.List<String> failures = outcome.failures().stream()
                .map(f -> f.missing() ? "文件 " + f.fileId() + " 已不存在"
                        : "文件 " + f.fileId() + " 恢复失败：" + f.error())
                .toList();
        if (outcome.restored().isEmpty()) {
            return "Error: 快照恢复失败：" + String.join("；", failures);
        }
        String names = outcome.restored().stream()
                .map(n -> "《" + n + "》")
                .collect(java.util.stream.Collectors.joining("、"));
        String failureSuffix = failures.isEmpty() ? "" : "（另有恢复失败：" + String.join("；", failures) + "）";
        return String.format("已将%s恢复到本轮开始前的快照，编辑器已完成重新加载。这些文件的本轮修改（含修订）已丢弃，请重新规划后再操作。%s",
                names, failureSuffix);
    }

    /** 同一会话同时只允许一次用户发起的撤销（双击、两个窗口）。 */
    private final java.util.Set<String> userRestores = ConcurrentHashMap.newKeySet();

    /** 用户发起撤销时的三种拒绝/结果。 */
    public enum UserRestoreStatus { NO_CHECKPOINT, IN_PROGRESS, DONE }

    public record UserRestoreResult(UserRestoreStatus status, RestoreOutcome outcome) {}

    /**
     * 用户点「撤销本次 AI 修改」：与 doc_restore_checkpoint 同一条恢复路径（prepare → 写回 → reload），
     * 只是由用户直接发起，不经模型的确认闸。编辑器指令按 conversationId 寻址，控制器线程上没有
     * 编排器设的 ThreadLocal，这里自己设、用完清掉。
     *
     * <p>全部文件恢复成功后清掉本会话快照：再点一次会把此后的手动修改也一并抹掉，
     * 那不是用户想要的「撤销」。有失败时保留，便于重试失败的那几份。
     */
    public UserRestoreResult restoreForUser(String conversationId) {
        if (!hasCheckpoint(conversationId)) return new UserRestoreResult(UserRestoreStatus.NO_CHECKPOINT, null);
        if (!userRestores.add(conversationId)) return new UserRestoreResult(UserRestoreStatus.IN_PROGRESS, null);
        String previous = editorBridgeService.getCurrentConversationId();
        try {
            editorBridgeService.setCurrentConversationId(conversationId);
            RestoreOutcome outcome = restoreAll(conversationId);
            if (outcome == null) return new UserRestoreResult(UserRestoreStatus.NO_CHECKPOINT, null);
            if (outcome.failures().isEmpty()) clearForNewRun(conversationId);
            return new UserRestoreResult(UserRestoreStatus.DONE, outcome);
        } finally {
            if (previous == null) editorBridgeService.clearCurrentConversationId();
            else editorBridgeService.setCurrentConversationId(previous);
            userRestores.remove(conversationId);
        }
    }

    /** 恢复全部快照文件；本会话没有快照时返回 null。 */
    RestoreOutcome restoreAll(String conversationId) {
        Map<Long, Checkpoint> perFile = checkpoints.get(conversationId);
        if (perFile == null || perFile.isEmpty()) {
            return null;
        }
        StorageService storage = storageServiceFactory.getStorageService();
        java.util.List<String> restoredNames = new java.util.ArrayList<>();
        java.util.List<RestoreFailure> failures = new java.util.ArrayList<>();
        for (Checkpoint cp : perFile.values()) {
            String restoreId = java.util.UUID.randomUUID().toString();
            boolean needsAbort = false;
            String name = null;
            try {
                ProjectFile file = projectFileService.getFile(cp.fileId());
                if (file == null || file.getFilePath() == null) {
                    failures.add(new RestoreFailure(cp.fileId(), null, null, true));
                    continue;
                }
                name = file.getName();
                // Pause autosave and drain uploads before changing authoritative bytes.
                // A later reload alone cannot undo an old upload racing this write.
                needsAbort = true; // also abort a prepare whose acknowledgement timed out
                restoreWrites.put(restoreId, new RestoreWrite(conversationId, cp.fileId()));
                try {
                    checkpointAction(cp.fileId(), restoreId, "prepare");
                    try (InputStream in = storage.load(cp.checkpointKey()).getInputStream()) {
                        storage.save(file.getFilePath(), in);
                    }
                } finally {
                    restoreWrites.remove(restoreId);
                }
                // Unlike ordinary fire-and-forget reloads, success means the active
                // model has actually loaded the checkpoint and can safely be read.
                checkpointAction(cp.fileId(), restoreId, "reload");
                needsAbort = false;
                restoredNames.add(file.getName());
                log.info("Document checkpoint restored: conv={}, fileId={}, key={}",
                        conversationId, cp.fileId(), cp.checkpointKey());
            } catch (Exception e) {
                log.error("Failed to restore document checkpoint for conv={}, fileId={}", conversationId, cp.fileId(), e);
                failures.add(new RestoreFailure(cp.fileId(), name, e.getMessage(), false));
            } finally {
                if (needsAbort) {
                    try { checkpointAction(cp.fileId(), restoreId, "abort"); }
                    catch (Exception e) { log.warn("Checkpoint editor remains blocked after failed restore: fileId={}", cp.fileId()); }
                }
            }
        }
        return new RestoreOutcome(restoredNames, failures);
    }

    private void checkpointAction(Long fileId, String restoreId, String phase) throws Exception {
        String result = editorBridgeService.executeEditorCommand("doc_checkpoint_restore",
                Map.of("fileId", fileId, "restoreId", restoreId, "phase", phase));
        var response = result == null ? null : objectMapper.readTree(result);
        if (response == null || !response.path("success").asBoolean(false)) {
            throw new IllegalStateException(response == null
                    ? com.checkba.service.LangText.of("编辑器没有确认恢复阶段 ", "The editor did not confirm restore phase ") + phase
                    : response.path("error").asText(com.checkba.service.LangText.of("编辑器没有完成恢复阶段 ",
                            "The editor did not complete restore phase ") + phase));
        }
    }

    /**
     * 新的一轮开始时清除上一轮快照（每轮一个独立检查点，语义不变：按 conversationId 整体清空）。
     *
     * <p>此前只摘掉内存里的登记条目，存储里的 blob 从来没人删过——checkpoints/ 前缀下的对象
     * 只增不减，每一轮至少一次修改类文档工具调用就留一条永久占用（审计条目：Document checkpoint
     * blobs are written to storage but never deleted）。这里连同 blob 一起删是安全的：
     * {@link #restore} 只能恢复"当前还在内存 map 里"的快照，一旦这里把某个 conversationId
     * 的条目摘掉，对应 blob 已经彻底不可达——没有任何代码路径还能把它读回来，不是「提前删了
     * 还有用的东西」，是删一个已经没用的东西。删除失败只记日志：这是清理动作，
     * 不能因为存储抖动挡住新一轮的正常执行。
     */
    public void clearForNewRun(String conversationId) {
        Map<Long, Checkpoint> perFile = checkpoints.remove(conversationId);
        if (perFile == null || perFile.isEmpty()) {
            return;
        }
        StorageService storage = storageServiceFactory.getStorageService();
        for (Checkpoint cp : perFile.values()) {
            try {
                storage.delete(cp.checkpointKey());
            } catch (Exception e) {
                log.warn("Failed to delete stale document checkpoint blob: conv={}, fileId={}, key={}",
                        conversationId, cp.fileId(), cp.checkpointKey(), e);
            }
        }
    }

    public boolean hasCheckpoint(String conversationId) {
        Map<Long, Checkpoint> perFile = checkpoints.get(conversationId);
        return perFile != null && !perFile.isEmpty();
    }
}
