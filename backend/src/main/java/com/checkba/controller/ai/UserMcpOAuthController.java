// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.controller.ai;

import com.checkba.service.LangText;
import com.checkba.service.ai.mcp.UserMcpOAuthService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** Browser-only callback; a single-use state authenticates the initiating user/account/revision. */
@RestController
public class UserMcpOAuthController {
    private final UserMcpOAuthService oauth;
    public UserMcpOAuthController(UserMcpOAuthService oauth) { this.oauth = oauth; }

    @GetMapping(value="/api/mcp/oauth/callback", produces="text/plain;charset=UTF-8")
    public ResponseEntity<String> callback(@RequestParam(required=false) String state,
            @RequestParam(required=false) String code, @RequestParam(required=false) String error,
            @RequestParam(required=false) String iss) {
        boolean success;
        try { oauth.callback(state, code, error, iss); success = true; }
        catch (RuntimeException ignored) { success = false; }
        return ResponseEntity.status(success ? 200 : 400).header("Cache-Control", "no-store")
                .header("Referrer-Policy", "no-referrer").header("X-Content-Type-Options", "nosniff")
                .body(success ? LangText.of("授权成功，请返回 AI WorkDeck 的 MCP 设置继续测试和启用连接。",
                                "Authorized. Return to MCP settings in AI WorkDeck to test and enable the connection.")
                        : LangText.of("授权未完成，请返回 AI WorkDeck 的 MCP 设置重新开始。",
                                "Authorization was not completed. Return to MCP settings in AI WorkDeck and start again."));
    }
}
