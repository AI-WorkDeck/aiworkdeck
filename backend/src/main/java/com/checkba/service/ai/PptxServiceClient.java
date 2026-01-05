package com.checkba.service.ai;

import cn.hutool.http.HttpRequest;
import cn.hutool.http.HttpResponse;
import cn.hutool.json.JSONArray;
import cn.hutool.json.JSONObject;
import cn.hutool.json.JSONUtil;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.List;
import java.util.Map;
import java.util.function.BiConsumer;

/**
 * PPTX 服务客户端
 * 
 * 封装对 banana-slides Python 微服务的 HTTP 调用。
 * banana-slides 服务运行在 Docker 容器中，提供 AI 驱动的 PPTX 生成能力。
 * 
 * 核心 API:
 * - POST /api/projects - 创建项目
 * - POST /api/projects/{id}/generate/outline - 生成大纲
 * - POST /api/projects/{id}/generate/descriptions - 生成描述
 * - POST /api/projects/{id}/generate/images - 生成幻灯片图片
 * - GET /api/projects/{id}/export/pptx - 导出 PPTX
 */
@Service
public class PptxServiceClient {

    private static final org.slf4j.Logger log = org.slf4j.LoggerFactory.getLogger(PptxServiceClient.class);

    @Value("${external.pptx-service.base-url:http://localhost:5001}")
    private String baseUrl;

    @Value("${external.pptx-service.timeout:120}")
    private int timeoutSeconds;

    private static final int POLL_INTERVAL_MS = 2000; // 轮询间隔 2 秒
    private static final int MAX_POLL_ATTEMPTS = 300;  // 最大轮询次数 (10 分钟)

    /**
     * Progress callback interface for reporting generation progress.
     * Called at each stage of PPTX generation to report progress and status.
     */
    @FunctionalInterface
    public interface ProgressCallback {
        /**
         * Called when progress is made during PPTX generation.
         * 
         * @param progress Progress percentage (0-100)
         * @param stage Current stage identifier (e.g., "creating_project", "generating_outline")
         * @param message Human-readable progress message
         */
        void onProgress(int progress, String stage, String message);
    }

    /**
     * 健康检查
     */
    public boolean isHealthy() {
        try {
            HttpResponse resp = HttpRequest.get(baseUrl + "/health")
                    .timeout(5000)
                    .execute();
            return resp.getStatus() == 200;
        } catch (Exception e) {
            log.warn("PPTX service health check failed: {}", e.getMessage());
            return false;
        }
    }

    /**
     * 创建 PPTX 项目
     * 
     * @param topic PPT 主题/想法
     * @return 项目 ID
     */
    public String createProject(String topic) {
        log.info("Creating PPTX project with topic: {}", topic.length() > 50 ? topic.substring(0, 50) + "..." : topic);
        
        JSONObject body = new JSONObject();
        body.set("creation_type", "idea");
        body.set("idea_prompt", topic);
        
        HttpResponse resp = HttpRequest.post(baseUrl + "/api/projects")
                .header("Content-Type", "application/json")
                .body(body.toString())
                .timeout(timeoutSeconds * 1000)
                .execute();
        
        if (resp.getStatus() != 201 && resp.getStatus() != 200) {
            throw new RuntimeException("Failed to create project: " + resp.body());
        }
        
        JSONObject result = JSONUtil.parseObj(resp.body());
        String projectId = result.getJSONObject("data").getStr("project_id");
        log.info("PPTX project created: {}", projectId);
        return projectId;
    }

    /**
     * 生成大纲
     * 
     * @param projectId 项目 ID
     * @param language 输出语言 (zh/en/ja/auto)
     * @param modelConfig 模型配置（可选）
     * @return 生成的页面列表
     */
    public JSONArray generateOutline(String projectId, String language, ModelConfig modelConfig) {
        log.info("Generating outline for project: {}", projectId);
        
        JSONObject body = new JSONObject();
        body.set("language", language != null ? language : "zh");
        
        // 添加模型配置（如果提供）
        if (modelConfig != null) {
            body.set("model_config", modelConfig.toJson());
        }
        
        HttpResponse resp = HttpRequest.post(baseUrl + "/api/projects/" + projectId + "/generate/outline")
                .header("Content-Type", "application/json")
                .body(body.toString())
                .timeout(timeoutSeconds * 1000)
                .execute();
        
        if (resp.getStatus() != 200) {
            throw new RuntimeException("Failed to generate outline: " + resp.body());
        }
        
        JSONObject result = JSONUtil.parseObj(resp.body());
        JSONArray pages = result.getJSONObject("data").getJSONArray("pages");
        log.info("Outline generated: {} pages", pages.size());
        return pages;
    }

    /**
     * 生成描述（异步，需要轮询）
     * 
     * @param projectId 项目 ID
     * @param language 输出语言
     * @param modelConfig 模型配置（可选）
     * @return 任务 ID
     */
    public String startGenerateDescriptions(String projectId, String language, ModelConfig modelConfig) {
        log.info("Starting description generation for project: {}", projectId);
        
        JSONObject body = new JSONObject();
        body.set("language", language != null ? language : "zh");
        body.set("max_workers", 5);
        
        // 添加模型配置（如果提供）
        if (modelConfig != null) {
            body.set("model_config", modelConfig.toJson());
        }
        
        HttpResponse resp = HttpRequest.post(baseUrl + "/api/projects/" + projectId + "/generate/descriptions")
                .header("Content-Type", "application/json")
                .body(body.toString())
                .timeout(timeoutSeconds * 1000)
                .execute();
        
        if (resp.getStatus() != 202 && resp.getStatus() != 200) {
            throw new RuntimeException("Failed to start description generation: " + resp.body());
        }
        
        JSONObject result = JSONUtil.parseObj(resp.body());
        String taskId = result.getJSONObject("data").getStr("task_id");
        log.info("Description generation started, task_id: {}", taskId);
        return taskId;
    }

