package com.checkba.controller;

import com.checkba.model.entity.ProjectFile;
import com.checkba.service.ProjectFileService;
import lombok.Data;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 项目文件管理控制器
 */
@RestController
@RequestMapping("/api/projects/{projectId}/files")
@CrossOrigin(origins = "*")
@RequiredArgsConstructor
public class ProjectFileController {

    private final ProjectFileService projectFileService;

    /**
     * 获取文件列表（指定父文件夹）
     * GET /api/projects/{projectId}/files?parentId=xxx
     * GET /api/projects/{projectId}/files?tree=true 获取完整文件树
     */
    @GetMapping
    public List<ProjectFile> getFiles(
            @PathVariable Long projectId,
            @RequestParam(required = false) Long parentId,
            @RequestParam(required = false) Boolean tree,
            @RequestHeader(value = "X-Session-Id", required = false) String sessionId) {
        Long userId = getUserIdFromSession(sessionId);
        if (userId == null) {
            throw new IllegalArgumentException("请先登录");
        }
        // 如果请求完整文件树
        if (Boolean.TRUE.equals(tree)) {
            return projectFileService.getFileTree(projectId);
        }
        // 否则返回指定父文件夹下的文件
        return projectFileService.getFilesByParent(projectId, parentId);
    }

    /**
     * 创建文件夹
     * POST /api/projects/{projectId}/files/folder
     */
    @PostMapping("/folder")
    public ProjectFile createFolder(
            @PathVariable Long projectId,
            @RequestBody CreateFolderRequest request,
            @RequestHeader(value = "X-Session-Id", required = false) String sessionId) {
        Long userId = getUserIdFromSession(sessionId);
        if (userId == null) {
            throw new IllegalArgumentException("请先登录");
        }
        return projectFileService.createFolder(projectId, request.getParentId(), request.getName(), userId);
    }

    /**
     * 创建文件
     * POST /api/projects/{projectId}/files/file
     */
    @PostMapping("/file")
    public ProjectFile createFile(
            @PathVariable Long projectId,
            @RequestBody CreateFileRequest request,
            @RequestHeader(value = "X-Session-Id", required = false) String sessionId) {
        Long userId = getUserIdFromSession(sessionId);
        if (userId == null) {
            throw new IllegalArgumentException("请先登录");
        }
        return projectFileService.createFile(
                projectId,
                request.getParentId(),
                request.getName(),
                request.getFileType(),
                request.getFileSize(),
                request.getFilePath(),
                request.getWpsFileId(),
                userId
        );
    }

    /**
     * 重命名文件或文件夹
     * PUT /api/projects/{projectId}/files/{fileId}/rename
     */
    @PutMapping("/{fileId}/rename")
    public ProjectFile rename(
            @PathVariable Long projectId,
            @PathVariable Long fileId,
            @RequestBody RenameRequest request,
            @RequestHeader(value = "X-Session-Id", required = false) String sessionId) {
        Long userId = getUserIdFromSession(sessionId);
        if (userId == null) {
            throw new IllegalArgumentException("请先登录");
        }
        return projectFileService.rename(fileId, request.getName(), userId);
    }

    /**
     * 删除文件或文件夹
     * DELETE /api/projects/{projectId}/files/{fileId}
     */
    @DeleteMapping("/{fileId}")
    public Map<String, Object> delete(
            @PathVariable Long projectId,
            @PathVariable Long fileId,
            @RequestHeader(value = "X-Session-Id", required = false) String sessionId) {
        Long userId = getUserIdFromSession(sessionId);
        if (userId == null) {
            throw new IllegalArgumentException("请先登录");
        }
        projectFileService.delete(fileId, userId);
        Map<String, Object> result = new HashMap<>();
        result.put("code", 0);
        result.put("message", "删除成功");
        return result;
    }

    /**
     * 移动文件或文件夹（拖拽排序）
     * PUT /api/projects/{projectId}/files/{fileId}/move
     */
    @PutMapping("/{fileId}/move")
    public ProjectFile move(
            @PathVariable Long projectId,
            @PathVariable Long fileId,
            @RequestBody MoveRequest request,
            @RequestHeader(value = "X-Session-Id", required = false) String sessionId) {
        Long userId = getUserIdFromSession(sessionId);
        if (userId == null) {
            throw new IllegalArgumentException("请先登录");
        }
        return projectFileService.move(fileId, request.getParentId(), request.getSortOrder(), userId);
    }

    /**
     * 获取文件详情
     * GET /api/projects/{projectId}/files/{fileId}
     */
    @GetMapping("/{fileId}")
    public ProjectFile getFile(
            @PathVariable Long projectId,
            @PathVariable Long fileId,
            @RequestHeader(value = "X-Session-Id", required = false) String sessionId) {
        Long userId = getUserIdFromSession(sessionId);
        if (userId == null) {
            throw new IllegalArgumentException("请先登录");
        }
        return projectFileService.getFile(fileId);
    }

    private Long getUserIdFromSession(String sessionId) {
        return AuthController.getUserIdFromSession(sessionId);
    }

    @Data
    static class CreateFolderRequest {
        private Long parentId;
        private String name;
    }

    @Data
    static class CreateFileRequest {
        private Long parentId;
        private String name;
        private String fileType;
        private Long fileSize;
        private String filePath;
        private String wpsFileId;
    }

    @Data
    static class RenameRequest {
        private String name;
    }

    @Data
    static class MoveRequest {
        private Long parentId;
        private Integer sortOrder;
    }
}

