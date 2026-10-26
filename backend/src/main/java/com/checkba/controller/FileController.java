// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.controller;

import com.checkba.model.entity.ProjectFile;
import com.checkba.repository.ProjectFileRepository;
import com.checkba.service.ProjectMemberService;
import com.checkba.service.ai.AutoTaggingService;
import com.checkba.service.ai.ProjectRagService;
import com.checkba.storage.StorageException;
import com.checkba.storage.StorageService;
import com.checkba.storage.StorageServiceFactory;
import com.checkba.version.WorkSessionService;
import jakarta.servlet.http.HttpServletRequest;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.io.InputStreamResource;
import org.springframework.core.io.Resource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.util.StringUtils;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.multipart.MultipartHttpServletRequest;

import org.apache.tika.exception.TikaException;

import java.io.IOException;
import java.io.InputStream;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * WPS 文档实际存储与下载/上传接口
 */
@RestController
@RequestMapping("/api/files")
public class FileController {

    private static final org.slf4j.Logger log = org.slf4j.LoggerFactory.getLogger(FileController.class);

    @Autowired
    private com.checkba.service.ProjectFileContentService contentService;

    @Autowired
    private StorageServiceFactory storageServiceFactory;

    @Autowired
    private ProjectFileRepository projectFileRepository;
    
    @Autowired
    private ProjectRagService projectRagService;

    @Autowired
    private AutoTaggingService autoTaggingService;

    @Autowired
    private ProjectMemberService projectMemberService;

    @Autowired
    private WorkSessionService workSessionService;

    @Autowired
    private com.checkba.storage.ProjectStorageResolver storageResolver;

    @Autowired
    private com.checkba.service.DocumentTextService documentTextService;

    @Autowired
    private com.checkba.service.ProjectFileAccessService fileAccess;

    @Autowired
    private com.checkba.service.meeting.MeetingAudioTranscoder audioTranscoder;

    @Autowired(required = false)
    @org.springframework.beans.factory.annotation.Qualifier("taskExecutor")
    private java.util.concurrent.Executor taskExecutor;

    private static final java.util.concurrent.ExecutorService FALLBACK_UPLOAD_EXECUTOR =
            new java.util.concurrent.ThreadPoolExecutor(
                    2, 8, 60L, java.util.concurrent.TimeUnit.SECONDS,
                    new java.util.concurrent.LinkedBlockingQueue<>(256),
                    r -> {
                        Thread t = new Thread(r, "file-upload-postproc");
                        t.setDaemon(true);
                        return t;
                    },
                    new java.util.concurrent.ThreadPoolExecutor.CallerRunsPolicy());

    private java.util.concurrent.Executor asyncExecutor() {
        return taskExecutor != null ? taskExecutor : FALLBACK_UPLOAD_EXECUTOR;
    }

    /**
     * 文件的物理磁盘路径（「在 Finder 中显示」用）。
     */
    @GetMapping("/{fileId}/local-path")
    public ResponseEntity<Map<String, Object>> getLocalPath(
            @PathVariable("fileId") Long fileId,
            @RequestHeader(value = "X-Session-Id", required = false) String sessionHeader) {
        Optional<ProjectFile> pfOpt = projectFileRepository.findById(fileId);
        if (pfOpt.isEmpty()) {
            return ResponseEntity.ok(Map.of("code", 1, "message", com.checkba.service.LangText.of("文件不存在", "File not found")));
        }
        ProjectFile pf = pfOpt.get();
        if (!isAuthorizedForFile(null, sessionHeader, pf)) {
            return ResponseEntity.status(403).body(Map.of("code", 1, "message", com.checkba.service.ProjectFileAccessService.UNAVAILABLE_MESSAGE));
        }
        if (!org.springframework.util.StringUtils.hasText(pf.getFilePath())) {
            return ResponseEntity.ok(Map.of("code", 1, "message", com.checkba.service.LangText.of("该文件没有物理路径", "This file has no physical path")));
        }
        java.nio.file.Path p = storageResolver.resolve(pf.getFilePath());
        return ResponseEntity.ok(Map.of("code", 0, "data", Map.of(
                "path", p.toString(),
                "exists", java.nio.file.Files.exists(p))));
    }

    private StorageService getStorageService() {
        return storageServiceFactory.getStorageService();
    }