    /**
     * 生成图片（异步，需要轮询）
     * 
     * @param projectId 项目 ID
     * @param language 输出语言
     * @param templateStyle 风格描述（可选）
     * @param modelConfig 模型配置（可选）
     * @return 任务 ID
     */
    public String startGenerateImages(String projectId, String language, String templateStyle, ModelConfig modelConfig) {
        log.info("Starting image generation for project: {}", projectId);
        
        JSONObject body = new JSONObject();
        body.set("language", language != null ? language : "zh");
        body.set("max_workers", 8);
        body.set("use_template", true);
        
        // 添加模型配置（如果提供）
        if (modelConfig != null) {
            body.set("model_config", modelConfig.toJson());
        }
        
        HttpResponse resp = HttpRequest.post(baseUrl + "/api/projects/" + projectId + "/generate/images")
                .header("Content-Type", "application/json")
                .body(body.toString())
                .timeout(timeoutSeconds * 1000)
                .execute();
        
        if (resp.getStatus() != 202 && resp.getStatus() != 200) {
            throw new RuntimeException("Failed to start image generation: " + resp.body());
        }
        
        JSONObject result = JSONUtil.parseObj(resp.body());
        String taskId = result.getJSONObject("data").getStr("task_id");
        log.info("Image generation started, task_id: {}", taskId);
        return taskId;
    }

    /**
     * 查询任务状态
     * 
     * @param projectId 项目 ID
     * @param taskId 任务 ID
     * @return 任务状态对象
     */
    public JSONObject getTaskStatus(String projectId, String taskId) {
        HttpResponse resp = HttpRequest.get(baseUrl + "/api/projects/" + projectId + "/tasks/" + taskId)
                .timeout(10000)
                .execute();
        
        if (resp.getStatus() != 200) {
            throw new RuntimeException("Failed to get task status: " + resp.body());
        }
        
        return JSONUtil.parseObj(resp.body()).getJSONObject("data");
    }

    /**
     * 等待任务完成
     * 
     * @param projectId 项目 ID
     * @param taskId 任务 ID
     * @return 任务最终状态对象 (JSON)，如果失败或超时返回 null
     */
    public JSONObject waitForTask(String projectId, String taskId) {
        log.info("Waiting for task {} to complete...", taskId);
        
        for (int i = 0; i < MAX_POLL_ATTEMPTS; i++) {
            try {
                Thread.sleep(POLL_INTERVAL_MS);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return null;
            }
            
            JSONObject status = getTaskStatus(projectId, taskId);
            String taskStatus = status.getStr("status");
            
            if ("COMPLETED".equals(taskStatus)) {
                // 额外验证：检查是否有实际完成的项目
                JSONObject progress = status.getJSONObject("progress");
                if (progress != null) {
                    int completed = progress.getInt("completed", 0);
                    int total = progress.getInt("total", 0);
                    
                    if (completed == 0 && total > 0) {
                        // 任务状态是完成，但没有任何成功项目，视为失败
                        log.error("Task {} marked as COMPLETED but no items succeeded (0/{})", taskId, total);
                        return null;
                    }
                    
                    log.info("Task {} completed successfully: {}/{}", taskId, completed, total);
                } else {
                    log.info("Task {} completed successfully", taskId);
                }
                return status;
            } else if ("FAILED".equals(taskStatus)) {
                String error = status.getStr("error_message");
                log.error("Task {} failed: {}", taskId, error);
                return null;
            }
            
            // 打印进度
            JSONObject progress = status.getJSONObject("progress");
            if (progress != null) {
                log.debug("Task {} progress: {}/{}", taskId, 
                        progress.getInt("completed", 0), 
                        progress.getInt("total", 0));
            }
        }
        
        log.error("Task {} timed out after {} attempts", taskId, MAX_POLL_ATTEMPTS);
        return null;
    }

    /**
     * 导出 PPTX
     * 
     * @param projectId 项目 ID
     * @param filename 文件名
     * @return 下载 URL
     */
    public String exportPptx(String projectId, String filename) {
        log.info("Exporting PPTX for project: {}", projectId);
        
        String url = baseUrl + "/api/projects/" + projectId + "/export/pptx";
        if (filename != null && !filename.isEmpty()) {
            url += "?filename=" + filename;
        }
        
        HttpResponse resp = HttpRequest.get(url)
                .timeout(timeoutSeconds * 1000)
                .execute();
        
        if (resp.getStatus() != 200) {
            throw new RuntimeException("Failed to export PPTX: " + resp.body());
        }
        
        JSONObject result = JSONUtil.parseObj(resp.body());
        String downloadUrl = result.getJSONObject("data").getStr("download_url");
        log.info("PPTX exported, download URL: {}", downloadUrl);
        return downloadUrl;
    }

