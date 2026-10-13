// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service;

import com.checkba.model.entity.ProjectFile;
import com.checkba.repository.ProjectFileRepository;
import com.checkba.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Objects;

/** File visibility is always subordinate to current project membership. */
@Service
@RequiredArgsConstructor
public class ProjectFileAccessService {
    public static final String UNAVAILABLE_MESSAGE = "抱歉文件还在准备中，请联系您的律师。";

    private final ProjectMemberService members;
    private final UserRepository users;
    private final ProjectFileRepository files;

    public static class FileAccessDeniedException extends IllegalArgumentException {
        public FileAccessDeniedException() { super(UNAVAILABLE_MESSAGE); }
    }

    public boolean isClient(Long projectId, Long userId) {
        if (projectId == null || userId == null) return true;
        if (members.isClient(projectId, userId)) return true;
        // A global customer account must not gain staff access through a default project role.
        return users.findById(userId)
                .map(user -> "CLIENT".equalsIgnoreCase(user.getRole()))
                .orElse(true);
    }

    public boolean canRead(ProjectFile file, Long userId) {
        if (file == null || userId == null || file.getProjectId() == null
                || Boolean.TRUE.equals(file.getIsDeleted())
                || !members.hasReadPermission(file.getProjectId(), userId)) return false;
        return !isClient(file.getProjectId(), userId)
                || Objects.equals(file.getUserId(), userId)
                || Boolean.TRUE.equals(file.getClientVisible());
    }

    public void requireRead(ProjectFile file, Long userId) {
        if (!canRead(file, userId)) throw new FileAccessDeniedException();
    }

    public boolean canManageAccess(ProjectFile file, Long userId) {
        return canRead(file, userId) && !Boolean.TRUE.equals(file.getIsFolder())
                && !isClient(file.getProjectId(), userId)
                && members.hasWritePermission(file.getProjectId(), userId);
    }

    @Transactional
    public ProjectFile setClientVisible(ProjectFile file, Long userId, boolean visible) {
        requireRead(file, userId);
        if (isClient(file.getProjectId(), userId)
                || !members.hasWritePermission(file.getProjectId(), userId)) {
            throw new FileAccessDeniedException();
        }
        if (Boolean.TRUE.equals(file.getIsFolder())) {
            throw new IllegalArgumentException("请为具体文件设置客户访问权限");
        }
        file.setClientVisible(visible);
        return files.save(file);
    }
}
