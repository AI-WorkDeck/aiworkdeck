// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.controller.ai;

import com.checkba.config.LocalModeAccessFilter;
import com.checkba.service.ai.mcp.UserMcpOAuthService;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import static org.hamcrest.Matchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

class UserMcpOAuthControllerTest {
    final UserMcpOAuthService service = mock(UserMcpOAuthService.class);
    final MockMvc mvc = MockMvcBuilders.standaloneSetup(new UserMcpOAuthController(service))
            .addFilters(new LocalModeAccessFilter(true, "", false)).build();

    @Test void browserCallbackNeedsNoSessionAndCarriesNoStoreHeaders() throws Exception {
        mvc.perform(get("/api/mcp/oauth/callback").param("state", "single-use").param("code", "secret-code")
                        .param("iss", "https://auth.example.com").header("Origin", "https://auth.example.com")
                        .with(request -> { request.setRemoteAddr("127.0.0.1"); return request; }))
                .andExpect(status().isOk()).andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(header().string("Referrer-Policy", "no-referrer"))
                .andExpect(header().string("X-Content-Type-Options", "nosniff"))
                .andExpect(content().contentTypeCompatibleWith("text/plain"))
                .andExpect(content().string(not(containsString("secret-code"))));
        verify(service).callback("single-use", "secret-code", null, "https://auth.example.com");
    }
    @Test void providerErrorsAndExceptionsAreNeverReflected() throws Exception {
        doThrow(new IllegalStateException("SECRET-REMOTE-BODY token=secret-token")).when(service).callback("state", null, "access_denied", null);
        mvc.perform(get("/api/mcp/oauth/callback").param("state", "state").param("error", "access_denied")
                        .param("error_description", "SECRET-REMOTE-BODY").with(request -> { request.setRemoteAddr("127.0.0.1"); return request; }))
                .andExpect(status().isBadRequest()).andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(content().string(not(containsString("SECRET")))).andExpect(content().string(not(containsString("secret-token"))));
    }
    @Test void callbackDoesNotRelaxLocalProxyOrMutationGuards() throws Exception {
        mvc.perform(get("/api/mcp/oauth/callback").header("X-Forwarded-For", "8.8.8.8")
                        .with(request -> { request.setRemoteAddr("127.0.0.1"); return request; })).andExpect(status().isForbidden());
        mvc.perform(get("/api/mcp/oauth/callback").with(request -> { request.setRemoteAddr("10.0.0.2"); return request; }))
                .andExpect(status().isForbidden());
        mvc.perform(post("/api/mcp/oauth/callback").header("Origin", "https://attacker.example")
                        .with(request -> { request.setRemoteAddr("127.0.0.1"); return request; })).andExpect(status().isForbidden());
        verifyNoInteractions(service);
    }
}
