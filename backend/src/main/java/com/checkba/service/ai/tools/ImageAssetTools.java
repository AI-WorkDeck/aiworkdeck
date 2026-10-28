// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.ai.tools;

import com.checkba.model.entity.ImageAssetGeneration;
import com.checkba.repository.ImageAssetGenerationRepository;
import com.checkba.service.LangText;
import com.checkba.service.ProjectFileService;
import com.checkba.service.ProjectMemberService;
import com.checkba.service.mobile.CloudStorageQuotaService;
import com.checkba.service.ai.*;
import com.checkba.service.ai.context.ProjectContextHolder;
import com.checkba.storage.ProjectStorageResolver;

import dev.langchain4j.agent.tool.*;

import lombok.RequiredArgsConstructor;

import org.springframework.stereotype.Component;

import java.nio.file.*;
import java.util.*;

@Component
@lombok.extern.slf4j.Slf4j
@RequiredArgsConstructor
public class ImageAssetTools implements AgentToolComponent {
    private final ImageAssetGenerationRepository tasks;
    private final ProjectMemberService members;
    private final ProjectFileService files;
    private final PptxServiceClient client;
    private final PptxTools pptx;
    private final ProjectStorageResolver storage;
    private final EditorBridgeService editor;
    private final org.springframework.transaction.PlatformTransactionManager transactions;
    private final CloudStorageQuotaService quota;

    private String error() {
        return "Error: "
                + LangText.of(
                        "素材任务未完成，请核对任务状态；不要重新提交同一生图请求",
                        "Asset task did not complete; inspect its status rather than resubmitting"
                            + " generation");
    }

    private Long project() {
        return ProjectContextHolder.getProjectIdAsLong();
    }

    private Long user() {
        return ProjectContextHolder.getUserId();
    }

    private boolean permitted() {
        return project() != null && user() != null && members.hasWritePermission(project(), user());
    }

    private String receipt(ImageAssetGeneration task) {
        boolean unknown = "SUBMISSION_UNKNOWN".equals(task.getState());
        boolean failed = "FAILED".equals(task.getState()) || "CANCELLED".equals(task.getState());
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("generationId", task.getId());
        result.put("state", task.getState());
        result.put("retryable", false);
        result.put("needsInvestigation", unknown || failed);
        if (!unknown && !failed) result.put("nextTool", "image_get_generation");
        result.put("message", unknown
                ? LangText.of("提交结果尚不确定，请核查原任务，勿重复生图", "Submission outcome is unknown; investigate the original task without generating again")
                : failed
                ? LangText.of("素材任务已停止，请保留已完成内容并说明缺少的素材，勿反复查询或重新生图", "The asset task has stopped; retain completed work and report the missing asset without repeated polling or regeneration")
                : LangText.of("请查询原任务，勿重复生图", "Query the original task; do not generate again"));
        return cn.hutool.json.JSONUtil.toJsonStr(result);
    }

