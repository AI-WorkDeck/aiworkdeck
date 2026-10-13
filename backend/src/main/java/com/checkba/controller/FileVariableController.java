// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.controller;

import com.checkba.model.entity.FileVariable;
import com.checkba.model.entity.ProjectFile;
import com.checkba.repository.ProjectFileRepository;
import com.checkba.service.FileVariableService;
import com.checkba.service.ProjectFileAccessService;
import org.springframework.http.ResponseEntity;
import com.checkba.service.ProjectMemberService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/file-variables")
@RequiredArgsConstructor
public class FileVariableController {

    private final FileVariableService fileVariableService;
    private final ProjectMemberService projectMemberService;
    private final ProjectFileRepository projectFileRepository;
    private final ProjectFileAccessService fileAccess;

    private void requireFileAccess(String sessionId, Long fileId, boolean write) {
        Long userId = AuthController.getUserIdFromSession(sessionId);
        if (userId == null) throw new IllegalArgumentException("未登录");
        ProjectFile file = fileId == null ? null : projectFileRepository.findById(fileId).orElse(null);
        fileAccess.requireRead(file, userId);
        if (write && (fileAccess.isClient(file.getProjectId(), userId)
                || !projectMemberService.hasWritePermission(file.getProjectId(), userId))) {
            throw new ProjectFileAccessService.FileAccessDeniedException();
        }
    }

    @ExceptionHandler(ProjectFileAccessService.FileAccessDeniedException.class)
    public ResponseEntity<Map<String, Object>> onFileAccessDenied(ProjectFileAccessService.FileAccessDeniedException e) {
        return ResponseEntity.status(403).body(Map.of("code", 403, "message", e.getMessage()));
    }

    @GetMapping
    public Map<String, Object> getVariables(
            @RequestParam Long fileId,
            @RequestHeader(value = "X-Session-Id", required = false) String sessionId) {
        requireFileAccess(sessionId, fileId, false);
        List<FileVariable> variables = fileVariableService.getVariables(fileId);
        Map<String, Object> result = new HashMap<>();
        result.put("code", 0);
        result.put("data", variables);
        return result;
    }

    @PostMapping
    public Map<String, Object> createOrUpdateVariable(
            @RequestBody FileVariable variable,
            @RequestHeader(value = "X-Session-Id", required = false) String sessionId) {
        requireFileAccess(sessionId, variable.getFileId(), true);
        // A supplied entity ID must not retarget a variable belonging to another file.
        if (variable.getId() != null && !java.util.Objects.equals(variable.getFileId(),
                fileVariableService.getFileIdById(variable.getId()))) {
            throw new ProjectFileAccessService.FileAccessDeniedException();
        }
        FileVariable saved = fileVariableService.createOrUpdateVariable(variable);
        Map<String, Object> result = new HashMap<>();
        result.put("code", 0);
        result.put("data", saved);
        return result;
    }

    @DeleteMapping("/{id}")
    public Map<String, Object> deleteVariable(
            @PathVariable Long id,
            @RequestHeader(value = "X-Session-Id", required = false) String sessionId) {
        requireFileAccess(sessionId, fileVariableService.getFileIdById(id), true);
        fileVariableService.deleteVariable(id);
        Map<String, Object> result = new HashMap<>();
        result.put("code", 0);
        result.put("message", "Deleted");
        return result;
    }
}
