package com.checkba.controller;

import com.checkba.model.entity.ProjectFile;
import com.checkba.repository.ProjectFileRepository;
import com.checkba.service.ai.ProjectRagService;
import com.checkba.storage.StorageException;
import com.checkba.storage.StorageService;
import com.checkba.storage.StorageServiceFactory;
import jakarta.servlet.http.HttpServletRequest;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.io.Resource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.util.StringUtils;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.multipart.MultipartHttpServletRequest;

import java.io.IOException;
import java.io.InputStream;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;

/**
 * WPS 文档实际存储与下载/上传接口
 */
@Slf4j
@RestController
@RequestMapping("/api/files")
public class FileController {

    @Autowired
    private StorageServiceFactory storageServiceFactory;

    @Autowired
    private ProjectFileRepository projectFileRepository;
    
    @Autowired
    private ProjectRagService projectRagService;

    private StorageService getStorageService() {
        return storageServiceFactory.getStorageService();
    }

    /**
     * 实际下载接口
     */
    @GetMapping("/{fileId}/download")
    public ResponseEntity<Resource> downloadFile(@PathVariable("fileId") String fileId) {
        try {
            // 1. 获取文件路径
            String path = fileId; // 默认回退到 fileId (兼容旧逻辑)
            
            Optional<ProjectFile> projectFileOpt = Optional.empty();
            
            // 尝试将 fileId 解析为 Long ID (Frontend 传的是 DB ID)
            try {
                Long dbId = Long.parseLong(fileId);
                projectFileOpt = projectFileRepository.findById(dbId);
            } catch (NumberFormatException e) {
                // Not a number, treat as WPS File ID
            }
            
            // 如果没找到，尝试按 WPS File ID 查找 (Fallback)
            if (projectFileOpt.isEmpty()) {
                projectFileOpt = projectFileRepository.findByWpsFileId(fileId);
            }
            
            String downloadFilename = fileId + ".docx";

            if (projectFileOpt.isPresent()) {
                ProjectFile pf = projectFileOpt.get();
                // 如果数据库中有 filePath，优先使用
                if (StringUtils.hasText(pf.getFilePath())) {
                    path = pf.getFilePath();
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
            }

            Resource resource = getStorageService().load(path);

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
            }

            String filename = URLEncoder.encode(downloadFilename, StandardCharsets.UTF_8).replace("+", "%20");

            return ResponseEntity.ok()
                    .contentType(mediaType)
                    .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + filename + "\"")
                    .body(resource);
        } catch (StorageException e) {
            log.error("文件下载失败: fileId={}", fileId, e);
            return ResponseEntity.notFound().build();
        }
    }

    /**
     * 递归构建文件的逻辑路径（相对于项目根目录）
     */
    private String buildLogicalPath(ProjectFile file) {
        if (file.getParentId() == null) {
            return "";
        }
        
        StringBuilder pathBuilder = new StringBuilder();
        ProjectFile current = file;
        
        // 向上查找父文件夹，直到根目录
        // 为防止死循环，设置最大深度
        int depth = 0;
        while (current.getParentId() != null && depth < 20) {
            Optional<ProjectFile> parentOpt = projectFileRepository.findById(current.getParentId());
            if (parentOpt.isPresent()) {
                current = parentOpt.get();
                // 在路径前插入父文件夹名
                if (pathBuilder.length() > 0) {
                    pathBuilder.insert(0, "/");
                }
                pathBuilder.insert(0, current.getName());
            } else {
                break;
            }
            depth++;
        }
        
        return pathBuilder.toString();
    }

    @GetMapping("/{fileId}/upload-status")
    public ResponseEntity<Map<String, Object>> getUploadStatus(@PathVariable("fileId") String fileId) {
        try {
            long size = getStorageService().getSize(fileId);
            Map<String, Object> data = new HashMap<>();
            data.put("uploadedSize", size);
            
            Map<String, Object> result = new HashMap<>();
            result.put("code", 0);
            result.put("data", data);
            return ResponseEntity.ok(result);
        } catch (Exception e) {
            log.error("获取上传状态失败: fileId={}", fileId, e);
            return ResponseEntity.status(500).build();
        }
    }

    /**
     * 上传接口
     * ...
     */
    @PostMapping("/{fileId}/upload")
    public ResponseEntity<Map<String, Object>> uploadFile(
            @PathVariable("fileId") String fileId,
            @RequestPart(value = "file", required = false) MultipartFile multipartFile,
            @RequestHeader(value = "X-File-Offset", required = false) Long offset,
            HttpServletRequest request) {

        InputStream inputStream = null;
        try {
            // 0. 检查项目总大小限制 (20GB)
            Optional<ProjectFile> projectFileOpt = projectFileRepository.findByWpsFileId(fileId);
            if (projectFileOpt.isPresent()) {
                Long projectId = projectFileOpt.get().getProjectId();
                Long totalSize = projectFileRepository.sumSizeByProjectId(projectId); // Need to add this method to repo
                if (totalSize != null && totalSize > 20L * 1024 * 1024 * 1024) {
                     return ResponseEntity.status(400).body(Map.of("code", -1, "message", "项目文件总大小超过20GB限制"));
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
                     return ResponseEntity.status(400).body(Map.of("code", -1, "message", "未找到文件"));
                }
                inputStream = multipartFile.getInputStream();
            } else {
                inputStream = request.getInputStream();
            }

            // 1. 确定存储路径
            // ... (Existing path logic, keep simplified for brevity in this replace block if possible, but I need to be careful not to delete logic)
            // Wait, replace_file_content replaces a block. I should probably use multi_replace to be precise or rewrite the whole method carefully.
            // I will rewrite the logic to use `append` if offset > 0.

            String savedPath;
            if (offset != null && offset > 0) {
                 // 追加模式
                 savedPath = getStorageService().append(fileId, inputStream);
            } else {
                 // 覆盖/新传模式
                 // ... Path Resolution Logic ...
                 String storagePath = fileId;
                 Long projectId = null;
                 
                 if (projectFileOpt.isPresent()) {
                    ProjectFile pf = projectFileOpt.get();
                    projectId = pf.getProjectId();
                    if (StringUtils.hasText(pf.getFilePath())) {
                        storagePath = pf.getFilePath();
                    } else {
                         String safeName = StringUtils.hasText(pf.getName()) ? pf.getName() : fileId;
                          if (pf.getFileType() != null && !safeName.endsWith("." + pf.getFileType())) {
                               safeName += "." + pf.getFileType();
                          }
                          // Removed forced .docx default - rely on fileType or original name
                          String logicalPath = buildLogicalPath(pf);
                         String basePath = String.format("projects/%d", pf.getProjectId());
                         storagePath = StringUtils.hasText(logicalPath) ? 
                             String.format("%s/%s/%s", basePath, logicalPath, safeName) : 
                             String.format("%s/%s", basePath, safeName);
                         
                         pf.setFilePath(storagePath);
                         projectFileRepository.save(pf);
                    }
                 }
                 savedPath = getStorageService().save(storagePath, inputStream);
            }

            // 检查是否完成上传并触发RAG (Async)
            String totalSizeStr = request.getHeader("X-File-Total-Size");
            if (StringUtils.hasText(totalSizeStr)) {
                try {
                    long totalSize = Long.parseLong(totalSizeStr);
                    long currentSize = getStorageService().getSize(savedPath); // Need to ensure savedPath works for getSize, usually it takes key?
                    // LocalFileStorageService.getSize implementation takes key (filePath).
                    // Wait, getStorageService().save returns the key (path). so savedPath is the key.
                    
                    if (currentSize >= totalSize) {
                         if (projectFileOpt.isPresent()) {
                             Long pid = projectFileOpt.get().getProjectId();
                             // Async execution to prevent blocking 408 Timeout
                             java.util.concurrent.CompletableFuture.runAsync(() -> {
                                 try {
                                     log.info("触发异步RAG索引: projectId={}, file={}", pid, savedPath);
                                     projectRagService.refreshProjectKnowledgeIncremental(String.valueOf(pid), savedPath);
                                 } catch (Exception e) {
                                     log.error("Async RAG indexing failed for file: " + savedPath, e);
                                 }
                             });
                         }
                    }
                } catch (Exception e) {
                    log.warn("Failed to check completion for RAG trigger", e);
                }
            } else {
                // Compatibility: If no header, trigger for first chunk (Legacy behavior, but Async now)
                if ((offset == null || offset == 0) && projectFileOpt.isPresent()) {
                     Long pid = projectFileOpt.get().getProjectId();
                     java.util.concurrent.CompletableFuture.runAsync(() -> {
                         try {
                              projectRagService.refreshProjectKnowledgeIncremental(String.valueOf(pid), savedPath);
                         } catch (Exception e) {
                              log.error("Async RAG (Legacy) failed", e);
                         }
                     });
                }
            }

            Map<String, Object> result = new HashMap<>();
            result.put("code", 0);
            return ResponseEntity.ok(result);

        } catch (Exception e) {
            log.error("上传失败", e);
            return ResponseEntity.status(500).body(Map.of("code", -1, "message", e.getMessage()));
        }
    }
}
