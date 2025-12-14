package com.checkba.controller;

import com.checkba.service.DocFileLinkService;
import lombok.Data;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/projects/{projectId}/doc-links")
@CrossOrigin(origins = "*")
@RequiredArgsConstructor
public class DocFileLinkController {

    private final DocFileLinkService docFileLinkService;

    @PostMapping
    public DocFileLinkService.DocFileLinkResult createOrAppend(
            @PathVariable Long projectId,
            @RequestBody CreateOrAppendRequest request,
            @RequestHeader(value = "X-Session-Id", required = false) String sessionId
    ) {
        Long userId = getUserIdFromSession(sessionId);
        if (userId == null) throw new IllegalArgumentException("请先登录");

        return docFileLinkService.createOrAppend(
                userId,
                projectId,
                request.getDocWpsFileId(),
                request.getLinkKey(),
                request.getAnchorText(),
                request.getRangeStart(),
                request.getRangeEnd(),
                request.getFileIds()
        );
    }

    @GetMapping("/{linkKey}")
    public DocFileLinkService.DocFileLinkResult get(
            @PathVariable Long projectId,
            @PathVariable String linkKey,
            @RequestHeader(value = "X-Session-Id", required = false) String sessionId
    ) {
        Long userId = getUserIdFromSession(sessionId);
        if (userId == null) throw new IllegalArgumentException("请先登录");
        return docFileLinkService.getByKey(userId, projectId, linkKey);
    }

    private Long getUserIdFromSession(String sessionId) {
        return AuthController.getUserIdFromSession(sessionId);
    }

    @Data
    public static class CreateOrAppendRequest {
        private String docWpsFileId;
        private String linkKey;
        private String anchorText;
        private Integer rangeStart;
        private Integer rangeEnd;
        private List<Long> fileIds;
    }
}


