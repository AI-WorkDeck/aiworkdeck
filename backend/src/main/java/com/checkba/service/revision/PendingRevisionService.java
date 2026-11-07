// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.revision;

import com.checkba.model.entity.PendingRevision;
import com.checkba.model.entity.ProjectFile;
import com.checkba.repository.PendingRevisionRepository;
import com.checkba.repository.ProjectFileRepository;
import com.checkba.service.LangText;
import com.checkba.service.ProjectMemberService;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 待审修订（docs/plans/agent-app-control.md C7）：外部 Agent 只能提案，接受时才以修订模式写入编辑器。
 * 权限一律按项目写权限（hasWritePermission，已排除 CLIENT）。
 */
@Service
@Slf4j
public class PendingRevisionService {

    public static final int MAX_EDITS = 50;
    public static final int MAX_FIND_CHARS = 2_000;
    public static final int MAX_REPLACE_CHARS = 20_000;
    public static final int MAX_REASON_CHARS = 500;
    public static final int MAX_PENDING_PER_FILE = 20;

    /** 提案校验失败 / 权限不足：message 原样回给调用方。 */
    public static class RevisionException extends IllegalArgumentException {
        public RevisionException(String message) { super(message); }
    }

    /** 基线版本已变：提案已标 STALE，不套用。 */
    public static class StaleRevisionException extends RevisionException {
        public StaleRevisionException(String message) { super(message); }
    }

    public record Edit(String find, String replace, String reason) {}

    private static final TypeReference<List<Edit>> EDIT_LIST = new TypeReference<>() {};

    private final PendingRevisionRepository repository;
    private final ProjectFileRepository fileRepository;
    private final ProjectMemberService members;
    private final ObjectMapper objectMapper;

    public PendingRevisionService(PendingRevisionRepository repository, ProjectFileRepository fileRepository,
                                  ProjectMemberService members,
                                  ObjectMapper objectMapper) {
        this.repository = repository;
        this.fileRepository = fileRepository;
        this.members = members;
        this.objectMapper = objectMapper;
    }

    /** 文件版本令牌：最近更新时间（毫秒）+ 字节数；任何一次保存都会改变它。 */
    public static String fileVersion(ProjectFile f) {
        long ts = f.getUpdatedAt() == null ? 0L
                : f.getUpdatedAt().atZone(ZoneId.systemDefault()).toInstant().toEpochMilli();
        return ts + "-" + (f.getFileSize() == null ? 0L : f.getFileSize());
    }

    /** 编辑器逐条修订只支持 Word 文档（docx/doc）。 */
    public static boolean isWordDocument(ProjectFile f) {
        String n = f.getName() == null ? "" : f.getName().toLowerCase();
        return n.endsWith(".docx") || n.endsWith(".doc");
    }