    /**
     * 下载 PPTX 文件到本地
     * 
     * @param downloadUrl 下载路径（相对路径）
     * @param localPath 本地保存路径
     * @return 保存的文件路径
     */
    public String downloadPptx(String downloadUrl, String localPath) {
        log.info("Downloading PPTX from {} to {}", downloadUrl, localPath);
        
        String fullUrl = baseUrl + downloadUrl;
        
        HttpResponse resp = HttpRequest.get(fullUrl)
                .timeout(timeoutSeconds * 1000)
                .execute();
        
        if (resp.getStatus() != 200) {
            throw new RuntimeException("Failed to download PPTX: HTTP " + resp.getStatus());
        }
        
        try {
            Path path = Paths.get(localPath);
            Files.createDirectories(path.getParent());
            
            try (FileOutputStream fos = new FileOutputStream(localPath)) {
                fos.write(resp.bodyBytes());
            }
            
            log.info("PPTX downloaded to: {}", localPath);
            return localPath;
        } catch (Exception e) {
            throw new RuntimeException("Failed to save PPTX: " + e.getMessage(), e);
        }
    }

    /**
     * 一键生成 PPTX（同步版本）- 默认导出可编辑版本
     * 
     * 这是一个便捷方法，封装了完整的生成流程：
     * 1. 创建项目
     * 2. 生成大纲
     * 3. 生成描述（等待完成）
     * 4. 生成图片（等待完成）
     * 5. 导出 PPTX（可编辑版本）
     * 6. 下载到本地
     * 
     * @param topic PPT 主题
     * @param language 输出语言
     * @param templateStyle 风格描述（可选）
     * @param localSavePath 本地保存路径
     * @param modelConfig 模型配置（可选，用于传递用户选择的模型）
     * @return 生成结果
     */
    public PptxGenerationResult generatePptxSync(String topic, String language, 
                                                  String templateStyle, String localSavePath,
                                                  ModelConfig modelConfig) {
        // 默认导出可编辑版本
        return generatePptxSync(topic, language, templateStyle, localSavePath, modelConfig, true);
    }
    
    /**
     * 一键生成 PPTX（同步版本）- 可选择导出类型
     * 
     * 这是一个便捷方法，封装了完整的生成流程：
     * 1. 创建项目
     * 2. 生成大纲
     * 3. 生成描述（等待完成）
     * 4. 生成图片（等待完成）
     * 5. 导出 PPTX（根据 exportEditable 参数选择可编辑或纯图片版本）
     * 6. 下载到本地
     * 
     * @param topic PPT 主题
     * @param language 输出语言
     * @param templateStyle 风格描述（可选）
     * @param localSavePath 本地保存路径
     * @param modelConfig 模型配置（可选，用于传递用户选择的模型）
     * @param exportEditable 是否导出可编辑版本（true=可编辑，false=纯图片）
     * @return 生成结果
     */
    public PptxGenerationResult generatePptxSync(String topic, String language, 
                                                  String templateStyle, String localSavePath,
                                                  ModelConfig modelConfig, boolean exportEditable) {
        log.info("Starting synchronous PPTX generation: {}, exportEditable={}", 
                topic.length() > 50 ? topic.substring(0, 50) + "..." : topic, exportEditable);
        if (modelConfig != null) {
            log.info("Using model config: provider={}, textModel={}, imageModel={}", 
                    modelConfig.getProvider(), modelConfig.getTextModel(), modelConfig.getImageModel());
        }
        
        PptxGenerationResult result = new PptxGenerationResult();
        
        try {
            // 1. 创建项目
            String projectId = createProject(topic);
            result.setProjectId(projectId);
            
            // 2. 生成大纲（传递模型配置）
            JSONArray pages = generateOutline(projectId, language, modelConfig);
            result.setPagesCount(pages.size());
            
            // 3. 生成描述（传递模型配置）
            String descTaskId = startGenerateDescriptions(projectId, language, modelConfig);
            JSONObject descTaskResult = waitForTask(projectId, descTaskId);
            if (descTaskResult == null) {
                result.setSuccess(false);
                result.setError("Description generation failed");
                return result;
            }
            
            // 4. 生成图片（传递模型配置）
            String imgTaskId = startGenerateImages(projectId, language, templateStyle, modelConfig);
            JSONObject imgTaskResult = waitForTask(projectId, imgTaskId);
            if (imgTaskResult == null) {
                result.setSuccess(false);
                result.setError("Image generation failed");
                return result;
            }
            
            // 提取警告信息
            if (imgTaskResult.containsKey("progress")) {
                JSONObject progress = imgTaskResult.getJSONObject("progress");
                if (progress.containsKey("warnings")) {
                    JSONArray warningsJson = progress.getJSONArray("warnings");
                    if (warningsJson != null && !warningsJson.isEmpty()) {
                        result.setWarnings(warningsJson.toList(String.class));
                    }
                }
            }
            
            // 5. 导出 PPTX（根据参数选择可编辑或纯图片版本）
            String filename = "presentation_" + projectId + ".pptx";
            String downloadUrl;
            
            if (exportEditable) {
                // 导出可编辑版本（使用 MinerU 解析）
                // 传递模型配置用于生成干净背景图
                log.info("Exporting editable PPTX for project: {}", projectId);
                try {
                    String editableTaskId = startExportEditable(projectId, filename, modelConfig);
                    JSONObject editableTaskResult = waitForTask(projectId, editableTaskId);
                    
                    if (editableTaskResult != null) {
                        JSONObject editableProgress = editableTaskResult.getJSONObject("progress");
                        if (editableProgress != null) {
                            downloadUrl = editableProgress.getStr("download_url");
                            String exportedFilename = editableProgress.getStr("filename");
                            if (exportedFilename != null) {
                                filename = exportedFilename;
                            }
                            result.setEditable(true);
                            log.info("Editable PPTX export completed: {}", downloadUrl);
                        } else {
                            // 可编辑导出失败，回退到纯图片版本
                            log.warn("Editable export task completed but no progress info, falling back to image-only export");
                            downloadUrl = exportPptx(projectId, filename);
                            result.setEditable(false);
                        }
                    } else {
                        // 可编辑导出失败，回退到纯图片版本
                        log.warn("Editable export failed, falling back to image-only export");
                        downloadUrl = exportPptx(projectId, filename);
                        result.setEditable(false);
                    }
                } catch (Exception e) {
                    // 可编辑导出异常，回退到纯图片版本
                    log.warn("Editable export exception: {}, falling back to image-only export", e.getMessage());
                    downloadUrl = exportPptx(projectId, filename);
                    result.setEditable(false);
                }
            } else {
                // 导出纯图片版本
                downloadUrl = exportPptx(projectId, filename);
                result.setEditable(false);
            }
            
            result.setDownloadUrl(downloadUrl);
            
            // 6. 下载到本地
            if (localSavePath != null && !localSavePath.isEmpty()) {
                String savedPath = downloadPptx(downloadUrl, localSavePath);
                result.setLocalPath(savedPath);
            }
            
            result.setSuccess(true);
            log.info("PPTX generation completed successfully: {}, editable={}", result.getLocalPath(), result.isEditable());
            
        } catch (Exception e) {
            log.error("PPTX generation failed", e);
            result.setSuccess(false);
            result.setError(e.getMessage());
        }
        
        return result;
    }

