// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.controller;

import com.checkba.model.SensitiveType;
import com.checkba.model.entity.ProjectFile;
import com.checkba.service.*;
import com.checkba.storage.StorageServiceFactory;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.io.File;
import java.nio.file.*;
import java.util.*;

@RestController
@RequestMapping("/api/sensitive")
@RequiredArgsConstructor
@Slf4j
public class SensitiveController {
    private final SensitiveService sensitiveService;
    private final StorageServiceFactory storageServiceFactory;
    private final ProjectFileService projectFileService;
    private final ProjectMemberService projectMemberService;
    private final ProjectFileAccessService fileAccess;

    public record Request(Long fileId, List<String> strategies, String mode, @com.fasterxml.jackson.annotation.JsonAlias("customWords") List<String> customTerms,
                          List<String> excludedTerms, String password, String recoveryKit) {
        SensitiveService.Options options() {
            return new SensitiveService.Options(strategies, mode, customTerms, excludedTerms, password);
        }
    }

    @GetMapping("/options")
    public ResponseEntity<List<Map<String, String>>> getSensitiveOptions() {
        List<Map<String, String>> options = new ArrayList<>();
        for (SensitiveType type : SensitiveType.autoDetectTypes()) {
            options.add(Map.of("value", type.getCode(), "label", type.getLocalizedLabel(),
                    "example", type.getExample(), "description", type.getLocalizedDescription()));
        }
        return ResponseEntity.ok(options);
    }

    @PostMapping("/preview")
    public ResponseEntity<?> preview(@RequestBody Request request,
            @RequestHeader(value = "X-Session-Id", required = false) String sessionId) {
        return execute(request, sessionId, "preview");
    }

    @PostMapping("/desensitize")
    public ResponseEntity<?> desensitizeFile(@RequestBody Request request,
            @RequestHeader(value = "X-Session-Id", required = false) String sessionId) {
        return execute(request, sessionId, "desensitize");
    }

    @PostMapping("/restore")
    public ResponseEntity<?> restore(@RequestBody Request request,
            @RequestHeader(value = "X-Session-Id", required = false) String sessionId) {
        return execute(request, sessionId, "restore");
    }

    @PostMapping("/recovery")
    public ResponseEntity<?> recovery(@RequestBody Request request,
            @RequestHeader(value = "X-Session-Id", required = false) String sessionId) {
        return execute(request, sessionId, "recovery");
    }

    private ResponseEntity<?> execute(Request request, String sessionId, String action) {
        Long userId = AuthController.getUserIdFromSession(sessionId);
        if (userId == null) return response(401, Map.of("error", "Unauthorized"));
        if (request.fileId() == null) return response(400, Map.of("error", "fileId is required"));
        try {
            ProjectFile source = projectFileService.getFile(request.fileId());
            fileAccess.requireRead(source, userId);
            if (!projectMemberService.hasReadPermission(source.getProjectId(), userId)
                    || (!Set.of("preview", "recovery").contains(action) && !projectMemberService.hasWritePermission(source.getProjectId(), userId))) {
                return response(403, Map.of("error", LangText.of("无权读取文件或在该项目生成文件", "No permission to read the file or create files in this project")));
            }
            if (action.equals("recovery")) {
                ProjectFile kit = findRecovery(source);
                if (kit == null) return response(200, Map.of("recoveryKit", "", "name", ""));
                String content = readRecovery(kit, userId);
                return response(200, Map.of("recoveryKit", content, "name", content.isEmpty() ? "" : kit.getName()));
            }
            File file = storageServiceFactory.getStorageService().load(source.getFilePath()).getFile();
            if (action.equals("preview")) return response(200, sensitiveService.previewFile(file.getAbsolutePath(), request.options()));
            SensitiveService.Result result = action.equals("restore")
                    ? sensitiveService.restoreFile(file.getAbsolutePath(), recoveryForRestore(source, request, userId), request.password())
                    : sensitiveService.processFile(file.getAbsolutePath(), request.options());
            ProjectFile saved = null;
            Path output = Path.of(result.path());
            Path kitPath = output.resolveSibling(output.getFileName() + ".awd-recovery");
            ProjectFile recoveryFile = null;
            boolean kitCreated = false;
            try {
                if (!result.recoveryKit().isEmpty()) {
                    Files.writeString(kitPath, result.recoveryKit(), java.nio.charset.StandardCharsets.UTF_8,
                            StandardOpenOption.CREATE_NEW);
                    kitCreated = true;
                    recoveryFile = register(source, kitPath, userId);
                }
                saved = register(source, output, userId);
                if (recoveryFile != null) projectFileService.linkSensitiveRecovery(saved, recoveryFile);
            } catch (Exception e) {
                cleanup(e, () -> Files.deleteIfExists(output));
                ProjectFile documentToRemove = saved, recoveryToRemove = recoveryFile;
                if (documentToRemove != null) cleanup(e, () -> projectFileService.permDelete(documentToRemove.getId(), userId));
                if (recoveryToRemove != null) cleanup(e, () -> projectFileService.permDelete(recoveryToRemove.getId(), userId));
                if (kitCreated) cleanup(e, () -> Files.deleteIfExists(kitPath));
                throw e;
            }
            // Preserve the original endpoint contract for clients which do not yet send a mode.
            if (action.equals("desensitize") && request.mode() == null) return response(200, saved);
            return response(200, Map.of("file", saved, "recoveryKit", result.recoveryKit(),
                    "counts", result.counts(), "suspects", result.suspects(), "warnings", result.warnings()));
        } catch (ProjectFileAccessService.FileAccessDeniedException e) {
            return response(403, Map.of("error", e.getMessage()));
        } catch (IllegalArgumentException e) {
            return response(400, Map.of("error", e.getMessage() == null ? LangText.of("请求无效", "Invalid request") : e.getMessage()));
        } catch (Exception e) {
            // Paths, original words, passwords and mapping content must not reach diagnostic logs.
            log.warn("Sensitive operation failed: action={}, fileId={}, exception={}", action, request.fileId(), e.getClass().getSimpleName());
            return response(500, Map.of("error", LangText.of("文件处理失败，请检查文件格式、编码或是否加密", "Failed to process file. Please check file format, encoding, or encryption status.")));
        }
    }

