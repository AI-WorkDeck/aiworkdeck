// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.controller;

import com.checkba.service.mobile.MobileRelayClientService;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import java.util.Map;
import static org.mockito.Mockito.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

class MobileReceiveControllerTest {
    @Test
    void controllerIsOnlyRegisteredOnLocalDesktop() {
        var runner = new org.springframework.boot.test.context.runner.ApplicationContextRunner()
                .withBean(MobileRelayClientService.class, () -> mock(MobileRelayClientService.class))
                .withUserConfiguration(MobileReceiveController.class);
        runner.withPropertyValues("security.local-mode=false").run(context ->
                assertEquals(0, context.getBeansOfType(MobileReceiveController.class).size()));
        runner.withPropertyValues("security.local-mode=true").run(context ->
                assertEquals(1, context.getBeansOfType(MobileReceiveController.class).size()));
    }

    @Test
    void statusAndCheckRequireIdentityAndPassExactProjectKey() throws Exception {
        var client = mock(MobileRelayClientService.class);
        try (var auth = mockStatic(AuthController.class)) {
            auth.when(() -> AuthController.getUserIdFromSession(null)).thenReturn(null);
            var controller = new MobileReceiveController(client);
            assertThrows(com.checkba.exception.UnauthorizedException.class, () -> controller.status(null, "42"));
            assertThrows(com.checkba.exception.UnauthorizedException.class, () -> controller.check(null));
            verifyNoInteractions(client);
            auth.when(() -> AuthController.getUserIdFromSession("session")).thenReturn(7L);
            when(client.receiveStatus("42")).thenReturn(Map.of("active", true, "deviceId", "desktop-42"));
            var mvc = MockMvcBuilders.standaloneSetup(controller).build();
            mvc.perform(get("/api/mobile-receive/status").param("projectKey", "42").header("X-Session-Id", "session"))
                    .andExpect(status().isOk()).andExpect(jsonPath("$.deviceId").value("desktop-42"));
            mvc.perform(post("/api/mobile-receive/check").header("X-Session-Id", "session"))
                    .andExpect(status().isOk()).andExpect(jsonPath("$.code").value(0));
            verify(client).receiveNow();
        }
    }

    /** 问题 6：欢迎页「账户中的项目」报「服务器内部错误」——未登录要回 4010，云端失败要透出可读文案。 */
    @Test
    void catalogErrorsAreReadableAndSignedOutIs4010() throws Exception {
        var client = mock(MobileRelayClientService.class);
        try (var auth = mockStatic(AuthController.class)) {
            auth.when(() -> AuthController.getUserIdFromSession(null)).thenReturn(null);
            auth.when(() -> AuthController.getUserIdFromSession("session")).thenReturn(7L);
            var mvc = MockMvcBuilders.standaloneSetup(new MobileReceiveController(client))
                    .setControllerAdvice(new com.checkba.config.GlobalExceptionHandler()).build();
            mvc.perform(get("/api/mobile-receive/catalog"))
                    .andExpect(status().isOk()).andExpect(jsonPath("$.code").value(4010));
            when(client.catalog()).thenThrow(new IllegalStateException("云端项目目录暂不可用", new java.io.IOException("boom")));
            mvc.perform(get("/api/mobile-receive/catalog").header("X-Session-Id", "session"))
                    .andExpect(status().isOk()).andExpect(jsonPath("$.code").value(1))
                    .andExpect(jsonPath("$.message").value("云端项目目录暂不可用"));
        }
    }
}