    /**
     * 一键生成 PPTX（带进度回调）
     * 
     * 在生成过程中会调用进度回调函数报告每个阶段的进度：
     * - 2%: 创建项目
     * - 10%: 生成大纲
     * - 25%: 生成描述 (10% 起步，根据任务进度递增到 25%)
     * - 70%: 生成图片 (25% 起步，根据任务进度递增到 70%)
     * - 95%: 导出 PPTX
     * - 100%: 完成
     * 
     * @param topic PPT 主题
     * @param language 输出语言
     * @param templateStyle 风格描述（可选）
     * @param localSavePath 本地保存路径
     * @param modelConfig 模型配置（可选）
     * @param exportEditable 是否导出可编辑版本
     * @param progressCallback 进度回调函数（可选）
     * @return 生成结果
     */
    public PptxGenerationResult generatePptxWithProgress(String topic, String language, 
                                                          String templateStyle, String localSavePath,
                                                          ModelConfig modelConfig, boolean exportEditable,
                                                          ProgressCallback progressCallback) {
        log.info("Starting PPTX generation with progress: {}, exportEditable={}", 
                topic.length() > 50 ? topic.substring(0, 50) + "..." : topic, exportEditable);
        if (modelConfig != null) {
            log.info("Using model config: provider={}, textModel={}, imageModel={}", 
                    modelConfig.getProvider(), modelConfig.getTextModel(), modelConfig.getImageModel());
        }
        
        PptxGenerationResult result = new PptxGenerationResult();
        
        // Helper to report progress safely
        java.util.function.BiConsumer<Integer, String[]> reportProgress = (progress, stageMsg) -> {
            if (progressCallback != null) {
                try {
                    progressCallback.onProgress(progress, stageMsg[0], stageMsg[1]);
                } catch (Exception e) {
                    log.warn("Progress callback failed: {}", e.getMessage());
                }
            }
        };
        
        try {
            // 1. 创建项目 (2%)
            reportProgress.accept(2, new String[]{"creating_project", "正在创建 PPT 项目..."});
            String projectId = createProject(topic);
            result.setProjectId(projectId);
            
            // 2. 生成大纲 (10%)
            reportProgress.accept(5, new String[]{"generating_outline", "正在生成演示文稿大纲..."});
            JSONArray pages = generateOutline(projectId, language, modelConfig);
            result.setPagesCount(pages.size());
            reportProgress.accept(10, new String[]{"generating_outline", "大纲生成完成，共 " + pages.size() + " 页"});
            
            // 3. 生成描述 (10% -> 25%)
            reportProgress.accept(12, new String[]{"generating_descriptions", "正在生成页面内容描述..."});
            String descTaskId = startGenerateDescriptions(projectId, language, modelConfig);
            JSONObject descTaskResult = waitForTaskWithProgress(projectId, descTaskId, 10, 25, 
                    "generating_descriptions", "正在生成页面描述", progressCallback);
            if (descTaskResult == null) {
                result.setSuccess(false);
                result.setError("Description generation failed");
                return result;
            }
            reportProgress.accept(25, new String[]{"generating_descriptions", "页面描述生成完成"});
            
            // 4. 生成图片 (25% -> 70%)
            reportProgress.accept(27, new String[]{"generating_images", "正在生成幻灯片图片..."});
            String imgTaskId = startGenerateImages(projectId, language, templateStyle, modelConfig);
            JSONObject imgTaskResult = waitForTaskWithProgress(projectId, imgTaskId, 25, 70, 
                    "generating_images", "正在生成幻灯片图片", progressCallback);
            if (imgTaskResult == null) {
                result.setSuccess(false);
                result.setError("Image generation failed");
                return result;
            }
            
            // 提取警告信息
            if (imgTaskResult.containsKey("progress")) {
                JSONObject progress = imgTaskResult.getJSONObject("progress");
                if (progress.containsKey("warnings")) {
                    JSONArray warningsJson = progress.getJSONArray("warnings");
                    if (warningsJson != null && !warningsJson.isEmpty()) {
                        result.setWarnings(warningsJson.toList(String.class));
                    }
                }
            }
            reportProgress.accept(70, new String[]{"generating_images", "幻灯片图片生成完成"});
            
            // 5. 导出 PPTX (70% -> 95%)
            reportProgress.accept(72, new String[]{"exporting_pptx", "正在导出 PPTX 文件..."});
            String filename = "presentation_" + projectId + ".pptx";
            String downloadUrl;
            
            if (exportEditable) {
                reportProgress.accept(75, new String[]{"exporting_pptx", "正在生成可编辑版本..."});
                try {
                    String editableTaskId = startExportEditable(projectId, filename, modelConfig);
                    JSONObject editableTaskResult = waitForTaskWithProgress(projectId, editableTaskId, 75, 95, 
                            "exporting_pptx", "正在导出可编辑版本", progressCallback);
                    
                    if (editableTaskResult != null) {
                        JSONObject editableProgress = editableTaskResult.getJSONObject("progress");
                        if (editableProgress != null) {
                            downloadUrl = editableProgress.getStr("download_url");
                            String exportedFilename = editableProgress.getStr("filename");
                            if (exportedFilename != null) {
                                filename = exportedFilename;
                            }
                            result.setEditable(true);
                        } else {
                            log.warn("Editable export completed but no progress info, falling back");
                            downloadUrl = exportPptx(projectId, filename);
                            result.setEditable(false);
                        }
                    } else {
                        log.warn("Editable export failed, falling back to image-only export");
                        downloadUrl = exportPptx(projectId, filename);
                        result.setEditable(false);
                    }
                } catch (Exception e) {
                    log.warn("Editable export exception: {}, falling back", e.getMessage());
                    downloadUrl = exportPptx(projectId, filename);
                    result.setEditable(false);
                }
            } else {
                downloadUrl = exportPptx(projectId, filename);
                result.setEditable(false);
            }
            
            result.setDownloadUrl(downloadUrl);
            reportProgress.accept(95, new String[]{"exporting_pptx", "PPTX 导出完成"});
            
            // 6. 下载到本地 (95% -> 100%)
            if (localSavePath != null && !localSavePath.isEmpty()) {
                reportProgress.accept(97, new String[]{"downloading", "正在保存文件到本地..."});
                String savedPath = downloadPptx(downloadUrl, localSavePath);
                result.setLocalPath(savedPath);
            }
            
            result.setSuccess(true);
            reportProgress.accept(100, new String[]{"completed", "PPTX 生成完成！"});
            log.info("PPTX generation with progress completed: {}, editable={}", result.getLocalPath(), result.isEditable());
            
        } catch (Exception e) {
            log.error("PPTX generation failed", e);
            result.setSuccess(false);
            result.setError(e.getMessage());
        }
        
        return result;
    }

