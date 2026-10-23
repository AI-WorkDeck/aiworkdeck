// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.controller.ai;

import com.checkba.controller.AuthController;
import com.checkba.service.ai.PluginService;
import com.checkba.service.messagecenter.MessageCenterGateway;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import java.nio.charset.StandardCharsets;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class PluginNotificationsControllerTest {
    PluginService plugins=mock(PluginService.class);
    MessageCenterGateway gateway=mock(MessageCenterGateway.class);
    PluginNotificationsController controller=new PluginNotificationsController(plugins,gateway,new ObjectMapper());
    MockHttpServletRequest request(String body) {var r=new MockHttpServletRequest();r.setContent(body.getBytes(StandardCharsets.UTF_8));return r;}
    void enable(String... permissions) {
        var metadata=new PluginService.PluginMetadata();metadata.setPermissions(List.of(permissions));
        when(plugins.getPlugin("example-plugin")).thenReturn(metadata);when(plugins.isEnabled("example-plugin")).thenReturn(true);
    }
    @Test void boundPluginAndSessionIdentityAreUsedAndNoProjectIsRequired() throws Exception {
        enable("notifications");
        try(var auth=mockStatic(AuthController.class)) {
            auth.when(()->AuthController.getUserIdFromSession("session")).thenReturn(7L);
            when(gateway.publishPlugin(7L,"example-plugin",Map.of("eventKey","key","title","hello"))).thenReturn(Map.of("id","notice:1"));
            assertEquals(Map.of("id","notice:1"),controller.action("example-plugin",request("{\"action\":\"publish\",\"params\":{\"eventKey\":\"key\",\"title\":\"hello\"}}"),"session").get("data"));
            verify(gateway).publishPlugin(eq(7L),eq("example-plugin"),anyMap());
        }
    }
    @Test void disabledMissingGrantAndAnonymousRequestsFailBeforePublishing() {
        enable("file_read");
        try(var auth=mockStatic(AuthController.class)) {
            auth.when(()->AuthController.getUserIdFromSession("session")).thenReturn(7L);
            assertThrows(IllegalArgumentException.class,()->controller.action("example-plugin",request("{}"),"session"));
            enable("notifications");when(plugins.isEnabled("example-plugin")).thenReturn(false);
            assertThrows(IllegalArgumentException.class,()->controller.action("example-plugin",request("{}"),"session"));
            assertThrows(IllegalArgumentException.class,()->controller.action("example-plugin",request("{}"),null));
            verifyNoInteractions(gateway);
        }
    }
    @Test void revocationDuringResponseAndOversizedBodyDoNotReachIframe() {
        enable("notifications");
        try(var auth=mockStatic(AuthController.class)) {
            auth.when(()->AuthController.getUserIdFromSession("session")).thenReturn(7L);
            var huge=new MockHttpServletRequest();huge.setContent(new byte[65537]);
            assertThrows(IllegalArgumentException.class,()->controller.action("example-plugin",huge,"session"));verifyNoInteractions(gateway);
            when(plugins.isEnabled("example-plugin")).thenReturn(true,false);
            when(gateway.publishPlugin(eq(7L),eq("example-plugin"),anyMap())).thenReturn(Map.of("id","notice:1"));
            assertThrows(IllegalArgumentException.class,()->controller.action("example-plugin",request("{\"params\":{}}"),"session"));
        }
    }
}
