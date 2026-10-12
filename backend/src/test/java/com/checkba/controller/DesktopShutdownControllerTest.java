// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.controller;

import com.checkba.config.LocalModeAccessFilter;
import org.junit.jupiter.api.Test;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class DesktopShutdownControllerTest {
    @Test
    void rejectsMissingUnconfiguredAndWrongTokens() throws Exception {
        var context = mock(ConfigurableApplicationContext.class);
        List<Runnable> tasks = new ArrayList<>();
        for (String configured : new String[]{null, "", "expected-token"}) {
            var controller = new DesktopShutdownController(context, configured, tasks::add);
            for (String provided : new String[]{null, "", "wrong-token"}) {
                var response = new MockHttpServletResponse();
                controller.shutdown(provided, response);
                assertEquals(403, response.getStatus());
            }
        }
        assertTrue(tasks.isEmpty());
        verifyNoInteractions(context);
    }

    @Test
    void flushesAcceptedBeforeDispatchAndOnlyClosesOnce() throws Exception {
        var context = mock(ConfigurableApplicationContext.class);
        var response = new MockHttpServletResponse();
        List<Runnable> tasks = new ArrayList<>();
        var controller = new DesktopShutdownController(context, "owned-child", task -> {
            assertEquals(202, response.getStatus());
            assertTrue(response.isCommitted(), "HTTP response must be flushed before shutdown starts");
            tasks.add(task);
        });
        controller.shutdown("owned-child", response);
        controller.shutdown("owned-child", new MockHttpServletResponse());
        assertEquals(1, tasks.size());
        verifyNoInteractions(context);
        tasks.get(0).run();
        verify(context).close();
    }

    @Test
    void existingAccessFilterStillRejectsRemoteProxiedAndCrossSiteShutdown() throws Exception {
        var filter = new LocalModeAccessFilter(true, "", false);
        for (String attack : List.of("remote", "proxy", "cross-site")) {
            var request = new MockHttpServletRequest("POST", "/api/desktop/shutdown");
            request.setRemoteAddr(attack.equals("remote") ? "192.0.2.2" : "127.0.0.1");
            request.addHeader("X-AWD-Backend-Control-Token", "owned-child");
            if (attack.equals("proxy")) request.addHeader("X-Forwarded-For", "192.0.2.2");
            if (attack.equals("cross-site")) request.addHeader("Origin", "https://untrusted.example");
            var response = new MockHttpServletResponse();
            filter.doFilter(request, response, (req, res) -> fail("shutdown controller must not be reached"));
            assertEquals(403, response.getStatus());
        }
    }
}