    /**
     * 等待任务完成并报告进度
     * 
     * @param projectId 项目 ID
     * @param taskId 任务 ID
     * @param startProgress 起始进度百分比
     * @param endProgress 结束进度百分比
     * @param stage 阶段标识
     * @param baseMessage 基础消息
     * @param progressCallback 进度回调（可选）
     * @return 任务最终状态
     */
    private JSONObject waitForTaskWithProgress(String projectId, String taskId, 
                                                int startProgress, int endProgress,
                                                String stage, String baseMessage,
                                                ProgressCallback progressCallback) {
        log.info("Waiting for task {} with progress reporting ({} -> {})", taskId, startProgress, endProgress);
        
        for (int i = 0; i < MAX_POLL_ATTEMPTS; i++) {
            try {
                Thread.sleep(POLL_INTERVAL_MS);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return null;
            }
            
            JSONObject status = getTaskStatus(projectId, taskId);
            String taskStatus = status.getStr("status");
            
            // 计算并报告进度
            JSONObject taskProgress = status.getJSONObject("progress");
            if (taskProgress != null && progressCallback != null) {
                int completed = taskProgress.getInt("completed", 0);
                int total = taskProgress.getInt("total", 1);
                
                // 计算在 startProgress 到 endProgress 范围内的进度
                double taskPercent = total > 0 ? (double) completed / total : 0;
                int currentProgress = startProgress + (int) ((endProgress - startProgress) * taskPercent);
                
                String message = String.format("%s (%d/%d)", baseMessage, completed, total);
                try {
                    progressCallback.onProgress(currentProgress, stage, message);
                } catch (Exception e) {
                    log.warn("Progress callback failed: {}", e.getMessage());
                }
            }
            
            if ("COMPLETED".equals(taskStatus)) {
                if (taskProgress != null) {
                    int completed = taskProgress.getInt("completed", 0);
                    int total = taskProgress.getInt("total", 0);
                    
                    if (completed == 0 && total > 0) {
                        log.error("Task {} marked as COMPLETED but no items succeeded (0/{})", taskId, total);
                        return null;
                    }
                    log.info("Task {} completed successfully: {}/{}", taskId, completed, total);
                }
                return status;
            } else if ("FAILED".equals(taskStatus)) {
                String error = status.getStr("error_message");
                log.error("Task {} failed: {}", taskId, error);
                return null;
            }
        }
        
        log.error("Task {} timed out after {} attempts", taskId, MAX_POLL_ATTEMPTS);
        return null;
    }

