// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.controller;

import com.checkba.localcore.LocalCoreApplication;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import java.io.IOException;

/** Retains the exact content protocol after the public gateway hands ownership to Spring. */
@RestController
@ConditionalOnProperty(name = "security.local-mode", havingValue = "true")
public class LocalCoreContentController {
    private final ObjectProvider<LocalCoreApplication> application;
    public LocalCoreContentController(ObjectProvider<LocalCoreApplication> application) { this.application = application; }

    @RequestMapping("/api/local-core/projects/{projectId}/files/{fileId}/content/**")
    public void content(HttpServletRequest request, HttpServletResponse response) throws IOException {
        LocalCoreApplication local = application.getIfAvailable();
        if (local == null || !local.handleContent(request, response)) response.setStatus(404);
    }
}
