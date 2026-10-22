// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service;

import com.checkba.model.entity.ProjectFile;
import com.checkba.repository.DdSubmissionRepository;
import com.checkba.repository.ProjectFileRepository;
import com.checkba.storage.ProjectStorageResolver;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.nio.file.Path;
import java.util.*;
import java.util.regex.Pattern;

/** A submitted original can be copied for editing, but its existing bytes and identity stay fixed. */
@Service
@RequiredArgsConstructor
public class DdOriginalGuard {
    public static final String MESSAGE = "这是已提交的尽调原件，请先复制后再编辑；原件及其历史不能改动或删除";
    private static final Pattern PROJECT_KEY = Pattern.compile("^projects/(\\d+)(?:/.*)?$");
    private final DdSubmissionRepository submissions;
    private final ProjectFileRepository files;
    private final ProjectStorageResolver resolver;

    public void requireMutableTree(ProjectFile root) {
        if (root == null || root.getId() == null) return;
        Set<Long> protectedIds = protectedIds(root.getProjectId());
        if (protectedIds.isEmpty()) return;
        Set<Long> descendants = new HashSet<>(); descendants.add(root.getId());
        if (Boolean.TRUE.equals(root.getIsFolder())) {
            List<ProjectFile> all = files.findByProjectId(root.getProjectId());
            boolean changed;
            do {
                changed = false;
                for (ProjectFile file : all) {
                    if (descendants.contains(file.getParentId()) && descendants.add(file.getId())) changed = true;
                }
            } while (changed);
        }
        if (protectedIds.stream().anyMatch(descendants::contains)) throw new IllegalArgumentException(MESSAGE);
    }

    /** Check resolved paths too, so normalized aliases and parent directory moves cannot evade the guard. */
    public void requireMutablePath(String key, Path target) {
        String normalized = Path.of(key.replace('\\', '/')).normalize().toString().replace('\\', '/');
        var matcher = PROJECT_KEY.matcher(normalized);
        if (!matcher.matches()) {
            Path global = resolver.globalRoot().toAbsolutePath().normalize();
            if (!target.toAbsolutePath().normalize().startsWith(global)) return;
            normalized = global.relativize(target.toAbsolutePath().normalize()).toString().replace('\\', '/');
            matcher = PROJECT_KEY.matcher(normalized);
            if (!matcher.matches()) return;
        }
        Long projectId;
        try { projectId = Long.valueOf(matcher.group(1)); }
        catch (NumberFormatException e) { return; }
        Set<Long> ids = protectedIds(projectId);
        if (ids.isEmpty()) return;
        Path normalizedTarget = target.toAbsolutePath().normalize();
        for (ProjectFile file : files.findAllById(ids)) {
            if (!Objects.equals(projectId, file.getProjectId()) || file.getFilePath() == null) continue;
            Path original = resolver.resolve(file.getFilePath()).toAbsolutePath().normalize();
            if (original.startsWith(normalizedTarget)) throw new IllegalArgumentException(MESSAGE);
        }
    }

    private Set<Long> protectedIds(Long projectId) {
        Set<Long> result = new HashSet<>();
        submissions.findByProjectId(projectId).forEach(s -> result.addAll(s.getFileIds()));
        return result;
    }
}