    /**
     * 编辑页面图片
     * 
     * @param projectId 项目 ID
     * @param pageId 页面 ID
     * @param editInstruction 编辑指令（自然语言）
     * @return 任务 ID
     */
    public String editPageImage(String projectId, String pageId, String editInstruction) {
        log.info("Editing page image: projectId={}, pageId={}, instruction={}", 
                projectId, pageId, editInstruction.length() > 50 ? editInstruction.substring(0, 50) + "..." : editInstruction);
        
        JSONObject body = new JSONObject();
        body.set("edit_instruction", editInstruction);
        
        HttpResponse resp = HttpRequest.post(baseUrl + "/api/projects/" + projectId + "/pages/" + pageId + "/edit/image")
                .header("Content-Type", "application/json")
                .body(body.toString())
                .timeout(timeoutSeconds * 1000)
                .execute();
        
        if (resp.getStatus() != 202 && resp.getStatus() != 200) {
            throw new RuntimeException("Failed to start page edit: " + resp.body());
        }
        
        JSONObject result = JSONUtil.parseObj(resp.body());
        String taskId = result.getJSONObject("data").getStr("task_id");
        log.info("Page edit started, task_id: {}", taskId);
        return taskId;
    }

    /**
     * 获取项目详情（包含页面列表）
     * 
     * @param projectId 项目 ID
     * @return 项目信息（包含 pages 数组）
     */
    public JSONObject getProjectWithPages(String projectId) {
        log.info("Getting project with pages: {}", projectId);
        
        HttpResponse resp = HttpRequest.get(baseUrl + "/api/projects/" + projectId)
                .timeout(timeoutSeconds * 1000)
                .execute();
        
        if (resp.getStatus() != 200) {
            throw new RuntimeException("Failed to get project: " + resp.body());
        }
        
        JSONObject result = JSONUtil.parseObj(resp.body());
        return result.getJSONObject("data");
    }

    /**
     * 获取页面截图
     * 
     * @param pptxFilePath 本地 PPTX 文件路径
     * @param pageIndex 页面索引（从 0 开始）
     * @return 截图 URL
     */
    public String getPageScreenshot(String pptxFilePath, int pageIndex) {
        log.info("Getting page screenshot: file={}, pageIndex={}", pptxFilePath, pageIndex);
        
        // 上传文件并获取截图
        // 注意：这是一个简化实现，实际可能需要先上传文件到服务
        HttpResponse resp = HttpRequest.post(baseUrl + "/api/files/screenshot")
                .form("file", new java.io.File(pptxFilePath))
                .form("page_index", pageIndex)
                .timeout(timeoutSeconds * 1000)
                .execute();
        
        if (resp.getStatus() != 200) {
            throw new RuntimeException("Failed to get screenshot: " + resp.body());
        }
        
        JSONObject result = JSONUtil.parseObj(resp.body());
        return result.getJSONObject("data").getStr("screenshot_url");
    }

    /**
     * 修改大纲
     * 
     * @param projectId 项目 ID
     * @param userRequirement 用户修改要求
     * @param language 输出语言
     * @return 修改后的页面列表
     */
    public JSONObject refineOutline(String projectId, String userRequirement, String language) {
        log.info("Refining outline: projectId={}, requirement={}", 
                projectId, userRequirement.length() > 50 ? userRequirement.substring(0, 50) + "..." : userRequirement);
        
        JSONObject body = new JSONObject();
        body.set("user_requirement", userRequirement);
        body.set("language", language != null ? language : "zh");
        
        HttpResponse resp = HttpRequest.post(baseUrl + "/api/projects/" + projectId + "/refine/outline")
                .header("Content-Type", "application/json")
                .body(body.toString())
                .timeout(timeoutSeconds * 1000)
                .execute();
        
        if (resp.getStatus() != 200) {
            throw new RuntimeException("Failed to refine outline: " + resp.body());
        }
        
        JSONObject result = JSONUtil.parseObj(resp.body());
        return result.getJSONObject("data");
    }

    /**
     * 启动可编辑 PPTX 导出任务（无模型配置，使用默认配置）
     * 
     * @param projectId 项目 ID
     * @param filename 文件名（可选）
     * @return 任务 ID
     * @deprecated 推荐使用 {@link #startExportEditable(String, String, ModelConfig)} 传递模型配置
     */
    @Deprecated
    public String startExportEditable(String projectId, String filename) {
        return startExportEditable(projectId, filename, null);
    }
    
    /**
     * 启动可编辑 PPTX 导出任务
     * 
     * 可编辑导出需要调用 AI 生成干净背景图（移除文字），因此需要传递支持图片生成的模型配置。
     * 
     * @param projectId 项目 ID
     * @param filename 文件名（可选）
     * @param modelConfig 模型配置（用于生成干净背景图），如果为 null 则使用 pptx-service 默认配置
     * @return 任务 ID
     */
    public String startExportEditable(String projectId, String filename, ModelConfig modelConfig) {
        log.info("Starting editable PPTX export: projectId={}, filename={}, hasModelConfig={}", 
                projectId, filename, modelConfig != null);
        
        JSONObject body = new JSONObject();
        if (filename != null && !filename.isEmpty()) {
            body.set("filename", filename);
        }
        
        // 添加模型配置（用于生成干净背景图）
        if (modelConfig != null) {
            body.set("model_config", modelConfig.toJson());
            log.info("Using model config for editable export: provider={}, imageModel={}", 
                    modelConfig.getProvider(), modelConfig.getImageModel());
        }
        
        HttpResponse resp = HttpRequest.post(baseUrl + "/api/projects/" + projectId + "/export/editable-pptx")
                .header("Content-Type", "application/json")
                .body(body.toString())
                .timeout(timeoutSeconds * 1000)
                .execute();
        
        if (resp.getStatus() != 200 && resp.getStatus() != 202) {
            throw new RuntimeException("Failed to start editable export: " + resp.body());
        }
        
        JSONObject result = JSONUtil.parseObj(resp.body());
        String taskId = result.getJSONObject("data").getStr("task_id");
        log.info("Editable export started, task_id: {}", taskId);
        return taskId;
    }