    public PendingRevision propose(Long userId, Long fileId, String baseVersion, List<Edit> edits, String source) {
        ProjectFile file = fileRepository.findById(fileId)
                .filter(f -> !Boolean.TRUE.equals(f.getIsDeleted()) && !Boolean.TRUE.equals(f.getIsFolder()))
                .orElse(null);
        // 无权与不存在同一句：不透露别的项目里有哪些文件
        if (file == null || file.getProjectId() == null || !members.hasWritePermission(file.getProjectId(), userId)) {
            throw new RevisionException(LangText.of("文件不存在或无写权限：", "File not found or no write access: ") + fileId);
        }
        if (!isWordDocument(file)) {
            throw new RevisionException(LangText.of(
                    "暂只支持对 Word 文档（.docx/.doc）提交修订提案：", "Revision proposals currently support Word documents (.docx/.doc) only: ")
                    + file.getName());
        }
        if (baseVersion == null || baseVersion.isBlank() || baseVersion.length() > 64) {
            throw new RevisionException(LangText.of("缺少 baseVersion（先 read_file 取 version）", "Missing baseVersion (call read_file and use its version)"));
        }
        String current = fileVersion(file);
        if (!current.equals(baseVersion.trim())) {
            throw new RevisionException(LangText.of(
                    "baseVersion 与文件当前版本不一致（当前 " + current + "）：文件已被修改，请重新 read_file 后基于最新内容再提交",
                    "baseVersion does not match the file's current version (" + current + "): the file changed; call read_file again and propose against the latest content"));
        }
        validate(edits);
        if (repository.countByFileId(fileId) >= MAX_PENDING_PER_FILE) {
            throw new RevisionException(LangText.of("该文件待审提案已达上限，请先在 AI WorkDeck 中处理",
                    "Too many pending proposals for this file; review them in AI WorkDeck first"));
        }
        PendingRevision r = new PendingRevision();
        r.setFileId(fileId);
        r.setProjectId(file.getProjectId());
        r.setBaseVersion(baseVersion.trim());
        r.setSource(source == null || source.isBlank() ? "mcp" : source);
        r.setStatus(PendingRevision.PENDING);
        r.setCreatedAt(LocalDateTime.now());
        r.setCreatedBy(userId);
        try {
            r.setEditsJson(objectMapper.writeValueAsString(edits));
        } catch (JsonProcessingException e) {
            throw new RevisionException(LangText.of("修订内容无法序列化", "Edits could not be serialized"));
        }
        return repository.save(r);
    }

    static void validate(List<Edit> edits) {
        if (edits == null || edits.isEmpty()) {
            throw new RevisionException(LangText.of("edits 不能为空", "edits must not be empty"));
        }
        if (edits.size() > MAX_EDITS) {
            throw new RevisionException(LangText.of("edits 最多 ", "At most edits allowed: ") + MAX_EDITS);
        }
        for (int i = 0; i < edits.size(); i++) {
            Edit e = edits.get(i);
            String at = " (edits[" + i + "])";
            if (e == null || e.find() == null || e.find().isEmpty()) {
                throw new RevisionException(LangText.of("find 不能为空", "find must not be empty") + at);
            }
            if (e.replace() == null) {
                throw new RevisionException(LangText.of("缺少 replace（删除请传空字符串）", "Missing replace (use an empty string to delete)") + at);
            }
            if (e.find().length() > MAX_FIND_CHARS || e.replace().length() > MAX_REPLACE_CHARS
                    || (e.reason() != null && e.reason().length() > MAX_REASON_CHARS)) {
                throw new RevisionException(LangText.of("find/replace/reason 超过长度上限", "find/replace/reason exceeds the length limit") + at);
            }
            if (e.find().equals(e.replace())) {
                throw new RevisionException(LangText.of("find 与 replace 相同", "find and replace are identical") + at);
            }
        }
    }

    public List<Map<String, Object>> listByProject(Long userId, Long projectId) {
        requireWrite(projectId, userId);
        return view(repository.findByProjectIdOrderByCreatedAtAsc(projectId));
    }

    public List<Map<String, Object>> listByFile(Long userId, Long fileId) {
        ProjectFile file = fileRepository.findById(fileId).orElse(null);
        if (file == null) throw new RevisionException(LangText.of("文件不存在", "File not found"));
        requireWrite(file.getProjectId(), userId);
        return view(repository.findByFileIdOrderByCreatedAtAsc(fileId));
    }

    /** 拒绝即删除。 */
    public void reject(Long userId, Long id) {
        PendingRevision r = load(id, userId);
        repository.delete(r);
    }

