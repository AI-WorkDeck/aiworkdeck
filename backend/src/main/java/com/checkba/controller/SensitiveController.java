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
                ProjectFile kit = source;
                if (!source.getFilePath().endsWith(".awd-recovery")) {
                    String kitPath = source.getFilePath() + ".awd-recovery";
                    kit = projectFileService.getFilesByParent(source.getProjectId(), source.getParentId()).stream()
                            .filter(candidate -> kitPath.equals(candidate.getFilePath())).findFirst().orElse(null);
                }
                if (kit == null) return response(200, Map.of("recoveryKit", "", "name", ""));
                fileAccess.requireRead(kit, userId);
                try (var stream = storageServiceFactory.getStorageService().load(kit.getFilePath()).getInputStream()) {
                    byte[] bytes = stream.readNBytes(8_000_001);
                    String content = new String(bytes, java.nio.charset.StandardCharsets.UTF_8);
                    if (bytes.length > 8_000_000 || !content.startsWith("AWD-RECOVERY-1:"))
                        throw new IllegalArgumentException(LangText.of("请选择对应的加密恢复材料（.awd-recovery）", "Select the matching encrypted recovery material (.awd-recovery)"));
                    return response(200, Map.of("recoveryKit", content, "name", kit.getName()));
                }
            }
            File file = storageServiceFactory.getStorageService().load(source.getFilePath()).getFile();
            if (action.equals("preview")) return response(200, sensitiveService.previewFile(file.getAbsolutePath(), request.options()));
            SensitiveService.Result result = action.equals("restore")
                    ? sensitiveService.restoreFile(file.getAbsolutePath(), request.recoveryKit(), request.password())
                    : sensitiveService.processFile(file.getAbsolutePath(), request.options());
            ProjectFile saved;
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
            } catch (Exception e) {
                Files.deleteIfExists(output);
                if (recoveryFile != null) projectFileService.permDelete(recoveryFile.getId(), userId);
                if (kitCreated) Files.deleteIfExists(kitPath);
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
        Path parent = Path.of(source.getFilePath()).getParent();
        String relative = (parent == null ? Path.of(name) : parent.resolve(name)).toString().replace('\\', '/');
        return projectFileService.createFile(source.getProjectId(), source.getParentId(), name,
                cn.hutool.core.io.FileUtil.extName(name), Files.size(output), relative,
                "project_" + source.getProjectId() + "_doc_" + UUID.randomUUID().toString().replace("-", ""), userId);
    }

    private ResponseEntity<?> response(int status, Object body) {
        return ResponseEntity.status(status).cacheControl(CacheControl.noStore()).body(body);
    }
}