    /**
     * PPTX 生成结果
     */
    public static class PptxGenerationResult {
        private boolean success;
        private String projectId;
        private int pagesCount;
        private String downloadUrl;
        private String localPath;
        private String error;
        private List<String> warnings;
        /** 是否为可编辑版本（true=文字/表格可编辑，false=纯图片版本） */
        private boolean editable;

        public boolean isSuccess() { return success; }
        public void setSuccess(boolean success) { this.success = success; }
        public String getProjectId() { return projectId; }
        public void setProjectId(String projectId) { this.projectId = projectId; }
        public int getPagesCount() { return pagesCount; }
        public void setPagesCount(int pagesCount) { this.pagesCount = pagesCount; }
        public String getDownloadUrl() { return downloadUrl; }
        public void setDownloadUrl(String downloadUrl) { this.downloadUrl = downloadUrl; }
        public String getLocalPath() { return localPath; }
        public void setLocalPath(String localPath) { this.localPath = localPath; }
        public String getError() { return error; }
        public void setError(String error) { this.error = error; }
        public List<String> getWarnings() { return warnings; }
        public void setWarnings(List<String> warnings) { this.warnings = warnings; }
        public boolean isEditable() { return editable; }
        public void setEditable(boolean editable) { this.editable = editable; }
    }

    /**
     * 独立图片编辑 - 编辑任意图片（不依赖于项目）
     * 用于编辑现有 PPT 的纯图片页面
     * 
     * @param imageUrl 原始图片 URL
     * @param editInstruction 编辑指令（自然语言）
     * @return 编辑结果
     */
    public StandaloneImageEditResult editStandaloneImage(String imageUrl, String editInstruction) {
        log.info("Editing standalone image: instruction={}", 
                editInstruction.length() > 50 ? editInstruction.substring(0, 50) + "..." : editInstruction);
        
        try {
            JSONObject body = new JSONObject();
            body.set("image_url", imageUrl);
            body.set("edit_instruction", editInstruction);
            
            HttpResponse resp = HttpRequest.post(baseUrl + "/api/projects/edit-standalone-image")
                    .header("Content-Type", "application/json")
                    .body(body.toString())
                    .timeout(timeoutSeconds * 2 * 1000)
                    .execute();
            
            if (resp.getStatus() != 200) {
                String errorBody = resp.body();
                log.error("Standalone image edit failed: status={}, body={}", resp.getStatus(), errorBody);
                return new StandaloneImageEditResult(false, null, "编辑图片失败: " + errorBody);
            }
            
            JSONObject result = JSONUtil.parseObj(resp.body());
            
            if (!result.getBool("success", false)) {
                return new StandaloneImageEditResult(false, null, result.getStr("message", "Unknown error"));
            }
            
            JSONObject data = result.getJSONObject("data");
            String editedImageUrl = data.getStr("image_url_absolute", data.getStr("image_url"));
            
            return new StandaloneImageEditResult(true, editedImageUrl, null);
            
        } catch (Exception e) {
            log.error("Standalone image edit exception", e);
            return new StandaloneImageEditResult(false, null, "编辑图片异常: " + e.getMessage());
        }
    }

    /**
     * 独立图片编辑结果
     */
    public static class StandaloneImageEditResult {
        private final boolean success;
        private final String editedImageUrl;
        private final String error;

        public StandaloneImageEditResult(boolean success, String editedImageUrl, String error) {
            this.success = success;
            this.editedImageUrl = editedImageUrl;
            this.error = error;
        }

        public boolean isSuccess() { return success; }
        public String getEditedImageUrl() { return editedImageUrl; }
        public String getError() { return error; }
    }

