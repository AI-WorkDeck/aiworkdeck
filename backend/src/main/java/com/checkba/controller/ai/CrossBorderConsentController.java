// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.controller.ai;

import com.checkba.controller.AuthController;
import com.checkba.service.LangText;
import com.checkba.service.ai.ChatModelFactory;
import com.checkba.service.ai.CrossBorderConsentService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/**
 * 平台 AI 跨境单独同意的就地征求：{@code GET/POST /api/ai/cross-border-consent}。
 *
 * <p>判据与 {@link ChatModelFactory#crossBorderConsentRequired} 同一份（也就是运行时闸本身），
 * 前端据此在启动时、或对话被拦下时原地征求，用户不用跳去设置页。记录与设置页勾选写同样的键。
 */
@RestController
@RequestMapping("/api/ai")
@RequiredArgsConstructor
public class CrossBorderConsentController {

    private final ChatModelFactory chatModelFactory;
    private final CrossBorderConsentService crossBorderConsent;

    @GetMapping("/cross-border-consent")
    public ResponseEntity<?> status(@RequestHeader(value = "X-Session-Id", required = false) String sessionId) {
        Long userId = AuthController.getUserIdFromSession(sessionId);
        if (userId == null) return ResponseEntity.status(401).body(LangText.of("请先登录", "Please sign in first"));
        return ResponseEntity.ok(Map.of(
                "required", chatModelFactory.crossBorderConsentRequired(userId),
                "site", crossBorderConsent.currentSite(),
                "noticeVersion", CrossBorderConsentService.NOTICE_VERSION));
    }

    @PostMapping("/cross-border-consent")
    public ResponseEntity<?> accept(@RequestHeader(value = "X-Session-Id", required = false) String sessionId) {
        Long userId = AuthController.getUserIdFromSession(sessionId);
        if (userId == null) return ResponseEntity.status(401).body(LangText.of("请先登录", "Please sign in first"));
        crossBorderConsent.record();
        return ResponseEntity.ok(Map.of("required", chatModelFactory.crossBorderConsentRequired(userId)));
    }
}
