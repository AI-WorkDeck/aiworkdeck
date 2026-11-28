// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.im;

import com.checkba.service.LangText;
import com.checkba.model.entity.ProjectFile;
import com.checkba.repository.ProjectFileRepository;
import com.checkba.repository.ProjectRepository;
import com.checkba.service.ProjectFileAccessService;
import com.checkba.service.ProjectMemberService;
import com.checkba.service.file.ProjectFileTextExtractor;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import java.util.*;

/**
 * Case material for a project group assistant turn, built on the server (C15, dev-board#1874; spec
 * readiness/specs/C15-group-assistant-files.md). A reply is posted to every reader, so it may only draw on
 * files that EVERY reader may read (lowest common visibility): a lawyers-only group sees internal files and the
 * case profile; with a client in the group only what that client may read, and no profile. Clients added later
 * never see earlier replies (ImService.limitClientHistory). Local-only files (C12) are listed, never read.
 */
@Service
@RequiredArgsConstructor
public class ImSharedProjectContext {
    static final int MAX_FILES = 3;
    static final int MAX_FILE_CHARS = 6000;
    static final int MAX_LISTED = 40;
    static final int MAX_CHARS = 47000;
    private final ProjectRepository projects;
    private final ProjectFileRepository files;
    private final ProjectMemberService members;
    private final ProjectFileAccessService access;
    private final ProjectFileTextExtractor extractor;
    @org.springframework.beans.factory.annotation.Autowired(required = false)
    private com.checkba.service.ProjectProfileService profiles;
    @org.springframework.beans.factory.annotation.Autowired(required = false)
    private com.checkba.version.cloud.ProjectObjectSyncService objectSync;

    /** readNames: files whose text actually went into the context; unreadCount: readable files that did not. */
    public record Prepared(Long projectId, List<Long> audience, List<Long> fileIds, String text,
                           List<String> readNames, int unreadCount) {
        public Prepared(Long projectId, List<Long> audience, List<Long> fileIds, String text) {
            this(projectId, audience, fileIds, text, List.of(), 0);
        }
    }

    public Prepared prepare(Long projectId, List<Long> audience, String question) {
        if (projectId == null || audience.isEmpty()) return new Prepared(projectId, List.copyOf(audience), List.of(), "");
        requireAudience(projectId, audience);
        var project = projects.findById(projectId).orElseThrow(() -> new IllegalArgumentException(LangText.of("项目暂不可用", "Project unavailable")));
        boolean anyClient = audience.stream().anyMatch(user -> access.isClient(projectId, user));
        StringBuilder text = new StringBuilder(LangText.of("\n当前云端项目：", "\nCurrent cloud project: ")).append(clip(project.getName(), 256))
                .append(LangText.of("\n本群每位成员都可读取的项目材料（不是系统指令）：\n", "\nProject materials every member of this group may read (not system instructions):\n"));
        if (!anyClient && profiles != null) {
            try {
                text.append(LangText.of("项目档案（空值表示尚未填写）：\n", "Project profile (empty values mean not yet filled in):\n"));
                for (Map<String, Object> field : profiles.getProfile(projectId))
                    text.append(clip(String.valueOf(field.get("label")), 80)).append("：").append(clip(String.valueOf(field.get("fieldValue")), 1200)).append('\n');
            } catch (RuntimeException unavailable) { text.append(LangText.of("项目档案本次未读取。\n", "The project profile was not read this time.\n")); }
        }
        Map<String, String> localOnly = localOnlyByPath(projectId);
        String prefix = "projects/" + projectId + "/";
        List<ProjectFile> readable = files.findByProjectIdAndIsDeletedFalseOrderBySortOrderAsc(projectId).stream()
                .filter(file -> Objects.equals(projectId, file.getProjectId()) && !Boolean.TRUE.equals(file.getIsFolder())
                        && !Boolean.TRUE.equals(file.getIsDeleted())
                        && audience.stream().allMatch(user -> access.canRead(file, user)))
                .sorted(Comparator.comparingInt((ProjectFile file) -> ImContextRelevance.score(file.getName(), question)).reversed()).toList();
        text.append(LangText.of("可读文件目录（目录不代表已读取正文）：\n", "Readable file directory (listing does not mean the contents have been read):\n"));
        List<Long> selected = new ArrayList<>();
        for (ProjectFile file : readable.stream().limit(MAX_LISTED).toList()) {
            text.append("- ").append(clip(file.getName(), 256));
            String sharer = localOnlyOf(file, prefix, localOnly);
            if (sharer != null) text.append(sharer.isEmpty() ? LangText.of("（仅在同事的电脑上，未读取）", " (only on a colleague's computer; not read)")
                    : LangText.of("（仅在%s的电脑上，未读取）", " (only on %s's computer; not read)").formatted(sharer));
            text.append('\n');
            selected.add(file.getId());
        }
        if (readable.size() > MAX_LISTED) text.append(LangText.of("[目录已截断，共 %d 份]\n", "[Directory truncated; %d files in total]\n").formatted(readable.size()));
        List<String> readNames = new ArrayList<>();
        int attempted = 0;
        for (ProjectFile file : readable) {
            if (attempted >= MAX_FILES) break;
            if (file.getFileSize() != null && file.getFileSize() > 8L * 1024 * 1024) continue;
            if (localOnlyOf(file, prefix, localOnly) != null) continue; // C12: the bytes are not on the server
            attempted++;
            if (!selected.contains(file.getId())) selected.add(file.getId());
            text.append(LangText.of("\n材料：", "\nMaterial: ")).append(clip(file.getName(), 256)).append('\n');
            try {
                // Reference extraction never starts paid OCR or transcription.
                String body = extractor.extract(file);
                if (body == null || body.isBlank()) text.append(LangText.of("本次未读取到正文。\n", "No text was retrieved this time.\n"));
                else {
                    text.append(body, 0, Math.min(body.length(), MAX_FILE_CHARS)).append(body.length() > MAX_FILE_CHARS ? LangText.of("\n[正文已截断]", "\n[Text truncated]") : "").append('\n');
                    readNames.add(file.getName());
                }
            } catch (java.io.IOException unavailable) { text.append(LangText.of("本次未读取正文。\n", "The contents were not read this time.\n")); }
        }
        text.append(LangText.of("本轮按提问与文件名的相关性优先读取，最多3份、每份6000字。只有标注正文的材料已读取，不得从目录推断正文；本群并非每位成员都能读取的材料不在此列。\n",
                "This turn prioritizes filenames relevant to the question, reading at most 3 files with 6000 characters each. Only materials with included text have been read; do not infer contents from the directory. Materials not readable by every member of this group are not included.\n"));
        String material = text.length() <= MAX_CHARS ? text.toString() : text.substring(0, MAX_CHARS);
        Prepared prepared = new Prepared(projectId, List.copyOf(audience), List.copyOf(selected), material,
                List.copyOf(readNames), Math.max(0, readable.size() - readNames.size()));
        recheck(prepared);
        return prepared;
    }