    /**
     * 接受第一步：校验权限与基线。基线一致 → 返回要套用的 edits（由前端经本地编辑器执行器以修订模式落入文档，
     * 不依赖任何 AI 对话/SSE 会话）；基线已变 → 标 STALE 并抛 {@link StaleRevisionException}
     * （记录保留，用户仍可查看/拒绝）。记录在 {@link #markApplied} 之前不删除。
     */
    public Map<String, Object> accept(Long userId, Long id) {
        PendingRevision r = load(id, userId);
        ProjectFile file = fileRepository.findById(r.getFileId())
                .filter(f -> !Boolean.TRUE.equals(f.getIsDeleted())).orElse(null);
        if (file == null) {
            repository.delete(r);
            throw new RevisionException(LangText.of("文件已不存在，提案已移除", "The file no longer exists; the proposal was removed"));
        }
        // 已部分套用：文档已被这条提案自己改过，基线必然不同；此时由前端对剩余 edits 逐条预检兜底
        boolean resuming = r.getAppliedCount() > 0 && PendingRevision.PENDING.equals(r.getStatus());
        if (PendingRevision.STALE.equals(r.getStatus()) || (!resuming && !fileVersion(file).equals(r.getBaseVersion()))) {
            r.setStatus(PendingRevision.STALE);
            repository.save(r);
            throw new StaleRevisionException(LangText.of(
                    "文档在提案之后已被修改，提案已过期、未套用（仍可查看或拒绝）",
                    "The document changed after this proposal; it is stale and was not applied (you can still view or reject it)"));
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("id", r.getId());
        out.put("fileId", file.getId());
        out.put("edits", readEdits(r));
        out.put("appliedCount", r.getAppliedCount());
        return out;
    }

    /** 前端每套用成功一条就上报累计条数（只增不减、不超过总数），失败后可从断点继续。 */
    public void recordProgress(Long userId, Long id, int appliedCount) {
        PendingRevision r = load(id, userId);
        int total = readEdits(r).size();
        if (appliedCount < 0 || appliedCount > total) {
            throw new RevisionException(LangText.of("进度超出范围", "Progress out of range"));
        }
        if (appliedCount > r.getAppliedCount()) {
            r.setAppliedCount(appliedCount);
            repository.save(r);
        }
    }

    /** 接受第二步：前端全部 edits 套用成功后调用，删除记录。 */
    public void markApplied(Long userId, Long id) {
        repository.delete(load(id, userId));
    }

    private PendingRevision load(Long id, Long userId) {
        PendingRevision r = repository.findById(id).orElseThrow(() ->
                new RevisionException(LangText.of("待审修订不存在", "Pending revision not found")));
        requireWrite(r.getProjectId(), userId);
        return r;
    }

    private void requireWrite(Long projectId, Long userId) {
        if (projectId == null || userId == null || !members.hasWritePermission(projectId, userId)) {
            throw new RevisionException(LangText.of("无权操作该项目的待审修订", "You don't have permission to manage revisions in this project"));
        }
    }

    private List<Edit> readEdits(PendingRevision r) {
        try {
            return objectMapper.readValue(r.getEditsJson(), EDIT_LIST);
        } catch (JsonProcessingException e) {
            throw new RevisionException(LangText.of("提案内容已损坏", "The proposal content is corrupted"));
        }
    }

    /** 列表时顺带判定过期：未套用过且文件版本已变 → 标 STALE（不用等用户点接受）。 */
    private void refreshStale(PendingRevision r) {
        if (!PendingRevision.PENDING.equals(r.getStatus()) || r.getAppliedCount() > 0) return;
        fileRepository.findById(r.getFileId())
                .filter(f -> !Boolean.TRUE.equals(f.getIsDeleted()))
                .ifPresent(f -> {
                    if (!fileVersion(f).equals(r.getBaseVersion())) {
                        r.setStatus(PendingRevision.STALE);
                        repository.save(r);
                    }
                });
    }

    private List<Map<String, Object>> view(List<PendingRevision> rows) {
        List<Map<String, Object>> out = new ArrayList<>();
        for (PendingRevision r : rows) {
            refreshStale(r);
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", r.getId());
            m.put("fileId", r.getFileId());
            m.put("projectId", r.getProjectId());
            m.put("source", r.getSource());
            m.put("status", r.getStatus());
            m.put("createdAt", r.getCreatedAt() == null ? null : r.getCreatedAt().toString());
            m.put("edits", readEdits(r));
            m.put("appliedCount", r.getAppliedCount());
            out.add(m);
        }
        return out;
    }
}