    /**
     * 校验调用者是否有权访问该文件所属项目。
     * 浏览器 &lt;a&gt; 下载无法设请求头，只能用 ?token=&lt;sessionId&gt;；fetch/XHR 走 X-Session-Id 头。
     * 两者取其一解析出 userId 后校验项目成员资格。此前这些接口完全无鉴权，可按数字 id 遍历下载他人文件。
     */
    private boolean isAuthorizedForFile(String token, String sessionHeader, ProjectFile file) {
        if (file == null) {
            return false;
        }
        String sid = StringUtils.hasText(sessionHeader) ? sessionHeader : token;
        Long userId = AuthController.getUserIdFromSession(sid);
        return fileAccess.canRead(file, userId);
    }

    /**
     * 写权限校验：只有 owner/ADMIN/PARTICIPANT 可改写项目文件字节，
     * READ_ONLY 成员与客户虽然读得到（文件可见）但不得覆盖。
     */
    private boolean isAuthorizedForWrite(String token, String sessionHeader, Long projectId) {
        if (projectId == null) {
            return false;
        }
        String sid = StringUtils.hasText(sessionHeader) ? sessionHeader : token;
        Long userId = AuthController.getUserIdFromSession(sid);
        return userId != null && projectMemberService.hasWritePermission(projectId, userId)
                && !fileAccess.isClient(projectId, userId);
    }

    /**
     * 通知版本记录：项目文件发生了变更（上传场景）。
     * 版本记录是保险不是主流程——任何异常只记日志，绝不阻断上传本身。
     */
    private void signalChange(Long projectId, Long userId, String userName) {
        if (projectId == null) return;
        try {
            workSessionService.onChangeSignal(projectId, userId, userName);
        } catch (Exception e) {
            log.warn("发送版本变更信号失败: project={}", projectId, e);
        }
    }

    private static final long AUDIO_PREVIEW_MAX_BYTES = 512L * 1024 * 1024;

    /** QTA 只在本机转换为浏览器可播放的副本；原文件下载接口仍返回原件。 */
    @GetMapping("/{fileId}/audio-preview")
    public ResponseEntity<Resource> audioPreview(
            @PathVariable("fileId") Long fileId,
            @RequestHeader(value = "X-Session-Id", required = false) String sessionHeader) {
        ProjectFile file = projectFileRepository.findById(fileId).orElse(null);
        if (file == null) return ResponseEntity.notFound().build();
        if (!isAuthorizedForFile(null, sessionHeader, file)) {
            return previewError(403, com.checkba.service.ProjectFileAccessService.UNAVAILABLE_MESSAGE);
        }
        if (!"qta".equalsIgnoreCase(file.getFileType())) {
            return previewError(400, com.checkba.service.LangText.of(
                    "此预览转换仅用于 QTA 音频", "This preview conversion only supports QTA audio"));
        }
        java.nio.file.Path workDir = null;
        try {
            workDir = java.nio.file.Files.createTempDirectory("awd-qta-preview-");
            var input = workDir.resolve("source.qta");
            Resource sourceResource = getStorageService().load(file.getFilePath());
            if (sourceResource.isFile() && sourceResource.contentLength() > AUDIO_PREVIEW_MAX_BYTES) {
                cleanupAudioPreview(workDir);
                return audioPreviewTooLarge();
            }
            long copied;
            try (var source = sourceResource.getInputStream(); var destination = java.nio.file.Files.newOutputStream(input)) {
                // 长度未知或元数据过期也不能无限复制；含 end 的范围最多读上限加一字节。
                copied = org.springframework.util.StreamUtils.copyRange(source, destination, 0, AUDIO_PREVIEW_MAX_BYTES);
            }
            if (copied > AUDIO_PREVIEW_MAX_BYTES) {
                cleanupAudioPreview(workDir);
                return audioPreviewTooLarge();
            }
            var output = audioTranscoder.toPreviewMp3(input.toFile(), workDir);
            var cleanupDir = workDir;
            var stream = new java.io.FilterInputStream(java.nio.file.Files.newInputStream(output.toPath())) {
                @Override public void close() throws IOException {
                    try { super.close(); } finally { cleanupAudioPreview(cleanupDir); }
                }
            };
            // XHR 先完整获取 MP3 再播放，InputStreamResource 不做 Range，流关闭时删除临时副本。
            return ResponseEntity.ok().contentType(MediaType.parseMediaType("audio/mpeg"))
                    .header(HttpHeaders.CACHE_CONTROL, "no-store")
                    .contentLength(output.length()).body(new InputStreamResource(stream));
        } catch (java.util.concurrent.TimeoutException e) {
            cleanupAudioPreview(workDir);
            return previewError(504, com.checkba.service.LangText.of(
                    "准备 QTA 音频预览超时。请将录音导出为 M4A 后打开；原文件未修改。",
                    "QTA audio preview preparation timed out. Export the recording as M4A and open it again. The original file is unchanged."));
        } catch (Exception | LinkageError e) {
            cleanupAudioPreview(workDir);
            // JavaCV tryLoad 把 Loader 的 LinkageError 包在 IOException 内；不能按外层类型误报磁盘。
            if (hasNativeLinkageFailure(e)) {
                return previewError(503, com.checkba.service.LangText.of(
                        "内置音频组件未能加载。请重新安装 AI WorkDeck 后重试；也可先将录音导出为 M4A。",
                        "The built-in audio component could not load. Reinstall AI WorkDeck and try again, or export the recording as M4A."));
            }
            boolean codecFailure = e instanceof org.bytedeco.javacv.FrameGrabber.Exception
                    || e instanceof org.bytedeco.javacv.FrameRecorder.Exception;
            if (!codecFailure && (e instanceof IOException || e instanceof StorageException)) {
                return previewError(500, com.checkba.service.LangText.of(
                        "无法读取录音或写入临时预览文件。请检查文件是否仍存在、磁盘空间和文件访问权限，再重新打开。",
                        "Could not read the recording or write its temporary preview. Check that the file still exists, disk space and file permissions, then open it again."));
            }
            log.warn("QTA preview failed for file {}: {}", fileId, e.toString());
            return previewError(422, com.checkba.service.LangText.of(
                    "无法预览这份 QTA 录音。文件可能损坏或包含无法安全选择的多层音轨。请在语音备忘录中分离录音层，分别导出为 M4A 后打开；原文件未修改。",
                    "This QTA recording could not be previewed. It may be damaged or contain layered tracks that cannot be selected safely. Separate the recording layers in Voice Memos and export each as M4A. The original file is unchanged."));
        }
    }

