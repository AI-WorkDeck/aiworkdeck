package com.checkba.controller;

import jakarta.servlet.http.HttpServletRequest;
import lombok.extern.slf4j.Slf4j;
import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.Resource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URLEncoder;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.util.HashMap;
import java.util.Map;

/**
 * WPS 文档实际存储与下载/上传接口
 *
 * 路径与 WpsController 中的回调返回保持一致：
 * - 下载：GET  /api/files/{fileId}/download
 * - 上传：PUT  /api/files/{fileId}/upload
 *
 * 存储策略：
 * - 统一存放在项目根目录 ../data/wps-files/{fileId}.docx
 * - 如果文件不存在，则从 ../docs/template.docx 复制一份作为初始文档
 */
@Slf4j
@RestController
@RequestMapping("/api/files")
public class FileController {

    // 项目根目录（backend 的上一级目录）
    private static final Path PROJECT_ROOT = Paths.get(System.getProperty("user.dir")).getParent();
    // 模板文件：用于新建文档的初始内容
    private static final Path TEMPLATE_DOC = PROJECT_ROOT.resolve("docs/template.docx");
    // 实际存储目录
    private static final Path STORAGE_DIR = PROJECT_ROOT.resolve("data/wps-files");

    private Path resolveFilePath(String fileId) {
        return STORAGE_DIR.resolve(fileId + ".docx");
    }

    /**
     * 实际下载接口：供 WPS 回调中的 download_url 使用
     */
    @GetMapping("/{fileId}/download")
    public ResponseEntity<Resource> downloadFile(@PathVariable("fileId") String fileId) throws IOException {
        Path filePath = resolveFilePath(fileId);

        // 如果文件不存在，则以模板为基础创建
        if (!Files.exists(filePath)) {
            Files.createDirectories(STORAGE_DIR);
            if (Files.exists(TEMPLATE_DOC)) {
                Files.copy(TEMPLATE_DOC, filePath, StandardCopyOption.REPLACE_EXISTING);
                log.info("Created new file from template: {}", filePath);
            } else {
                log.warn("Template file not found: {}", TEMPLATE_DOC);
                // 如果没有模板，就创建一个空文件，避免 404
                Files.createFile(filePath);
            }
        }

        FileSystemResource resource = new FileSystemResource(filePath);
        if (!resource.exists()) {
            log.error("File not found for download: {}", filePath);
            return ResponseEntity.notFound().build();
        }

        // 统一使用 docx MIME 类型
        MediaType mediaType = MediaType.parseMediaType(
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document");

        // 下载文件名：使用 fileId.docx，避免中文编码问题
        String filename = URLEncoder.encode(fileId + ".docx", "UTF-8").replace("+", "%20");

        return ResponseEntity.ok()
                .contentType(mediaType)
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + filename + "\"")
                .body(resource);
    }

    /**
     * 上传接口：供 WPS 三段式保存中的 upload_url 使用
     * WPS 会以 PUT application/octet-stream 的方式上传文件流
     */
    @PutMapping("/{fileId}/upload")
    public ResponseEntity<Map<String, Object>> uploadFile(
            @PathVariable("fileId") String fileId,
            HttpServletRequest request) throws IOException {

        Path filePath = resolveFilePath(fileId);
        Files.createDirectories(STORAGE_DIR);

        try (InputStream in = request.getInputStream();
             OutputStream out = Files.newOutputStream(filePath,
                     StandardOpenOption.CREATE,
                     StandardOpenOption.TRUNCATE_EXISTING,
                     StandardOpenOption.WRITE)) {
            in.transferTo(out);
        }

        log.info("Uploaded file for fileId={}, path={}", fileId, filePath);

        Map<String, Object> result = new HashMap<>();
        result.put("code", 0);
        result.put("message", "");
        result.put("data", new HashMap<>());

        return ResponseEntity.ok(result);
    }
}