    @ToolMeta(displayName = "生成图片素材", category = "document")
    @Tool(
            "Start one image asset generation (uses model credits), not a whole slide. Specify"
                + " subject, style, focal placement and negative space; keep slide text/data"
                + " editable. Use a stable requestKey for this intent: repeating the key returns"
                + " the original task without charging for another generation. Poll"
                + " image_get_generation; never regenerate after a timeout. Output is saved to the"
                + " current project.")
    public synchronized String image_generate_asset(
            @P("Stable request key, 1-100 ASCII letters/digits/hyphens/underscores")
                    String requestKey,
            @P("Image description, at most 8000 characters") String prompt,
            @P("1:1/16:9/9:16/4:3/3:4/3:2/2:3/21:9") String aspectRatio,
            @P(value = "Destination folder ID, 0 or omitted for project root", required = false)
                    Long parentFolderId) {
        if (!permitted()) return error();
        if (requestKey == null
                || !requestKey.matches("[A-Za-z0-9_-]{1,100}")
                || prompt == null
                || prompt.isBlank()
                || prompt.length() > 8000
                || !Set.of("1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "21:9")
                        .contains(aspectRatio == null ? "" : aspectRatio)) return error();
        var prior = tasks.findByUserIdAndProjectIdAndRequestKey(user(), project(), requestKey);
        if (prior.isPresent()) return receipt(prior.get());
        ImageAssetGeneration task = null;
        boolean persisted = false;
        try {
            if (!client.isHealthy()) {
                String missing = pptx.promptComponentIfMissing("image_generate_asset");
                if (missing != null)
                    return LangText.of(
                            "图片生成组件尚未安装，已显示安装入口；安装完成后继续原任务",
                            "The image generation component is not installed; the installation"
                                + " prompt is shown. Continue the original task after"
                                + " installation");
                return LangText.of(
                        "图片生成服务尚未就绪；请求尚未提交，可以恢复服务后使用相同requestKey继续",
                        "Image generation service is not ready; no request was submitted. Resume"
                            + " with the same requestKey after service recovery");
            }
            Long parent = GeneratedFileLocation.resolve(files, project(), parentFolderId, null);
            var config = PlatformAiUserScope.call(user(), () -> pptx.buildModelConfig(null));
            task = new ImageAssetGeneration();
            task.setId(UUID.randomUUID().toString());
            task.setUserId(user());
            task.setProjectId(project());
            task.setRequestKey(requestKey);
            task.setParentFolderId(parent);
            task.setState("SUBMISSION_UNKNOWN");
            tasks.saveAndFlush(task);
            persisted = true;
            task.setServiceProjectId(client.createProject("Presentation image asset"));
            tasks.saveAndFlush(task);
            task.setServiceTaskId(
                    client.startAsset(task.getServiceProjectId(), prompt, aspectRatio, config));
            task.setState("PENDING");
            tasks.saveAndFlush(task);
            return receipt(task);
        } catch (Exception e) {
            if (persisted) return receipt(task);
            return tasks.findByUserIdAndProjectIdAndRequestKey(user(), project(), requestKey)
                    .map(this::receipt)
                    .orElseGet(this::error);
        }
    }

    @ToolMeta(displayName = "查询图片素材", category = "document", fileEffect = "ADDED")
    @Tool(
            "Check a previously started image generation and import its completed image once. Does"
                + " not call the image model again. Supply generationId from image_generate_asset."
                + " The returned db_id can be passed as fileId to slide_add_image. Unknown submission"
                + " requires investigation, not a new request.")
    public synchronized String image_get_generation(
            @P("Generation ID returned by image_generate_asset") String generationId) {
        if (!permitted() || generationId == null) return error();
        try {
            return new org.springframework.transaction.support.TransactionTemplate(transactions)
                    .execute(status -> importGeneration(generationId));
        } catch (Exception e) {
            return error();
        }
    }

    private String importGeneration(String generationId) {
        var task = tasks.findLockedById(generationId).orElse(null);
        if (task == null
                || !Objects.equals(task.getUserId(), user())
                || !Objects.equals(task.getProjectId(), project())) return error();
        try {
            if (task.getOutputFileId() != null) {
                var file = files.getFile(task.getOutputFileId());
                if (file == null
                        || Boolean.TRUE.equals(file.getIsDeleted())
                        || Boolean.TRUE.equals(file.getIsFolder())
                        || !Objects.equals(file.getProjectId(), project())
                        || !Objects.equals(file.getParentId(), task.getParentFolderId())
                        || !Objects.equals(file.getWpsFileId(), "asset_" + task.getId())
                        || !Objects.equals(file.getName(), "asset-" + task.getId() + ".png")
                        || !Objects.equals(
                                file.getFilePath(),
                                pptx.buildPhysicalPath(
                                        project(), task.getParentFolderId(), file.getName())))
                    return error();
                GeneratedFileLocation.resolve(files, project(), task.getParentFolderId(), null);
                return GeneratedFileLocation.createdResult(
                        file, LangText.of("图片素材已生成", "Image asset generated"));
            }
            if (task.getServiceTaskId() == null) return receipt(task);
            var status = client.getTaskStatus(task.getServiceProjectId(), task.getServiceTaskId());
            task.setState(status.getStr("status", "PENDING"));
            tasks.saveAndFlush(task);
            if (!"COMPLETED".equals(task.getState())) return receipt(task);
            GeneratedFileLocation.resolve(files, project(), task.getParentFolderId(), null);
            byte[] data =
                    client.readAsset(
                            task.getServiceProjectId(),
                            status.getJSONObject("progress").getStr("image_url"));
            try (var input =
                    javax.imageio.ImageIO.createImageInputStream(
                            new java.io.ByteArrayInputStream(data))) {
                var readers = javax.imageio.ImageIO.getImageReaders(input);
                if (!readers.hasNext()) throw new IllegalStateException();
                var reader = readers.next();
                try {
                    reader.setInput(input);
                    if ((long) reader.getWidth(0) * reader.getHeight(0) > 24000000)
                        throw new IllegalStateException();
                } finally {
                    reader.dispose();
                }
            }
            var image = javax.imageio.ImageIO.read(new java.io.ByteArrayInputStream(data));
            if (image == null) throw new IllegalStateException();
            var out = new java.io.ByteArrayOutputStream();
            javax.imageio.ImageIO.write(image, "png", out);
            image.flush();
            data = out.toByteArray();
            if (data.length > 12 * 1024 * 1024) throw new IllegalStateException();
            String name = "asset-" + task.getId() + ".png",
                    key = pptx.buildPhysicalPath(project(), task.getParentFolderId(), name);
            for (var existing : files.getFilesByParent(project(), task.getParentFolderId())) {
                if (name.equals(existing.getName())
                        && !Boolean.TRUE.equals(existing.getIsDeleted())
                        && !Objects.equals(existing.getWpsFileId(), "asset_" + task.getId()))
                    throw new IllegalStateException();
            }
            Long projectId = project();
            quota.requireProjectCapacity(projectId, data.length);
            Path target = storage.resolve(key);
            Files.createDirectories(target.getParent());
            if (!Files.exists(target)) {
                try (var output = Files.newOutputStream(target, StandardOpenOption.CREATE_NEW)) {
                    // Register after CREATE_NEW establishes ownership, before writing any bytes.
                    // Cleanup rechecks database references under the existing storage owner lock.
                    org.springframework.transaction.support.TransactionSynchronizationManager
                            .registerSynchronization(
                                    new org.springframework.transaction.support.TransactionSynchronization() {
                                        @Override
                                        public void afterCompletion(int status) {
                                            if (status == STATUS_COMMITTED) return;
                                            try { quota.removeRolledBackFile(projectId, key); }
                                            catch (Exception cleanupError) {
                                                log.error("Asset rollback could not remove new file: {}", key, cleanupError);
                                            }
                                        }
                                    });
                    output.write(data);
                }
            } else if (Files.size(target) != data.length
                    || !java.security.MessageDigest.isEqual(Files.readAllBytes(target), data))
                throw new IllegalStateException();
            var file =
                    files.createOrUpdateFile(
                            project(),
                            task.getParentFolderId(),
                            name,
                            "png",
                            Files.size(target),
                            key,
                            "asset_" + task.getId(),
                            user());
            task.setOutputFileId(file.getId());
            tasks.saveAndFlush(task);
            editor.sendRefreshFilesAction();
            return GeneratedFileLocation.createdResult(
                    file, LangText.of("图片素材已生成", "Image asset generated"));
        } catch (Exception e) {
            throw new IllegalStateException("Asset import did not complete", e);
        }
    }
}
