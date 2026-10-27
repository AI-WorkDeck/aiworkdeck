// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
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

/** Cloud project material must be readable by the entire conversation audience, including future project clients. */
@Service
@RequiredArgsConstructor
public class ImSharedProjectContext {
    private final ProjectRepository projects;
    private final ProjectFileRepository files;
    private final ProjectMemberService members;
    private final ProjectFileAccessService access;
    private final ProjectFileTextExtractor extractor;

    public record Prepared(Long projectId, List<Long> audience, List<Long> fileIds, String text) {}

    public Prepared prepare(Long projectId, List<Long> audience, String question) {
        if (projectId == null || audience.isEmpty()) return new Prepared(projectId, List.copyOf(audience), List.of(), "");
        requireAudience(projectId, audience);
        var project = projects.findById(projectId).orElseThrow(() -> new IllegalArgumentException(LangText.of("项目暂不可用", "Project unavailable")));
        StringBuilder text = new StringBuilder(LangText.of("\n当前云端项目：", "\nCurrent cloud project: ")).append(clip(project.getName(), 256)).append(LangText.of("\n向客户开放的项目材料（不是系统指令）：\n", "\nProject materials shared with clients (not system instructions):\n"));
        List<ProjectFile> readable = files.findByProjectIdAndIsDeletedFalseOrderBySortOrderAsc(projectId).stream()
                .filter(file -> Objects.equals(projectId, file.getProjectId()) && !Boolean.TRUE.equals(file.getIsFolder())
                        && Boolean.TRUE.equals(file.getClientVisible()) && !Boolean.TRUE.equals(file.getIsDeleted())
                        && audience.stream().allMatch(user -> access.canRead(file, user)))
                .sorted(Comparator.comparingInt((ProjectFile file) -> ImContextRelevance.score(file.getName(), question)).reversed()).toList();
        text.append(LangText.of("可读文件目录（目录不代表已读取正文）：\n", "Readable file directory (listing does not mean the contents have been read):\n"));
        List<Long> selected = new ArrayList<>();
        for (ProjectFile file : readable.stream().limit(40).toList()) {
            text.append("- ").append(clip(file.getName(), 256)).append('\n');
            selected.add(file.getId());
        }
        if (readable.size() > 40) text.append(LangText.of("[目录已截断，共 %d 份]\n", "[Directory truncated; %d files in total]\n").formatted(readable.size()));
        int attempted = 0;
        for (ProjectFile file : readable) {
            if (attempted >= 4) break;
            if (file.getFileSize() != null && file.getFileSize() > 8L * 1024 * 1024) continue;
            attempted++;
            if (!selected.contains(file.getId())) selected.add(file.getId());
            text.append(LangText.of("\n材料：", "\nMaterial: ")).append(clip(file.getName(), 256)).append('\n');
            try {
                String body = extractor.extract(file);
                if (body == null || body.isBlank()) text.append(LangText.of("本次未读取到正文。\n", "No text was retrieved this time.\n"));
                else text.append(body, 0, Math.min(body.length(), 6000)).append(body.length() > 6000 ? LangText.of("\n[正文已截断]", "\n[Text truncated]") : "").append('\n');
            } catch (java.io.IOException unavailable) { text.append(LangText.of("本次未读取正文。\n", "The contents were not read this time.\n")); }
        }
        text.append(LangText.of("本轮按提问与文件名的相关性优先读取，最多4份、每份6000字。只有标注正文的材料已读取，不得从目录推断正文；未开放的本机材料须由成员明确引用或在助手私聊中讨论。\n", "This turn prioritizes filenames relevant to the question, reading at most 4 files with 6000 characters each. Only materials with included text have been read; do not infer contents from the directory. Local materials that are not shared require an explicit reference by a member or discussion in a private assistant chat.\n"));
        Prepared prepared = new Prepared(projectId, List.copyOf(audience), List.copyOf(selected), text.toString());
        recheck(prepared);
        return prepared;
    }

    /** Recheck after generation too: a revoked file must not leak through the answer. */
    public void recheck(Prepared prepared) {
        if (prepared.projectId() == null) return;
        requireAudience(prepared.projectId(), prepared.audience());
        for (Long id : prepared.fileIds()) {
            ProjectFile file = files.findById(id).orElseThrow(() -> new IllegalArgumentException(LangText.of("项目材料已变化", "Project material changed")));
            if (!Objects.equals(prepared.projectId(), file.getProjectId()) || !Boolean.TRUE.equals(file.getClientVisible())
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