    /**
     * 编辑 PPTX 文件中的特定幻灯片
     * 
     * 上传 PPTX 文件，使用 AI 编辑指定页面，返回编辑后的文件
     * 
     * @param pptxFilePath 本地 PPTX 文件路径
     * @param slideIndex 页面索引（从 1 开始）
     * @param editInstruction 编辑指令（自然语言）
     * @param outputPath 输出文件路径（编辑后的 PPTX 保存位置）
     * @param modelConfig 模型配置（包含 API Key、模型名等，用于 AI 图片编辑）
     * @return 编辑结果
     */
    public PptxSlideEditResult editPptxSlide(String pptxFilePath, int slideIndex, 
                                               String editInstruction, String outputPath,
                                               ModelConfig modelConfig) {
        log.info("Editing PPTX slide: file={}, slideIndex={}, instruction={}", 
                pptxFilePath, slideIndex, 
                editInstruction.length() > 50 ? editInstruction.substring(0, 50) + "..." : editInstruction);
        if (modelConfig != null) {
            log.info("Using model config: provider={}, imageModel={}", 
                    modelConfig.getProvider(), modelConfig.getImageModel());
        }
        
        try {
            java.io.File pptxFile = new java.io.File(pptxFilePath);
            if (!pptxFile.exists()) {
                return new PptxSlideEditResult(false, null, "PPTX 文件不存在: " + pptxFilePath);
            }
            
            // 构建请求（上传文件 + 模型配置）
            HttpRequest request = HttpRequest.post(baseUrl + "/api/projects/edit-pptx-slide")
                    .form("pptx_file", pptxFile)
                    .form("slide_index", String.valueOf(slideIndex))
                    .form("edit_instruction", editInstruction);
            
            // 添加模型配置（如果提供）
            if (modelConfig != null) {
                request.form("model_config", modelConfig.toJson().toString());
            }
            
            // 执行请求
            HttpResponse resp = request
                    .timeout(timeoutSeconds * 3 * 1000)  // 延长超时时间
                    .execute();
            
            if (resp.getStatus() != 200) {
                String errorBody = resp.body();
                log.error("PPTX slide edit failed: status={}, body={}", resp.getStatus(), errorBody);
                return new PptxSlideEditResult(false, null, "编辑失败: " + errorBody);
            }
            
            JSONObject result = JSONUtil.parseObj(resp.body());
            
            if (!result.getBool("success", false)) {
                String message = result.getStr("message", "Unknown error");
                return new PptxSlideEditResult(false, null, message);
            }
            
            JSONObject data = result.getJSONObject("data");
            String downloadUrl = data.getStr("download_url");
            String downloadUrlAbsolute = data.getStr("download_url_absolute");
            String message = data.getStr("message", "Success");
            
            // 下载编辑后的文件
            if (downloadUrl != null && outputPath != null) {
                String fullDownloadUrl = downloadUrlAbsolute != null ? downloadUrlAbsolute : (baseUrl + downloadUrl);
                log.info("Downloading edited PPTX from: {}", fullDownloadUrl);
                
                HttpResponse downloadResp = HttpRequest.get(fullDownloadUrl)
                        .timeout(timeoutSeconds * 1000)
                        .execute();
                
                if (downloadResp.getStatus() != 200) {
                    return new PptxSlideEditResult(false, null, "下载编辑后的文件失败: HTTP " + downloadResp.getStatus());
                }
                
                try {
                    Path path = Paths.get(outputPath);
                    Files.createDirectories(path.getParent());
                    
                    try (FileOutputStream fos = new FileOutputStream(outputPath)) {
                        fos.write(downloadResp.bodyBytes());
                    }
                    
                    log.info("Edited PPTX saved to: {}", outputPath);
                    return new PptxSlideEditResult(true, outputPath, message);
                } catch (Exception e) {
                    return new PptxSlideEditResult(false, null, "保存文件失败: " + e.getMessage());
                }
            }
            
            return new PptxSlideEditResult(true, downloadUrlAbsolute != null ? downloadUrlAbsolute : downloadUrl, message);
            
        } catch (Exception e) {
            log.error("PPTX slide edit exception", e);
            return new PptxSlideEditResult(false, null, "编辑异常: " + e.getMessage());
        }
    }

    /**
     * PPTX 幻灯片编辑结果
     */
    public static class PptxSlideEditResult {
        private final boolean success;
        private final String outputPath;  // 本地文件路径或下载 URL
        private final String message;

        public PptxSlideEditResult(boolean success, String outputPath, String message) {
            this.success = success;
            this.outputPath = outputPath;
            this.message = message;
        }

        public boolean isSuccess() { return success; }
        public String getOutputPath() { return outputPath; }
        public String getMessage() { return message; }
    }

    /**
     * 模型配置
     * 用于传递给 PPTX 服务的 AI 模型设置
     */
    public static class ModelConfig {
        /** 提供商类型: "openai" 或 "gemini" */
        private String provider;
        /** API 密钥 */
        private String apiKey;
        /** API 基础 URL (如 https://openrouter.ai/api/v1) */
        private String apiBase;
        /** 文本生成模型名称 */
        private String textModel;
        /** 图片生成模型名称 (默认: gemini-3-pro-image-preview for Nano Banana Pro) */
        private String imageModel;

        public ModelConfig() {}

        public ModelConfig(String provider, String apiKey, String apiBase, String textModel, String imageModel) {
            this.provider = provider;
            this.apiKey = apiKey;
            this.apiBase = apiBase;
            this.textModel = textModel;
            this.imageModel = imageModel;
        }

        public String getProvider() { return provider; }
        public void setProvider(String provider) { this.provider = provider; }
        public String getApiKey() { return apiKey; }
        public void setApiKey(String apiKey) { this.apiKey = apiKey; }
        public String getApiBase() { return apiBase; }
        public void setApiBase(String apiBase) { this.apiBase = apiBase; }
        public String getTextModel() { return textModel; }
        public void setTextModel(String textModel) { this.textModel = textModel; }
        public String getImageModel() { return imageModel; }
        public void setImageModel(String imageModel) { this.imageModel = imageModel; }

        public static ModelConfigBuilder builder() {
            return new ModelConfigBuilder();
        }

        public static class ModelConfigBuilder {
            private String provider;
            private String apiKey;
            private String apiBase;
            private String textModel;
            private String imageModel;

            public ModelConfigBuilder provider(String provider) { this.provider = provider; return this; }
            public ModelConfigBuilder apiKey(String apiKey) { this.apiKey = apiKey; return this; }
            public ModelConfigBuilder apiBase(String apiBase) { this.apiBase = apiBase; return this; }
            public ModelConfigBuilder textModel(String textModel) { this.textModel = textModel; return this; }
            public ModelConfigBuilder imageModel(String imageModel) { this.imageModel = imageModel; return this; }
            public ModelConfig build() {
                return new ModelConfig(provider, apiKey, apiBase, textModel, imageModel);
            }
        }

        /**
         * 转换为 JSON 对象
         */
        public JSONObject toJson() {
            JSONObject json = new JSONObject();
            json.set("provider", provider != null ? provider : "openai");
            json.set("api_key", apiKey);
            json.set("api_base", apiBase);
            json.set("text_model", textModel);
            // 默认使用 Nano Banana Pro 进行图片生成
            json.set("image_model", imageModel != null ? imageModel : "gemini-3-pro-image-preview");
            return json;
        }
    }
}

