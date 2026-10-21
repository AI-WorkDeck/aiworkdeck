// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.config;

import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.handler.MappedInterceptor;
import org.springframework.web.util.ServletRequestPathUtils;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class LocalProjectFileChangeOsivTest {
    @Test
    void actualInterceptorMappingExcludesProjectStreamsButKeepsOrdinaryFileRequests() {
        var registry = new InterceptorRegistry();
        new OpenEntityManagerInViewConfig().addInterceptors(registry);
        List<?> interceptors = ReflectionTestUtils.invokeMethod(registry, "getInterceptors");
        var mapped = (MappedInterceptor) interceptors.get(0);
        assertFalse(matches(mapped, "/api/projects/7/files/changes"));
        assertTrue(matches(mapped, "/api/projects/7/files"));
        assertTrue(matches(mapped, "/api/projects/7/files/8"));
    }

    private boolean matches(MappedInterceptor interceptor, String path) {
        var request = new MockHttpServletRequest("GET", path);
        ServletRequestPathUtils.parseAndCache(request);
        return interceptor.matches(request);
    }
}
