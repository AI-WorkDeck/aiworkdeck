// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.controller;

import com.checkba.service.contractreview.ContractReviewService;
import com.checkba.service.LangText;
import com.checkba.service.contractreview.ContractReviewViews.*;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;
import java.util.List;

@RestController
@RequestMapping("/api/projects/{projectId}/contract-review")
@RequiredArgsConstructor
public class ContractReviewController {
    private final ContractReviewService service;
    private Long uid(String session) {
        Long user = AuthController.getUserIdFromSession(session);
        if (user == null) throw new IllegalArgumentException(LangText.of("请先登录", "Please sign in first"));
        return user;
    }
    @GetMapping("/standards")
    public List<StandardView> standards(@PathVariable Long projectId,
            @RequestHeader(value = "X-Session-Id", required = false) String session) {
        return service.list(uid(session), projectId);
    }
    @PostMapping("/standards")
    public StandardView save(@PathVariable Long projectId, @RequestBody SaveStandard body,
            @RequestHeader(value = "X-Session-Id", required = false) String session) {
        return service.save(uid(session), projectId, body);
    }
    @PostMapping("/standards/{id}/confirm")
    public StandardView confirm(@PathVariable Long projectId, @PathVariable Long id, @RequestBody Confirm body,
            @RequestHeader(value = "X-Session-Id", required = false) String session) {
        return service.confirm(uid(session), projectId, id, body.version());
    }
    @PostMapping("/runs")
    public RunView run(@PathVariable Long projectId, @RequestBody StartRun body,
            @RequestHeader(value = "X-Session-Id", required = false) String session) {
        return service.run(uid(session), projectId, body);
    }
    @GetMapping("/runs")
    public RunView latest(@PathVariable Long projectId, @RequestParam Long docFileId,
            @RequestHeader(value = "X-Session-Id", required = false) String session) {
        return service.latest(uid(session), projectId, docFileId);
    }
}
