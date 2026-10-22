// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.controller;

import com.checkba.model.entity.DdAiJob;
import com.checkba.service.*;
import com.checkba.service.dd.DdAiService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import java.util.Map;

/** Local destination ids are resolved here, outside the /api/dd cloud proxy. */
@RestController @RequestMapping("/api/projects/{projectId}/dd-materials") @RequiredArgsConstructor
public class DdMaterialController {
    private final DdAiService jobs;
    private final ProjectMemberService members;
    private final ProjectFileAccessService access;
    private Long writer(String session, Long projectId) {
        Long user = AuthController.getUserIdFromSession(session);
        if (user == null) throw new ResponseStatusException(HttpStatus.UNAUTHORIZED);
        if (access.isClient(projectId, user) || !members.hasWritePermission(projectId, user)) throw new ResponseStatusException(HttpStatus.FORBIDDEN);
        return user;
    }
    @PostMapping({"/import", "/report"})
    public Map<String, Object> start(@PathVariable Long projectId, @RequestHeader(value = "X-Session-Id", required = false) String session,
            @RequestBody MaterialRequest input, jakarta.servlet.http.HttpServletRequest request) {
        Long user = writer(session, projectId), requestId = input.requestId();
        if (requestId == null || requestId <= 0) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "请选择清单");
        String kind = request.getRequestURI().endsWith("/report") ? "REPORT" : "MATERIALS";
        return jobs.view(jobs.enqueue(projectId, user, kind, null, null, Map.of("requestId", requestId), input.idempotencyKey()));
    }
    public record MaterialRequest(Long requestId, String idempotencyKey) {}
    @GetMapping("/jobs/{jobId}")
    public Map<String, Object> job(@PathVariable Long projectId, @PathVariable String jobId,
            @RequestHeader(value = "X-Session-Id", required = false) String session) {
        writer(session, projectId); DdAiJob job = jobs.get(jobId);
        if (!projectId.equals(job.getProjectId())) throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        return jobs.view(job);
    }
    @ExceptionHandler(ResponseStatusException.class)
    public org.springframework.http.ResponseEntity<Map<String, Object>> accessError(ResponseStatusException e) {
        return org.springframework.http.ResponseEntity.status(e.getStatusCode()).body(Map.of("code", e.getStatusCode().value(), "message", java.util.Objects.toString(e.getReason(), "无权进行此操作或资源不存在")));
    }
    @ExceptionHandler(IllegalArgumentException.class)
    public org.springframework.http.ResponseEntity<Map<String, Object>> invalid(IllegalArgumentException e) {
        return org.springframework.http.ResponseEntity.badRequest().body(Map.of("code", 400, "message", java.util.Objects.toString(e.getMessage(), "请求参数有误")));
    }
}
