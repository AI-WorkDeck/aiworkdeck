package com.checkba.controller;

import com.checkba.model.entity.DdComment;
import com.checkba.model.entity.DdItem;
import com.checkba.model.entity.DdRequest;
import com.checkba.service.DdService;
import lombok.Data;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/dd")
@RequiredArgsConstructor
public class DdController {

    private final DdService ddService;

    // 获取项目的请求列表
    @GetMapping("/projects/{projectId}")
    public List<DdRequest> getRequests(@PathVariable Long projectId) {
        return ddService.getRequests(projectId);
    }

    // 创建请求
    @PostMapping("/projects/{projectId}")
    public DdRequest createRequest(
            @PathVariable Long projectId,
            @RequestBody CreateRequestDto dto,
            @RequestHeader(value = "X-Session-Id", required = false) String sessionId) {
        Long userId = AuthController.getUserIdFromSession(sessionId);
        if (userId == null) throw new IllegalArgumentException("未登录");
        return ddService.createRequest(projectId, dto.getName(), dto.getContent(), userId);
    }

    // 获取请求详情（含项）
    @GetMapping("/requests/{requestId}")
    public Map<String, Object> getRequestDetails(@PathVariable Long requestId) {
        DdRequest request = ddService.getRequest(requestId);
        List<DdItem> items = ddService.getItems(requestId);
        
        Map<String, Object> result = new HashMap<>();
        result.put("request", request);
        result.put("items", items);
        return result;
    }

    // 批量添加项
    @PostMapping("/requests/{requestId}/items")
    public List<DdItem> addItems(
            @PathVariable Long requestId,
            @RequestBody CreateRequestDto dto,
            @RequestHeader(value = "X-Session-Id", required = false) String sessionId) {
        Long userId = AuthController.getUserIdFromSession(sessionId);
        if (userId == null) throw new IllegalArgumentException("未登录");
        return ddService.addItems(requestId, dto.getContent());
    }

    // 更新请求信息（名称）
    @PutMapping("/requests/{requestId}")
    public DdRequest updateRequest(
            @PathVariable Long requestId,
            @RequestBody UpdateRequestDto dto,
            @RequestHeader(value = "X-Session-Id", required = false) String sessionId) {
        Long userId = AuthController.getUserIdFromSession(sessionId);
        if (userId == null) throw new IllegalArgumentException("未登录");
        return ddService.updateRequest(requestId, dto.getName());
    }

    // 创建单个项
    @PostMapping("/requests/{requestId}/item")
    public DdItem addItem(
            @PathVariable Long requestId,
            @RequestBody AddItemDto dto,
            @RequestHeader(value = "X-Session-Id", required = false) String sessionId) {
        Long userId = AuthController.getUserIdFromSession(sessionId);
        if (userId == null) throw new IllegalArgumentException("未登录");
        return ddService.addItem(requestId, dto.getParentId());
    }

    // 移动项（修改层级/父节点）
    @PutMapping("/items/{itemId}/parent")
    public DdItem moveItem(
            @PathVariable Long itemId,
            @RequestBody MoveItemDto dto,
            @RequestHeader(value = "X-Session-Id", required = false) String sessionId) {
        Long userId = AuthController.getUserIdFromSession(sessionId);
        if (userId == null) throw new IllegalArgumentException("未登录");
        return ddService.moveItem(itemId, dto.getParentId());
    }

    // 客户上传文件
    @PostMapping("/items/{itemId}/upload")
    public DdItem uploadFile(
            @PathVariable Long itemId,
            @RequestParam("file") MultipartFile file,
            @RequestHeader(value = "X-Session-Id", required = false) String sessionId) throws IOException {
        Long userId = AuthController.getUserIdFromSession(sessionId);
        if (userId == null) throw new IllegalArgumentException("未登录");
        return ddService.uploadFile(itemId, file, userId);
    }

