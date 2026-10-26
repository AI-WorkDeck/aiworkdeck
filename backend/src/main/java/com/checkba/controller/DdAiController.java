// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.controller;

import com.checkba.model.entity.*;
import com.checkba.repository.*;
import com.checkba.service.*;
import com.checkba.service.dd.DdAiService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;
import java.io.*;
import java.util.*;

@RestController @RequestMapping("/api/dd") @RequiredArgsConstructor
public class DdAiController {
    private final DdAiService ai;
    private final DdService dd;
    private final DdWorkflowService workflow;
    private final DdItemRepository items;
    private final DdSubmissionRepository submissions;
    private final ProjectFileRepository files;
    private final ProjectMemberService members;
    private final ProjectFileAccessService access;
    private final DocumentTextService documents;

    private Long member(String session, Long projectId) {
        Long user = AuthController.getUserIdFromSession(session);
        if (user == null) throw new ResponseStatusException(HttpStatus.UNAUTHORIZED);
        if (!members.hasReadPermission(projectId, user)) throw new ResponseStatusException(HttpStatus.FORBIDDEN);
        return user;
    }
    private Long writer(String session, Long projectId) {
        Long user = member(session, projectId);
        if (access.isClient(projectId, user) || !members.hasWritePermission(projectId, user))
            throw new ResponseStatusException(HttpStatus.FORBIDDEN);
        return user;
    }
    private void requirePublished(DdRequest request, Long userId) {
        if (access.isClient(request.getProjectId(), userId) && !Set.of("PUBLISHED", "COMPLETED", "ARCHIVED").contains(request.getStatus()))
            throw new ResponseStatusException(HttpStatus.NOT_FOUND);
    }

    @PostMapping(value = "/projects/{projectId}/import", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public Map<String, Object> importChecklist(@PathVariable Long projectId,
            @RequestHeader(value = "X-Session-Id", required = false) String session,
            @RequestParam(required = false) MultipartFile file, @RequestParam(required = false) String content,
            @RequestParam(required = false) String idempotencyKey,
            @RequestParam(defaultValue = "导入的尽调清单") String name) throws IOException, org.apache.tika.exception.TikaException {
        Long user = writer(session, projectId);
        String text = content;
        if (file != null && !file.isEmpty()) {
            if (file.getSize() > 20 * 1024 * 1024) throw new IllegalArgumentException(LangText.of("请导入20MB以内的清单文件", "Please import a checklist file within 20 MB"));
            String filename = Objects.toString(file.getOriginalFilename(), "").toLowerCase(Locale.ROOT);
            if (!filename.matches(".*\\.(pdf|docx|doc|xlsx|xls|txt|md|csv)$")) throw new IllegalArgumentException(LangText.of("支持Word、PDF、Excel或文字清单", "Supports Word, PDF, Excel, or text checklists"));
            try (InputStream stream = file.getInputStream()) { text = filename.endsWith(".pdf") ? documents.parsePdf(stream) : documents.parse(stream); }
        }
        if (text == null || text.isBlank()) throw new IllegalArgumentException(LangText.of("未能读取清单文字，请导入含文字的文件或直接粘贴内容", "Failed to read checklist text; please import a file containing text or paste the content directly"));
        if (text.length() > 200_000) throw new IllegalArgumentException(LangText.of("清单内容过长，请分轮导入；系统没有截断原文", "Checklist content is too long; please import in batches (original text was not truncated)"));
        if (name.isBlank() || name.length() > 200) throw new IllegalArgumentException(LangText.of("清单名称需在1至200字之间", "Checklist name must be between 1 and 200 characters"));
        String resolvedName = "导入的尽调清单".equals(name) ? LangText.of("导入的尽调清单", "Imported Due Diligence Checklist") : name.strip();
        return ai.view(ai.enqueue(projectId, user, "IMPORT", null, null, Map.of("content", text, "name", resolvedName), idempotencyKey));
    }

    @PostMapping("/items/{itemId}/example")
    public Map<String, Object> example(@PathVariable Long itemId, @RequestHeader(value = "X-Session-Id", required = false) String session) {
        Long user = writer(session, dd.getProjectIdByItemId(itemId));
        return ai.view(ai.example(itemId, user));
    }

    @GetMapping("/items/{itemId}/example/file")
    public ResponseEntity<org.springframework.core.io.Resource> exampleFile(@PathVariable Long itemId,
            @RequestHeader(value = "X-Session-Id", required = false) String session, @RequestParam(required = false) String token) {
        DdItem item = items.findById(itemId).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
        DdRequest request = dd.getRequest(item.getDdRequestId());
        Long user = member(session == null ? token : session, request.getProjectId()); requirePublished(request, user);
        ProjectFile file = files.findById(item.getExampleFileId() == null ? -1L : item.getExampleFileId())
                .filter(f -> request.getProjectId().equals(f.getProjectId()) && !Boolean.TRUE.equals(f.getIsDeleted()))
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
        return ResponseEntity.ok().contentType(MediaType.IMAGE_PNG).header("Cache-Control", "private, no-store")
                .header("X-Content-Type-Options", "nosniff").body(dd.loadStored(file));
    }

    @PostMapping("/items/{itemId}/verify")
    public Map<String, Object> verify(@PathVariable Long itemId, @RequestHeader(value = "X-Session-Id", required = false) String session,
            @RequestBody Map<String, Long> body) {
        DdRequest request = dd.getRequest(items.findById(itemId).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND)).getDdRequestId());
        Long user = member(session, request.getProjectId()); requirePublished(request, user);
        workflow.requireContributor(request.getProjectId(), user);
        DdSubmission submission = submissions.findById(body.getOrDefault("submissionId", -1L)).filter(s -> itemId.equals(s.getItemId())).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
        if (access.isClient(request.getProjectId(), user)) {
            if (!user.equals(submission.getSubmittedBy())) throw new ResponseStatusException(HttpStatus.FORBIDDEN);
        } else writer(session, request.getProjectId());
        return ai.view(ai.reviewSubmission(submission.getId()));
    }

    @GetMapping("/jobs/{jobId}")
    public Map<String, Object> job(@PathVariable String jobId, @RequestHeader(value = "X-Session-Id", required = false) String session) {
        DdAiJob job = ai.get(jobId); Long user = member(session, job.getProjectId());
        if (access.isClient(job.getProjectId(), user)) {
            if (!"VERIFY".equals(job.getKind()) || job.getSubmissionId() == null) throw new ResponseStatusException(HttpStatus.FORBIDDEN);
            DdSubmission submission = submissions.findById(job.getSubmissionId()).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
            requirePublished(dd.getRequest(submission.getRequestId()), user);
            if (!user.equals(submission.getSubmittedBy())) throw new ResponseStatusException(HttpStatus.FORBIDDEN);
        }
        return ai.view(job);
    }

    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<Map<String, Object>> invalid(IllegalArgumentException e) {
        return ResponseEntity.badRequest().body(Map.of("code", 400, "message", Objects.toString(e.getMessage(), LangText.of("请求参数有误", "Invalid request parameters"))));
    }
    @ExceptionHandler(ResponseStatusException.class)
    public ResponseEntity<Map<String, Object>> accessError(ResponseStatusException e) {
        return ResponseEntity.status(e.getStatusCode()).body(Map.of("code", e.getStatusCode().value(), "message", Objects.toString(e.getReason(), LangText.of("无权进行此操作或资源不存在", "Permission denied or resource not found"))));
    }
}