    private static boolean hasNativeLinkageFailure(Throwable error) {
        for (Throwable cause = error; cause != null; cause = cause.getCause()) {
            if (cause instanceof LinkageError) return true;
        }
        return false;
    }

    private ResponseEntity<Resource> audioPreviewTooLarge() {
        return previewError(413, com.checkba.service.LangText.of(
                "QTA 预览暂时支持不超过 512 MB 的录音。请先分段或导出为 M4A 后打开；原文件未修改。",
                "QTA preview currently supports recordings up to 512 MB. Split the recording or export it as M4A. The original file is unchanged."));
    }

    private ResponseEntity<Resource> previewError(int status, String message) {
        return ResponseEntity.status(status).contentType(new MediaType("text", "plain", StandardCharsets.UTF_8))
                .header(HttpHeaders.CACHE_CONTROL, "no-store")
                .body(new org.springframework.core.io.ByteArrayResource(message.getBytes(StandardCharsets.UTF_8)));
    }

    private void cleanupAudioPreview(java.nio.file.Path dir) {
        if (dir == null) return;
        for (String name : List.of("source.qta", "meeting-audio.mp3")) {
            try { java.nio.file.Files.deleteIfExists(dir.resolve(name)); }
            catch (IOException e) { log.warn("Could not remove temporary audio preview: {}", e.toString()); }
        }
        try { java.nio.file.Files.deleteIfExists(dir); }
        catch (IOException e) { log.warn("Could not remove temporary audio preview directory: {}", e.toString()); }
    }