    // 律师审核状态更新
    @PutMapping("/items/{itemId}/status")
    public DdItem updateStatus(
            @PathVariable Long itemId,
            @RequestBody UpdateStatusDto dto,
            @RequestHeader(value = "X-Session-Id", required = false) String sessionId) {
        Long userId = AuthController.getUserIdFromSession(sessionId);
        if (userId == null) throw new IllegalArgumentException("未登录");
        return ddService.updateItemStatus(itemId, dto.getStatus());
    }

    // 更新项信息（标题/描述）
    @PutMapping("/items/{itemId}/info")
    public DdItem updateInfo(
            @PathVariable Long itemId,
            @RequestBody UpdateInfoDto dto,
            @RequestHeader(value = "X-Session-Id", required = false) String sessionId) {
        Long userId = AuthController.getUserIdFromSession(sessionId);
        if (userId == null) throw new IllegalArgumentException("未登录");
        return ddService.updateItemInfo(itemId, dto.getTitle(), dto.getDescription());
    }

    // 添加评论
    @PostMapping("/items/{itemId}/comments")
    public DdComment addComment(
            @PathVariable Long itemId,
            @RequestBody CommentDto dto,
            @RequestHeader(value = "X-Session-Id", required = false) String sessionId) {
        Long userId = AuthController.getUserIdFromSession(sessionId);
        if (userId == null) throw new IllegalArgumentException("未登录");
        return ddService.addComment(itemId, userId, dto.getContent());
    }

    // 获取评论
    @GetMapping("/items/{itemId}/comments")
    public List<DdComment> getComments(@PathVariable Long itemId) {
        return ddService.getComments(itemId);
    }

    // 删除项
    @DeleteMapping("/items/{itemId}")
    public ResponseEntity<Void> deleteItem(
            @PathVariable Long itemId,
            @RequestHeader(value = "X-Session-Id", required = false) String sessionId) {
        Long userId = AuthController.getUserIdFromSession(sessionId);
        if (userId == null) throw new IllegalArgumentException("未登录");
        ddService.deleteItem(itemId, userId);
        return ResponseEntity.ok().build();
    }
    
    @DeleteMapping("/requests/{requestId}")
    public ResponseEntity<Void> deleteRequest(
            @PathVariable Long requestId,
            @RequestHeader(value = "X-Session-Id", required = false) String sessionId) {
        Long userId = AuthController.getUserIdFromSession(sessionId);
        if (userId == null) throw new IllegalArgumentException("未登录");
        ddService.deleteRequest(requestId, userId);
        return ResponseEntity.ok().build();
    }

    // 复制整个清单
    @PostMapping("/requests/{requestId}/copy")
    public DdRequest copyRequest(
            @PathVariable Long requestId,
            @RequestHeader(value = "X-Session-Id", required = false) String sessionId) {
        Long userId = AuthController.getUserIdFromSession(sessionId);
        if (userId == null) throw new IllegalArgumentException("未登录");
        return ddService.copyRequest(requestId, userId);
    }

    static class CreateRequestDto {
        private String name;
        private String content;

        public String getName() { return name; }
        public void setName(String name) { this.name = name; }
        public String getContent() { return content; }
        public void setContent(String content) { this.content = content; }
    }

    static class UpdateRequestDto {
        private String name;
        public String getName() { return name; }
        public void setName(String name) { this.name = name; }
    }

    static class UpdateStatusDto {
        private String status;
        public String getStatus() { return status; }
        public void setStatus(String status) { this.status = status; }
    }

    static class UpdateInfoDto {
        private String title;
        private String description;
        public String getTitle() { return title; }
        public void setTitle(String title) { this.title = title; }
        public String getDescription() { return description; }
        public void setDescription(String description) { this.description = description; }
    }

    static class AddItemDto {
        private Long parentId;
        public Long getParentId() { return parentId; }
        public void setParentId(Long parentId) { this.parentId = parentId; }
    }

    static class MoveItemDto {
        private Long parentId;
        public Long getParentId() { return parentId; }
        public void setParentId(Long parentId) { this.parentId = parentId; }
    }

    static class CommentDto {
        private String content;
        public String getContent() { return content; }
        public void setContent(String content) { this.content = content; }
    }
}
