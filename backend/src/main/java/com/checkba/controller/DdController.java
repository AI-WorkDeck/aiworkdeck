// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.controller;

import com.checkba.model.entity.DdComment;
import com.checkba.model.entity.DdItem;
import com.checkba.model.entity.DdRequest;
import com.checkba.model.entity.DdSubmission;
import com.checkba.model.entity.DdNotification;
import com.checkba.service.DdWorkflowService;
import com.checkba.service.DdService;
import com.checkba.service.LangText;
import com.checkba.service.ProjectMemberService;
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
    private final DdWorkflowService workflow;
    private final ProjectMemberService projectMemberService;
    private final com.checkba.service.ProjectFileAccessService fileAccess;

    // ==================== 越权校验 ====================
    // 此前各端点仅校验"是否登录"、从不校验项目成员，且读端点完全无鉴权，
    // 导致任意登录用户（含他人项目的 CLIENT）可跨项目读写删尽调数据。

    private Long requireMemberByProject(String sessionId, Long projectId) {
        Long userId = AuthController.getUserIdFromSession(sessionId);
        if (userId == null) throw new IllegalArgumentException("未登录");
        if (projectId == null || !projectMemberService.hasReadPermission(projectId, userId)) {
            throw new IllegalArgumentException(LangText.of("无权访问该资源", "You don't have permission to access this resource"));
        }
        return userId;
    }

    private Long requireMemberByRequest(String sessionId, Long requestId) {
        Long userId = requireMemberByProject(sessionId, ddService.getProjectIdByRequestId(requestId));
        workflow.requireVisibleRequest(requestId, userId);
        return userId;
    }

    private Long requireMemberByItem(String sessionId, Long itemId) {
        Long userId = requireMemberByProject(sessionId, ddService.getProjectIdByItemId(itemId));
        workflow.requireVisibleItem(itemId, userId);
        return userId;
    }

    // ==================== 客户白名单（dev-board#1050） ====================
    // 案件库托管客户门户之后，CLIENT 是公网上凭一串访问码就能进来的人。客户只做三件事：
    // 看清单、给清单项传文件、留言（外加回看自己传过的文件）。其余写端点——建/改/删/复制
    // 清单、增删改移清单项、改审核状态——一律 403。成员校验照旧在前面（非成员仍是原来的
    // 「无权访问」），这里只多拦一层角色。

    /** CLIENT 撞到写端点。单独一个类型，好让本控制器回真 403 而不是全站统一的 200+code。 */
    static class ClientForbiddenException extends IllegalArgumentException {
        ClientForbiddenException() {
            super(LangText.of("客户无权进行此操作", "Clients are not allowed to do this"));
        }
    }

    @ExceptionHandler(ClientForbiddenException.class)
    public ResponseEntity<Map<String, Object>> onClientForbidden(ClientForbiddenException e) {
        return ResponseEntity.status(org.springframework.http.HttpStatus.FORBIDDEN)
                .body(Map.of("code", 403, "message", e.getMessage()));
    }

    @ExceptionHandler(com.checkba.service.ProjectFileAccessService.FileAccessDeniedException.class)
    public ResponseEntity<Map<String, Object>> onFileAccessDenied(
            com.checkba.service.ProjectFileAccessService.FileAccessDeniedException e) {
        return ResponseEntity.status(403).body(Map.of("code", 403, "message", e.getMessage()));
    }

    /** 审核状态流转不合法（未上传就通过、驳回不带理由、重复下同一结论、已通过还要再传）→ 真 HTTP 400。 */
    @ExceptionHandler(DdService.IllegalTransitionException.class)
    public ResponseEntity<Map<String, Object>> onIllegalTransition(DdService.IllegalTransitionException e) {
        return ResponseEntity.status(org.springframework.http.HttpStatus.BAD_REQUEST)
                .body(Map.of("code", 400, "message", e.getMessage()));
    }

    private Long requireStaffByProject(String sessionId, Long projectId) {
        Long userId = requireMemberByProject(sessionId, projectId);
        if (fileAccess.isClient(projectId, userId) || !projectMemberService.hasWritePermission(projectId, userId)) {
            throw new ClientForbiddenException();
        }
        return userId;
    }

    private Long requireStaffByRequest(String sessionId, Long requestId) {
        return requireStaffByProject(sessionId, ddService.getProjectIdByRequestId(requestId));
    }

    private Long requireStaffByItem(String sessionId, Long itemId) {
        return requireStaffByProject(sessionId, ddService.getProjectIdByItemId(itemId));
    }

    // 获取项目的请求列表
    @GetMapping("/projects/{projectId}")
    public List<DdRequest> getRequests(
            @PathVariable Long projectId,
            @RequestHeader(value = "X-Session-Id", required = false) String sessionId) {
        Long userId = requireMemberByProject(sessionId, projectId);
        return workflow.visibleRequests(projectId, userId);
    }

    // 创建请求
    @PostMapping("/projects/{projectId}")
    public DdRequest createRequest(
            @PathVariable Long projectId,
            @RequestBody CreateRequestDto dto,
            @RequestHeader(value = "X-Session-Id", required = false) String sessionId) {
        Long userId = requireStaffByProject(sessionId, projectId);
        return ddService.createRequest(projectId, dto.getName(), dto.getContent(), userId);
    }

    // 获取请求详情（含项）
    @GetMapping("/requests/{requestId}")
    public Map<String, Object> getRequestDetails(
            @PathVariable Long requestId,
            @RequestHeader(value = "X-Session-Id", required = false) String sessionId) {
        requireMemberByRequest(sessionId, requestId);
        DdRequest request = ddService.getRequest(requestId);
        List<DdItem> items = ddService.getItems(requestId);

        Map<String, Object> result = new HashMap<>();
        result.put("request", request);
        result.put("items", items);
        result.put("submissionsByItem", workflow.currentSubmissions(items));
        // 驳回条目的最近一条理由（itemId → 理由），客户视角直接显示在条目上（dev-board#1057）
        result.put("rejectReasons", ddService.rejectReasons(items));
        return result;
    }

    // 批量添加项
    @PostMapping("/requests/{requestId}/items")
    public List<DdItem> addItems(
            @PathVariable Long requestId,
            @RequestBody CreateRequestDto dto,
            @RequestHeader(value = "X-Session-Id", required = false) String sessionId) {
        Long userId = requireStaffByRequest(sessionId, requestId);
        return workflow.addItems(requestId, dto.getContent(), userId);
    }

    // 更新请求信息（名称）
    @PutMapping("/requests/{requestId}")
    public DdRequest updateRequest(
            @PathVariable Long requestId,
            @RequestBody UpdateRequestDto dto,
            @RequestHeader(value = "X-Session-Id", required = false) String sessionId) {
        Long userId = requireStaffByRequest(sessionId, requestId);
        return workflow.rename(requestId, dto.getName(), userId);
    }

    // 创建单个项
    @PostMapping("/requests/{requestId}/item")
    public DdItem addItem(
            @PathVariable Long requestId,
            @RequestBody AddItemDto dto,
            @RequestHeader(value = "X-Session-Id", required = false) String sessionId) {
        Long userId = requireStaffByRequest(sessionId, requestId);
        return workflow.addItem(requestId, dto.getParentId(), userId);
    }

    // 移动项（修改层级/父节点）
    @PutMapping("/items/{itemId}/parent")
    public DdItem moveItem(
            @PathVariable Long itemId,
            @RequestBody MoveItemDto dto,
            @RequestHeader(value = "X-Session-Id", required = false) String sessionId) {
        Long userId = requireStaffByItem(sessionId, itemId);
        return workflow.moveItem(itemId, dto.getParentId(), userId);
    }

    // 客户上传文件
    @PostMapping("/items/{itemId}/upload")
    public DdItem uploadFile(
            @PathVariable Long itemId,
            @RequestParam("file") MultipartFile file,
            @RequestHeader(value = "X-Session-Id", required = false) String sessionId) throws IOException {
        Long userId = requireMemberByItem(sessionId, itemId);
        return workflow.uploadLegacy(itemId, file, userId);
    }

    // 律师审核状态更新
    @PutMapping("/items/{itemId}/status")
    public DdItem updateStatus(
            @PathVariable Long itemId,
            @RequestBody UpdateStatusDto dto,
            @RequestHeader(value = "X-Session-Id", required = false) String sessionId) {
        Long userId = requireStaffByItem(sessionId, itemId);
        return workflow.review(itemId, dto.getStatus(), dto.getReason(), dto.getSubmissionId(), dto.getRevision(), userId);
    }

    // 更新项信息（标题/描述）
    @PutMapping("/items/{itemId}/info")
    public DdItem updateInfo(
            @PathVariable Long itemId,
            @RequestBody UpdateInfoDto dto,
            @RequestHeader(value = "X-Session-Id", required = false) String sessionId) {
        Long userId = requireStaffByItem(sessionId, itemId);
        return workflow.updateItem(itemId, dto.getTitle(), dto.getDescription(), userId);
    }

    // 添加评论
    @PostMapping("/items/{itemId}/comments")
    public DdComment addComment(
            @PathVariable Long itemId,
            @RequestBody CommentDto dto,
            @RequestHeader(value = "X-Session-Id", required = false) String sessionId) {
        Long userId = requireMemberByItem(sessionId, itemId);
        return workflow.comment(itemId, dto.getContent(), userId);
    }

    // 获取评论
    @GetMapping("/items/{itemId}/comments")
    public List<DdComment> getComments(
            @PathVariable Long itemId,
            @RequestHeader(value = "X-Session-Id", required = false) String sessionId) {
        requireMemberByItem(sessionId, itemId);
        return ddService.getComments(itemId);
    }

    /**
     * 清单项上已上传的那份文件（dev-board#1050）。客户与律师都可读。浏览器新开标签页带不了
     * 头，允许 {@code ?token=} 兜底（同 FileController 的下载口）。
     */
    @GetMapping("/items/{itemId}/file")
    public ResponseEntity<org.springframework.core.io.Resource> getItemFile(
            @PathVariable Long itemId,
            @RequestParam(value = "token", required = false) String token,
            @RequestHeader(value = "X-Session-Id", required = false) String sessionId) {
        Long userId = requireMemberByItem(org.springframework.util.StringUtils.hasText(sessionId) ? sessionId : token, itemId);
        com.checkba.model.entity.ProjectFile file = ddService.getUploadedFile(itemId);
        fileAccess.requireRead(file, userId);
        org.springframework.core.io.Resource resource = ddService.loadStored(file);
        String name = file.getName() == null ? "file" : file.getName();
        org.springframework.http.MediaType type = org.springframework.http.MediaTypeFactory.getMediaType(name)
                .orElse(org.springframework.http.MediaType.APPLICATION_OCTET_STREAM);
        return ResponseEntity.ok()
                .contentType(type)
                .header(org.springframework.http.HttpHeaders.CONTENT_DISPOSITION,
                        org.springframework.http.ContentDisposition.inline()
                                .filename(name, java.nio.charset.StandardCharsets.UTF_8).build().toString())
                .body(resource);
    }

    // 删除项
    @DeleteMapping("/items/{itemId}")
    public ResponseEntity<Void> deleteItem(
            @PathVariable Long itemId,
            @RequestHeader(value = "X-Session-Id", required = false) String sessionId) {
        Long userId = requireStaffByItem(sessionId, itemId);
        workflow.deleteItem(itemId, userId);
        return ResponseEntity.ok().build();
    }

    @DeleteMapping("/requests/{requestId}")
    public ResponseEntity<Void> deleteRequest(
            @PathVariable Long requestId,
            @RequestHeader(value = "X-Session-Id", required = false) String sessionId) {
        Long userId = requireStaffByRequest(sessionId, requestId);
        workflow.deleteRequest(requestId, userId);
        return ResponseEntity.ok().build();
    }

    // 复制整个清单
    @PostMapping("/requests/{requestId}/copy")
    public DdRequest copyRequest(
            @PathVariable Long requestId,
            @RequestHeader(value = "X-Session-Id", required = false) String sessionId) {
        Long userId = requireStaffByRequest(sessionId, requestId);
        return ddService.copyRequest(requestId, userId);
    }

    @ExceptionHandler(org.springframework.web.server.ResponseStatusException.class)
    public ResponseEntity<Map<String, Object>> onWorkflowError(org.springframework.web.server.ResponseStatusException e) {
        return ResponseEntity.status(e.getStatusCode()).body(Map.of("code", e.getStatusCode().value(),
                "message", e.getReason() == null ? LangText.of("请求失败", "Request failed") : e.getReason()));
    }

    @PostMapping("/requests/{requestId}/prepare-materials")
    public Map<String, Object> prepareMaterials(@PathVariable Long requestId,
                            @RequestHeader(value = "X-Session-Id", required = false) String sessionId) {
        workflow.prepareMaterials(requestId, requireStaffByRequest(sessionId, requestId));
        return Map.of("prepared", true);
    }

    @PostMapping("/requests/{requestId}/publish")
    public DdRequest publish(@PathVariable Long requestId, @RequestBody(required = false) PublishDto dto,
                            @RequestHeader(value = "X-Session-Id", required = false) String sessionId) {
        Long userId = requireStaffByRequest(sessionId, requestId);
        return workflow.publish(requestId, dto != null && dto.isAiReviewEnabled(), userId);
    }

    @PostMapping("/requests/{requestId}/archive")
    public DdRequest archive(@PathVariable Long requestId,
                            @RequestHeader(value = "X-Session-Id", required = false) String sessionId) {
        return workflow.archive(requestId, requireStaffByRequest(sessionId, requestId));
    }

    @PostMapping("/items/{itemId}/submissions")
    public DdSubmission submit(@PathVariable Long itemId,
            @RequestParam(value = "files", required = false) List<MultipartFile> files,
            @RequestParam(value = "files[]", required = false) List<MultipartFile> bracketFiles,
            @RequestParam("idempotencyKey") String idempotencyKey,
            @RequestParam(value = "aiConsent", defaultValue = "false") boolean aiConsent,
            @RequestHeader(value = "X-Session-Id", required = false) String sessionId) throws IOException {
        return workflow.submit(itemId, files == null ? bracketFiles : files, idempotencyKey, aiConsent,
                requireMemberByItem(sessionId, itemId));
    }

    @PostMapping("/items/{itemId}/explanation")
    public DdSubmission explain(@PathVariable Long itemId, @RequestBody ExplanationDto dto,
            @RequestHeader(value = "X-Session-Id", required = false) String sessionId) {
        return workflow.explain(itemId, dto.getType(), dto.getReason(), dto.getIdempotencyKey(),
                requireMemberByItem(sessionId, itemId));
    }

    @PostMapping("/items/{itemId}/appeal")
    public DdSubmission appeal(@PathVariable Long itemId, @RequestBody AppealDto dto,
            @RequestHeader(value = "X-Session-Id", required = false) String sessionId) {
        return workflow.appeal(itemId, dto.getSubmissionId(), dto.getReason(), requireMemberByItem(sessionId, itemId));
    }

    @GetMapping("/items/{itemId}/submissions")
    public List<Map<String, Object>> history(@PathVariable Long itemId,
            @RequestHeader(value = "X-Session-Id", required = false) String sessionId) {
        return workflow.history(itemId, requireMemberByItem(sessionId, itemId));
    }

    @GetMapping("/items/{itemId}/submissions/{submissionId}/files/{fileId}")
    public ResponseEntity<org.springframework.core.io.Resource> submissionFile(
            @PathVariable Long itemId, @PathVariable Long submissionId, @PathVariable Long fileId,
            @RequestParam(value = "token", required = false) String token,
            @RequestHeader(value = "X-Session-Id", required = false) String sessionId) {
        Long userId = requireMemberByItem(org.springframework.util.StringUtils.hasText(sessionId) ? sessionId : token, itemId);
        com.checkba.model.entity.ProjectFile file = workflow.submissionFile(itemId, submissionId, fileId, userId);
        String name = file.getName() == null ? "file" : file.getName();
        return ResponseEntity.ok().contentType(org.springframework.http.MediaTypeFactory.getMediaType(name)
                        .orElse(org.springframework.http.MediaType.APPLICATION_OCTET_STREAM))
                .header(org.springframework.http.HttpHeaders.CONTENT_DISPOSITION,
                        org.springframework.http.ContentDisposition.inline().filename(name, java.nio.charset.StandardCharsets.UTF_8).build().toString())
                .body(ddService.loadStored(file));
    }

    @GetMapping("/notifications")
    public List<DdNotification> notifications(@RequestParam Long projectId,
            @RequestHeader(value = "X-Session-Id", required = false) String sessionId) {
        return workflow.inbox(projectId, requireMemberByProject(sessionId, projectId));
    }

    @PostMapping("/notifications/{notificationId}/read")
    public DdNotification markNotificationRead(@PathVariable Long notificationId,
            @RequestHeader(value = "X-Session-Id", required = false) String sessionId) {
        Long userId = AuthController.getUserIdFromSession(sessionId);
        if (userId == null) throw new org.springframework.web.server.ResponseStatusException(org.springframework.http.HttpStatus.UNAUTHORIZED, LangText.of("未登录", "Not signed in"));
        return workflow.markRead(notificationId, userId);
    }

    @Data static class PublishDto { private boolean aiReviewEnabled; }
    @Data static class ExplanationDto { private String type; private String reason; private String idempotencyKey; }
    @Data static class AppealDto { private Long submissionId; private String reason; }

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
        /** 驳回理由（status=REJECTED 时必填），落成一条「驳回：」前缀的留言。 */
        private String reason;
        private Long submissionId;
        private Long revision;
        public Long getSubmissionId() { return submissionId; }
        public void setSubmissionId(Long value) { submissionId = value; }
        public Long getRevision() { return revision; }
        public void setRevision(Long value) { revision = value; }
        public String getStatus() { return status; }
        public void setStatus(String status) { this.status = status; }
        public String getReason() { return reason; }
        public void setReason(String reason) { this.reason = reason; }
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