    private ProjectFile register(ProjectFile source, Path output, Long userId) throws Exception {
        String name = output.getFileName().toString();
        Path parent = source.getExternalPath() == null || source.getExternalPath().isBlank()
                ? Path.of(source.getFilePath()).getParent() : Path.of("projects", source.getProjectId().toString());
        String relative = (parent == null ? Path.of(name) : parent.resolve(name)).toString().replace('\\', '/');
        var storage = storageServiceFactory.getStorageService();
        // Processing may use an external/local temporary file. Registration alone only creates a template.
        boolean alreadyStored = storage.exists(relative);
        if (alreadyStored && !Files.isSameFile(output, storage.load(relative).getFile().toPath())) {
            throw new IllegalArgumentException(LangText.of("生成文件已存在，请重试", "The generated file already exists; please retry"));
        }
        ProjectFile saved = projectFileService.createFile(source.getProjectId(), source.getParentId(), name,
                cn.hutool.core.io.FileUtil.extName(name), Files.size(output), relative,
                "project_" + source.getProjectId() + "_doc_" + UUID.randomUUID().toString().replace("-", ""), userId);
        try {
            if (!alreadyStored) {
                try (var input = Files.newInputStream(output)) { storage.save(saved.getFilePath(), input); }
                Files.delete(output);
            }
            return saved;
        } catch (Exception e) {
            cleanup(e, () -> projectFileService.permDelete(saved.getId(), userId));
            throw e;
        }
    }

    private ProjectFile findRecovery(ProjectFile source) {
        ProjectFile kit;
        if (source.getSensitiveRecoveryFileId() != null) {
            kit = projectFileService.findFile(source.getSensitiveRecoveryFileId()).orElse(null);
        } else if (source.getFilePath().endsWith(".awd-recovery")) {
            kit = source;
        } else {
            String kitPath = source.getFilePath() + ".awd-recovery";
            kit = projectFileService.getFilesByParent(source.getProjectId(), source.getParentId()).stream()
                    .filter(candidate -> kitPath.equals(candidate.getFilePath())).findFirst().orElse(null);
        }
        if (kit == null || Boolean.TRUE.equals(kit.getIsDeleted())) return null;
        if (!Objects.equals(source.getProjectId(), kit.getProjectId()) || Boolean.TRUE.equals(kit.getIsFolder()))
            throw new ProjectFileAccessService.FileAccessDeniedException();
        return kit;
    }

    private String recoveryForRestore(ProjectFile source, Request request, Long userId) throws Exception {
        if (request.recoveryKit() != null && !request.recoveryKit().isBlank()) return request.recoveryKit();
        ProjectFile kit = findRecovery(source);
        String content = kit == null ? "" : readRecovery(kit, userId);
        if (content.isEmpty()) throw new IllegalArgumentException(LangText.of(
                "该文件没有可用的恢复材料，无法自动复敏；请从原文件重新生成可复敏副本",
                "No recovery material is available for this file. Generate a new reversible copy from the original."));
        return content;
    }

    private String readRecovery(ProjectFile kit, Long userId) throws Exception {
        fileAccess.requireRead(kit, userId);
        if (!storageServiceFactory.getStorageService().exists(kit.getFilePath())) return "";
        try (var stream = storageServiceFactory.getStorageService().load(kit.getFilePath()).getInputStream()) {
            byte[] bytes = stream.readNBytes(8_000_001);
            String content = new String(bytes, java.nio.charset.StandardCharsets.UTF_8);
            if (bytes.length > 8_000_000 || !content.startsWith("AWD-RECOVERY-1:"))
                throw new IllegalArgumentException(LangText.of("恢复材料不可用，无法复敏", "Recovery material is unavailable; the file cannot be restored"));
            return content;
        }
    }

    @FunctionalInterface
    private interface Cleanup { void run() throws Exception; }

    private void cleanup(Exception failure, Cleanup action) {
        try { action.run(); } catch (Exception cleanupFailure) { failure.addSuppressed(cleanupFailure); }
    }

    private ResponseEntity<?> response(int status, Object body) {
        return ResponseEntity.status(status).cacheControl(CacheControl.noStore()).body(body);
    }
}
