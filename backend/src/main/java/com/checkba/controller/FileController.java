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
            
            Optional<ProjectFile> projectFileOpt = projectFileRepository.findByWpsFileId(fileId);
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
                    if (!downloadFilename.toLowerCase().endsWith(".docx")) {
                        downloadFilename += ".docx";
                    }
                }
            }

            Resource resource = getStorageService().load(path);

            MediaType mediaType = MediaType.parseMediaType(
                    "application/vnd.openxmlformats-officedocument.wordprocessingml.document");

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

    /**
     * 上传接口
     * 注意：使用POST方法，因为uni.uploadFile不支持PUT方法
     */
    @PostMapping("/{fileId}/upload")
    public ResponseEntity<Map<String, Object>> uploadFile(
            @PathVariable("fileId") String fileId,
            HttpServletRequest request) {

        try (InputStream inputStream = request.getInputStream()) {
            // 1. 确定存储路径
            String storagePath = fileId; // 默认旧路径
            Long projectId = null;
            
            Optional<ProjectFile> projectFileOpt = projectFileRepository.findByWpsFileId(fileId);
            if (projectFileOpt.isPresent()) {
                ProjectFile pf = projectFileOpt.get();
                projectId = pf.getProjectId();
                
                // 如果已有路径，沿用
                if (StringUtils.hasText(pf.getFilePath())) {
                    storagePath = pf.getFilePath();
                } else {
                    // 构建物理存储路径，使其与逻辑树结构一致
                    // 格式: projects/{pid}/{logical_path}/{filename}
                    // 例如: projects/1/尽调底稿/财务/报表.docx
                    
                    String safeName = StringUtils.hasText(pf.getName()) ? pf.getName() : fileId;
                    // 确保文件名有后缀（简单判断，根据实际情况可能需要更严谨的后缀处理）
                    if (pf.getFileType() != null && !safeName.toLowerCase().endsWith("." + pf.getFileType().toLowerCase())) {
                         safeName += "." + pf.getFileType();
                    } else if (!safeName.contains(".")) {
                         safeName += ".docx"; // 默认后缀
                    }
                    
                    String logicalPath = buildLogicalPath(pf);
                    String basePath = String.format("projects/%d", pf.getProjectId());
                    
                    if (StringUtils.hasText(logicalPath)) {
                        storagePath = String.format("%s/%s/%s", basePath, logicalPath, safeName);
                    } else {
                        storagePath = String.format("%s/%s", basePath, safeName);
                    }
                    
                    // 更新数据库
                    pf.setFilePath(storagePath);
                    projectFileRepository.save(pf);
                    log.info("构建文件存储路径: fileId={} -> {}", fileId, storagePath);
                }
            }

            String savedPath = getStorageService().save(storagePath, inputStream);
            log.info("文件上传成功: fileId={}, path={}", fileId, savedPath);
            
            // 2. 触发 RAG 知识库增量刷新
            if (projectId != null) {
                // 转为 String，使用增量刷新
                projectRagService.refreshProjectKnowledgeIncremental(String.valueOf(projectId), savedPath);
                log.info("触发项目知识库增量刷新: projectId={}, filePath={}", projectId, savedPath);
            }

            Map<String, Object> result = new HashMap<>();
            result.put("code", 0);
            result.put("message", "");
            result.put("data", new HashMap<>());

            return ResponseEntity.ok(result);
        } catch (IOException | StorageException e) {
            log.error("文件上传失败: fileId={}", fileId, e);
            
            Map<String, Object> result = new HashMap<>();
            result.put("code", -1);
            result.put("message", "文件上传失败: " + e.getMessage());
            result.put("data", new HashMap<>());

            return ResponseEntity.status(500).body(result);
        }
    }
}