    /**
     * 实际下载接口
     */
    @GetMapping("/{fileId}/download")
    public ResponseEntity<Resource> downloadFile(
            @PathVariable("fileId") String fileId,
            @RequestParam(value = "token", required = false) String token,
            @RequestHeader(value = "X-Session-Id", required = false) String sessionHeader,
            @RequestParam(value = "inline", defaultValue = "false") boolean inline) {
        log.info("[FileDownload] ===== 开始处理下载请求 =====");
        log.info("[FileDownload] 收到下载请求: fileId={}", fileId);
        
        try {
            // 1. 获取文件路径（fileId 只认数据库数字 id）
            String path = fileId;
            
            Optional<ProjectFile> projectFileOpt = findByNumericId(fileId);
            log.info("[FileDownload] 按数据库ID查找: fileId={}, found={}", fileId, projectFileOpt.isPresent());
            
            String downloadFilename = fileId + ".docx";

            if (projectFileOpt.isPresent()) {
                ProjectFile pf = projectFileOpt.get();
                // 鉴权：只有该文件所属项目的成员可下载（浏览器下载用 ?token=，其它用 X-Session-Id 头）
                if (!isAuthorizedForFile(token, sessionHeader, pf)) {
                    log.warn("[FileDownload] 拒绝越权下载: fileId={}, projectId={}", fileId, pf.getProjectId());
                    return ResponseEntity.status(403)
                            .contentType(new MediaType("text", "plain", java.nio.charset.StandardCharsets.UTF_8))
                            .body(new org.springframework.core.io.ByteArrayResource(
                                    com.checkba.service.ProjectFileAccessService.UNAVAILABLE_MESSAGE
                                            .getBytes(java.nio.charset.StandardCharsets.UTF_8)));
                }
                log.info("[FileDownload] 找到文件记录: id={}, name={}, filePath={}, wpsFileId={}",
                    pf.getId(), pf.getName(), pf.getFilePath(), pf.getWpsFileId());
                
                // 如果数据库中有 filePath，优先使用
                if (StringUtils.hasText(pf.getFilePath())) {
                    path = pf.getFilePath();
                    log.info("[FileDownload] 使用数据库filePath: {}", path);
                } else {
                    log.warn("[FileDownload] 数据库filePath为空，使用fileId作为路径: {}", path);
                }
                // 使用真实文件名（防中文乱码）
                if (StringUtils.hasText(pf.getName())) {
                    downloadFilename = pf.getName();
                    // Ensure proper extension if not present
                    if (StringUtils.hasText(pf.getFileType()) && 
                        !downloadFilename.toLowerCase().endsWith("." + pf.getFileType().toLowerCase())) {
                        downloadFilename += "." + pf.getFileType();
                    }
                }
            } else {
                // 找不到 DB 记录无法确定文件归属，拒绝下载（此前会按裸 fileId 路径直接返回文件，是越权面）
                log.warn("[FileDownload] 未找到文件记录，拒绝下载: {}", fileId);
                return ResponseEntity.status(404).build();
            }

            log.info("[FileDownload] 准备从存储加载文件: path={}", path);
            Resource resource = getStorageService().load(path);
            log.info("[FileDownload] 存储加载结果: exists={}, readable={}", resource.exists(), resource.isReadable());

            // Determine Media Type dynamically
            MediaType mediaType = MediaType.APPLICATION_OCTET_STREAM;
            String lowerName = downloadFilename.toLowerCase();
            if (lowerName.endsWith(".doc") || lowerName.endsWith(".docx")) {
                mediaType = MediaType.parseMediaType("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
            } else if (lowerName.endsWith(".pdf")) {
                mediaType = MediaType.APPLICATION_PDF;
            } else if (lowerName.endsWith(".png")) {
                mediaType = MediaType.IMAGE_PNG;
            } else if (lowerName.endsWith(".jpg") || lowerName.endsWith(".jpeg")) {
                mediaType = MediaType.IMAGE_JPEG;
            } else if (lowerName.endsWith(".gif")) {
                mediaType = MediaType.IMAGE_GIF;
            } else if (lowerName.endsWith(".mp4")) {
                 mediaType = MediaType.parseMediaType("video/mp4");
            } else if (lowerName.endsWith(".mp3")) {
                 mediaType = MediaType.parseMediaType("audio/mpeg");
            } else if (lowerName.endsWith(".txt")) {
                 mediaType = MediaType.TEXT_PLAIN;
            } else {
                 String mediaMime = mediaMimeFor(lowerName);
                 if (mediaMime != null) {
                     mediaType = MediaType.parseMediaType(mediaMime);
                 }
            }

            String filename = URLEncoder.encode(downloadFilename, StandardCharsets.UTF_8).replace("+", "%20");
            String contentDisposition = (inline && MediaType.APPLICATION_PDF.equals(mediaType) ? "inline" : "attachment") + "; filename=\"" + filename + "\"";

            // Range（dev-board#1025）：返回 200 + Resource 时，Spring MVC（AbstractMessageConverterMethodProcessor）
            // 会按请求的 Range 头自行切成 ResourceRegion 回 206 / 越界回 416 + "bytes */total"，
            // 并写 Accept-Ranges——前提是返回类型声明为 Resource（改成 ResponseEntity<?> 会让
            // ResourceRegionHttpMessageConverter 拒写）。它依赖 contentLength()；取不到长度的资源
            // （对象存储等）包成 InputStreamResource，Spring 对它跳过 Range 处理，退回 200 全量。
            if (contentLengthOrNegative(resource) < 0) {
                return ResponseEntity.ok()
                        .contentType(mediaType)
                        .header(HttpHeaders.CONTENT_DISPOSITION, contentDisposition)
                    .header(HttpHeaders.CACHE_CONTROL, "private, no-store")
                        .body(new InputStreamResource(resource.getInputStream()));
            }

            return ResponseEntity.ok()
                    .contentType(mediaType)
                    .header(HttpHeaders.ACCEPT_RANGES, "bytes")
                    .header(HttpHeaders.CONTENT_DISPOSITION, contentDisposition)
                    .header(HttpHeaders.CACHE_CONTROL, "private, no-store")
                    .body(resource);
        } catch (StorageException e) {
            log.error("[FileDownload] 存储异常: fileId={}, message={}", fileId, e.getMessage());
            log.error("[FileDownload] 存储异常堆栈:", e);
            return ResponseEntity.notFound().build();
        } catch (Exception e) {
            log.error("[FileDownload] 未知异常: fileId={}, message={}", fileId, e.getMessage());
            log.error("[FileDownload] 未知异常堆栈:", e);
            return ResponseEntity.status(500).build();
        }
    }

    /** 资源字节长度；取不到（抛异常）返回 -1。 */
    private static long contentLengthOrNegative(Resource resource) {
        try {
            return resource.contentLength();
        } catch (Exception e) {
            return -1;
        }
    }

    /** 音视频扩展名 → MIME（规格 2026-09-29-media-player-design §4.1）；非媒体返回 null。 */
    static String mediaMimeFor(String lowerName) {
        int dot = lowerName.lastIndexOf('.');
        if (dot < 0) {
            return null;
        }
        switch (lowerName.substring(dot + 1)) {
            case "webm": return "video/webm";
            case "ogv": return "video/ogg";
            case "mov": return "video/quicktime";
            case "m4v": return "video/x-m4v";
            case "mkv": return "video/x-matroska";
            case "avi": return "video/x-msvideo";
            case "ogg": return "audio/ogg";
            case "opus": return "audio/ogg";
            case "m4a": return "audio/mp4";
            case "wav": return "audio/wav";
            case "flac": return "audio/flac";
            case "aac": return "audio/aac";
            default: return null;
        }
    }

    /**
     * 下载 / 上传的目标文件定位：只认数据库数字 id（dev-board#1035）。
     *
     * <p>曾经查不到还会按 wpsFileId 回退，但 wpsFileId 不唯一（清单同步建的行为 null，
     * 会话文件夹存的是 conversationId），回退命中的可能是别的文件；客户端已统一传数字 id。
     * 非数字一律视为「文件不存在」，由调用方回 404。
     */
    private Optional<ProjectFile> findByNumericId(String fileId) {
        try {
            return projectFileRepository.findById(Long.parseLong(fileId));
        } catch (NumberFormatException ignored) {
            return Optional.empty();
        }
    }

    /** Upload reception stays outside transactions and the version lock; publication uses the content service. */
    @PostMapping("/{fileId}/upload")
    public ResponseEntity<Map<String, Object>> uploadFile(
            @PathVariable("fileId") String fileId,
            @RequestPart(value = "file", required = false) MultipartFile multipartFile,
            @RequestHeader(value = "X-File-Offset", required = false) Long offset,
            @RequestHeader(value = "X-Session-Id", required = false) String sessionHeader,
            @RequestParam(value = "token", required = false) String token,
            HttpServletRequest request) {

        InputStream inputStream = null;
        try {
            // 0. 检查项目总大小限制（storage.project-size-limit；桌面端本机文件夹项目豁免）
            final Optional<ProjectFile> projectFileOpt = findByNumericId(fileId);
            if (projectFileOpt.isPresent()) {
                Long projectId = projectFileOpt.get().getProjectId();
                // 鉴权：上传是就地覆盖文件字节，必须要写权限——此前只校验读权限，
                // READ_ONLY 成员与客户可以静默改写已签署合同等文档
                if (!isAuthorizedForWrite(token, sessionHeader, projectId)) {
                    return ResponseEntity.status(403).body(Map.of("code", -1, "message", com.checkba.service.LangText.of("无权上传到该文件", "You do not have permission to upload to this file")));
                }
                Long totalSize = projectFileRepository.sumSizeByProjectId(projectId); // Need to add this method to repo
                if (storageResolver.exceedsProjectSizeLimit(projectId, totalSize, 0L)) {
                     return ResponseEntity.status(400).body(Map.of("code", -1, "message", storageResolver.projectSizeLimitMessage()));
                }
            } else {
                // 找不到文件记录就无从判断归属：此前只要求登录，resolveUploadStoragePath
                // 会把裸 fileId 当存储键，任何登录用户都能凭它往存储根写字节
                return ResponseEntity.status(404).body(Map.of("code", -1, "message", com.checkba.service.LangText.of("文件不存在", "File not found")));
            }

            // 编辑器保存带 mustExist=1（它装载的就是磁盘上已有的这份文件，BUG-14 / v0.49.0 C4-03）：
            // 文件在 Finder 里被改名 / 移走后，这一行要么已进回收站、要么还指着旧路径；下面的
            // save() 是 createDirectories + REPLACE_EXISTING，会在旧路径把旧文件名重新建出来——
            // 磁盘上一新一旧两份，改名那份停在旧内容。这里一律 409，由编辑器提示「已被移动或改名」
            // 并保留未保存的改动；对账把这一行改指到新路径之后，重试就会落到新文件上。
            // 不带参数的上传（新建文件先建行再传第一笔字节、录音分片）照旧，不受影响。
            if ("1".equals(request.getParameter("mustExist")) && (offset == null || offset == 0)) {
                ProjectFile target = projectFileOpt.get();
                boolean gone = Boolean.TRUE.equals(target.getIsDeleted())
                        || (StringUtils.hasText(target.getFilePath()) && !getStorageService().exists(target.getFilePath()));
                if (gone) {
                    log.warn("拒绝保存到已不存在的路径（外部改名/移动/删除）: fileId={}, path={}", fileId, target.getFilePath());
                    return ResponseEntity.status(409).body(Map.of("code", -1, "reason", "FILE_MOVED",
                            "message", com.checkba.service.LangText.of("文件已被移动、改名或删除，本次改动尚未保存",
                                    "The file was moved, renamed or deleted; your changes have not been saved")));
                }
            }

            String contentType = request.getContentType();
            log.info("文件上传请求: fileId={}, offset={}, contentType={}, multipartFile={}", 
                fileId, offset, contentType, multipartFile != null ? multipartFile.getOriginalFilename() : "null");
            
            // ... (multipart checks) ...
            if (contentType != null && contentType.toLowerCase().startsWith("multipart/form-data")) {
                if (multipartFile == null || multipartFile.isEmpty()) {
                     if (request instanceof MultipartHttpServletRequest) {
                        MultipartHttpServletRequest multipartRequest = (MultipartHttpServletRequest) request;
                        multipartFile = multipartRequest.getFile("file");
                     }
                }
                if (multipartFile == null || multipartFile.isEmpty()) {
                     return ResponseEntity.status(400).body(Map.of("code", -1, "message", com.checkba.service.LangText.of("未找到文件", "No file provided")));
                }
                inputStream = multipartFile.getInputStream();
            } else {
                // 裸 octet-stream 分支（分片上传/桌面端三个真实调用点全走这条路）此前没有
                // 任何空校验：客户端自己在 X-File-Total-Size 里声明了非零总大小却送来空
                // body，是客户端自相矛盾，必须在写盘前拒绝——否则 save()/append() 的
                // REPLACE_EXISTING 语义会把已有的非空文件截成 0 字节，还照常回 code:0。
                // 头缺失或显式为 0 时不拦，保存一个空文件是合法场景。
                String declaredTotalSizeStr = request.getHeader("X-File-Total-Size");
                if (StringUtils.hasText(declaredTotalSizeStr)) {
                    try {
                        long declaredTotalSize = Long.parseLong(declaredTotalSizeStr);
                        // 只认「显式声明为 0」。长度未知时是 -1（分块传输，例如反向代理
                        // 关掉 proxy_request_buffering 后转发的请求），那种情况一律放行——
                        // 把「不知道多长」当成「空」会误拒正常上传，比漏拦更糟。
                        if (declaredTotalSize > 0 && request.getContentLengthLong() == 0) {
                            return ResponseEntity.status(400).body(Map.of("code", -1, "message",
                                    com.checkba.service.LangText.of("上传内容为空，与声明的文件大小不符", "Uploaded content is empty but a non-zero file size was declared")));
                        }
                    } catch (NumberFormatException ignored) {
                        // 头解析不了不是这里要处理的问题，交给后续既有逻辑
                    }
                }
                inputStream = request.getInputStream();
            }

            String sid = StringUtils.hasText(sessionHeader) ? sessionHeader : token;
            Long actor = AuthController.getUserIdFromSession(sid);
            long incoming = multipartFile != null ? multipartFile.getSize() : request.getContentLengthLong();
            var published = contentService.upload(projectFileOpt.get().getId(), projectFileOpt.get().getProjectId(),
                    actor, inputStream, incoming, offset, "1".equals(request.getParameter("mustExist")),
                    request.getHeader("X-File-Total-Size"));

            // The executor may use CallerRunsPolicy. All indexing, notifications and version signals
            // are intentionally submitted only after publication has released the canonical lock.
            if (published.postProcess()) {
                try {
                    java.util.concurrent.CompletableFuture.runAsync(() -> {
                        try {
                            projectRagService.refreshProjectKnowledgeIncremental(String.valueOf(published.file().getProjectId()), published.path());
                            try {
                                autoTaggingService.autoTagFile(published.file().getProjectId(), published.file().getId(),
                                        published.path(), published.file().getUserId());
                            } catch (Exception e) { log.error("AutoTag failed", e); }
                        } catch (Exception e) { log.error("Async RAG indexing failed for file: " + published.path(), e); }
                    }, asyncExecutor());
                } catch (RuntimeException e) {
                    log.warn("文件内容已保存，未能提交索引/标签任务: fileId={}", published.file().getId(), e);
                }
            }
            if (published.complete()) {
                signalChange(published.file().getProjectId(), actor, AuthController.getUsernameFromSession(sid));
            }

            Map<String, Object> result = new HashMap<>();
            result.put("code", 0);
            return ResponseEntity.ok(result);

        } catch (com.checkba.service.ProjectFileContentService.ContentWriteException e) {
            Map<String, Object> error = new HashMap<>();
            error.put("code", -1); error.put("message", e.getMessage());
            if (e.reason() != null) error.put("reason", e.reason());
            if (e.status() == 423 && "VERSION_BUSY".equals(e.reason())) error.put("writeState", "not_started");
            return ResponseEntity.status(e.status()).body(error);
        } catch (com.checkba.version.VersionException e) {
            // Pre-publication lock rejection was translated by the content service. A version
            // exception from inside publication may follow a disk write and has an unknown outcome.
            log.warn("Content publication failed in version coordination", e);
            return ResponseEntity.status(500)
                    .body(Map.of("code", -1, "message", e.isUserFacing() ? e.getMessage()
                            : com.checkba.service.LangText.of("保存失败，请重试", "Save failed; please retry")));
        } catch (Exception e) {
            log.error("上传失败", e);
            // e.getMessage() 可能为 null（如 JVM fast-throw 优化后的 NPE），
            // Map.of 不收 null 值——曾把 500 响应本身炸成第二个 NPE（e2e 实录）。
            String msg = e.getMessage() != null ? e.getMessage() : e.getClass().getSimpleName();
            return ResponseEntity.status(500).body(Map.of("code", -1, "message", msg));
        } finally {
            // 关闭上传输入流：此前无 finally，multipart/大文件上传每次泄漏一个句柄
            if (inputStream != null) {
                try { inputStream.close(); } catch (IOException ignored) {}
            }
        }
    }

    /**
     * 获取文件文本内容
     * GET /api/files/{fileId}/text
     */
    @GetMapping("/{fileId}/text")
    public ResponseEntity<Map<String, Object>> getFileText(
            @PathVariable("fileId") Long fileId,
            @RequestParam(value = "token", required = false) String token,
            @RequestHeader(value = "X-Session-Id", required = false) String sessionHeader) {
        try {
            Optional<ProjectFile> fileOpt = projectFileRepository.findById(fileId);
            if (fileOpt.isEmpty()) {
                return ResponseEntity.badRequest().body(Map.of("code", -1, "message", com.checkba.service.LangText.of("文件不存在", "File not found")));
            }
            if (!isAuthorizedForFile(token, sessionHeader, fileOpt.get())) {
                return ResponseEntity.status(403).body(Map.of("code", -1, "message", com.checkba.service.ProjectFileAccessService.UNAVAILABLE_MESSAGE));
            }

            String text = extractDocumentText(fileOpt.get());

            return ResponseEntity.ok(Map.of("code", 0, "data", text));
        } catch (Exception e) {
            log.error("获取文件文本失败: fileId={}", fileId, e);
            return ResponseEntity.status(500).body(Map.of("code", -1, "message", com.checkba.service.LangText.of("获取文本失败: ", "Failed to retrieve text: ") + e.getMessage()));
        }
    }

    /**
     * 文档比较接口 - 提取两个文档的文本内容供前端进行差异对比
     * @param sourceId 源文档 ID（基准文档）
     * @param targetId 目标文档 ID（比较对象）
     * @return 包含两个文档文本内容的响应
     */
    @GetMapping("/compare")
    public ResponseEntity<Map<String, Object>> compareDocuments(
            @RequestParam("sourceId") Long sourceId,
            @RequestParam("targetId") Long targetId,
            @RequestParam(value = "token", required = false) String token,
            @RequestHeader(value = "X-Session-Id", required = false) String sessionHeader) {

        try {
            log.info("文档比较请求: sourceId={}, targetId={}", sourceId, targetId);
            
            // 1. 查找源文档
            Optional<ProjectFile> sourceOpt = projectFileRepository.findById(sourceId);
            if (sourceOpt.isEmpty()) {
                return ResponseEntity.badRequest().body(Map.of(
                    "code", -1,
                    "message", com.checkba.service.LangText.of("源文档不存在: ", "Source document not found: ") + sourceId
                ));
            }

            // 2. 查找目标文档
            Optional<ProjectFile> targetOpt = projectFileRepository.findById(targetId);
            if (targetOpt.isEmpty()) {
                return ResponseEntity.badRequest().body(Map.of(
                    "code", -1,
                    "message", com.checkba.service.LangText.of("目标文档不存在: ", "Target document not found: ") + targetId
                ));
            }

            ProjectFile sourceFile = sourceOpt.get();
            ProjectFile targetFile = targetOpt.get();

            // 鉴权：两个文档所属项目都需当前用户有权访问
            if (!isAuthorizedForFile(token, sessionHeader, sourceFile)
                    || !isAuthorizedForFile(token, sessionHeader, targetFile)) {
                return ResponseEntity.status(403).body(Map.of("code", -1, "message", com.checkba.service.ProjectFileAccessService.UNAVAILABLE_MESSAGE));
            }

            // 3. 检查文件类型（只支持 doc/docx）
            List<String> supportedTypes = List.of("doc", "docx");
            String sourceType = sourceFile.getFileType() != null ? sourceFile.getFileType().toLowerCase() : "";
            String targetType = targetFile.getFileType() != null ? targetFile.getFileType().toLowerCase() : "";
            
            if (!supportedTypes.contains(sourceType)) {
                return ResponseEntity.badRequest().body(Map.of(
                    "code", -1,
                    "message", com.checkba.service.LangText.of("源文档类型不支持比较: ", "Source document type does not support comparison: ") + sourceType
                ));
            }
            if (!supportedTypes.contains(targetType)) {
                return ResponseEntity.badRequest().body(Map.of(
                    "code", -1,
                    "message", com.checkba.service.LangText.of("目标文档类型不支持比较: ", "Target document type does not support comparison: ") + targetType
                ));
            }
            
            // 4. 提取文本内容
            String sourceText = extractDocumentText(sourceFile);
            String targetText = extractDocumentText(targetFile);
            
            // 5. 构建响应
            Map<String, Object> data = new HashMap<>();
            data.put("source", Map.of(
                "id", sourceFile.getId(),
                "name", sourceFile.getName(),
                "text", sourceText
            ));
            data.put("target", Map.of(
                "id", targetFile.getId(),
                "name", targetFile.getName(),
                "text", targetText
            ));
            
            Map<String, Object> result = new HashMap<>();
            result.put("code", 0);
            result.put("data", data);
            
            log.info("文档比较完成: sourceId={}, targetId={}, sourceLen={}, targetLen={}", 
                sourceId, targetId, sourceText.length(), targetText.length());
            
            return ResponseEntity.ok(result);
            
        } catch (Exception e) {
            log.error("文档比较失败: sourceId={}, targetId={}", sourceId, targetId, e);
            return ResponseEntity.status(500).body(Map.of(
                "code", -1,
                "message", com.checkba.service.LangText.of("文档比较失败: ", "Document comparison failed: ") + e.getMessage()
            ));
        }
    }
    
    /**
     * 使用 Apache Tika 提取文档文本内容（委托 DocumentTextService）
     */
    private String extractDocumentText(ProjectFile file) throws IOException, TikaException {
        return documentTextService.extractText(file);
    }
}