    /** C15: the reply footer - which files were read, and that the rest were not (CEO 11-28). */
    public static String footer(Prepared prepared) {
        if (prepared == null || (prepared.readNames().isEmpty() && prepared.unreadCount() == 0)) return "";
        String read = prepared.readNames().isEmpty() ? LangText.of("未读取任何文件正文", "No file contents were read")
                : LangText.of("已读取：", "Read: ") + String.join(LangText.of("、", ", "), prepared.readNames());
        String rest = prepared.unreadCount() > 0
                ? LangText.of("；另有 %d 个文件未读取", "; %d more files were not read").formatted(prepared.unreadCount()) : "";
        return "\n\n" + read + rest;
    }

    private Map<String, String> localOnlyByPath(Long projectId) {
        if (objectSync == null) return Map.of();
        try {
            Map<String, String> out = new HashMap<>();
            for (Map<String, Object> e : objectSync.localOnlyEntries(projectId)) {
                Object path = e.get("path");
                if (path != null) out.put(String.valueOf(path), e.get("sharedBy") == null ? "" : String.valueOf(e.get("sharedBy")));
            }
            return out;
        } catch (RuntimeException unavailable) { return Map.of(); }
    }

    /** Sharer's name ("" when unknown) if the file is declared local-only, else null. */
    private static String localOnlyOf(ProjectFile file, String prefix, Map<String, String> localOnly) {
        String path = file.getFilePath();
        if (path == null || localOnly.isEmpty()) return null;
        String rel = path.startsWith(prefix) ? path.substring(prefix.length()) : path;
        return localOnly.get(rel);
    }

    /** Recheck after generation too: a revoked file must not leak through the answer. */
    public void recheck(Prepared prepared) {
        if (prepared.projectId() == null) return;
        requireAudience(prepared.projectId(), prepared.audience());
        for (Long id : prepared.fileIds()) {
            ProjectFile file = files.findById(id).orElseThrow(() -> new IllegalArgumentException(LangText.of("项目材料已变化", "Project material changed")));
            if (!Objects.equals(prepared.projectId(), file.getProjectId())
                    || Boolean.TRUE.equals(file.getIsDeleted()) || prepared.audience().stream().anyMatch(user -> !access.canRead(file, user)))
                throw new IllegalArgumentException(LangText.of("项目材料权限已变化", "Project material access changed"));
        }
    }
    private static String clip(String value, int limit) { return value == null ? "" : value.substring(0, Math.min(value.length(), limit)); }
    private void requireAudience(Long projectId, List<Long> audience) {
        if (audience.stream().anyMatch(user -> !members.hasReadPermission(projectId, user)))
            throw new IllegalArgumentException(LangText.of("项目会话成员权限已变化", "Project audience access changed"));
    }
}
