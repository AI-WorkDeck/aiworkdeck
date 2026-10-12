// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.controller;

import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Consumer;

/** Only the owning desktop process has the per-child control token; local access filters still apply. */
@RestController
@ConditionalOnProperty(name = "security.local-mode", havingValue = "true")
public class DesktopShutdownController {
    private final ConfigurableApplicationContext context;
    private final byte[] controlToken;
    private final Consumer<Runnable> dispatch;
    private final AtomicBoolean stopping = new AtomicBoolean();

    @Autowired
    public DesktopShutdownController(ConfigurableApplicationContext context) {
        this(context, System.getenv("AWD_BACKEND_CONTROL_TOKEN"), task -> {
            Thread thread = new Thread(task, "awd-desktop-shutdown");
            thread.start();
        });
    }

    DesktopShutdownController(ConfigurableApplicationContext context, String controlToken,
                              Consumer<Runnable> dispatch) {
        this.context = context;
        this.controlToken = controlToken == null ? new byte[0] : controlToken.getBytes(StandardCharsets.UTF_8);
        this.dispatch = dispatch;
    }

    @PostMapping("/api/desktop/shutdown")
    public void shutdown(@RequestHeader(value = "X-AWD-Backend-Control-Token", required = false) String token,
                         HttpServletResponse response) throws IOException {
        if (controlToken.length == 0 || token == null
                || !MessageDigest.isEqual(controlToken, token.getBytes(StandardCharsets.UTF_8))) {
            response.setStatus(HttpServletResponse.SC_FORBIDDEN);
            return;
        }
        response.setStatus(HttpServletResponse.SC_ACCEPTED);
        response.flushBuffer();
        // Flush before closing the web server. Use a separate thread even if taskScheduler is stuck.
        if (stopping.compareAndSet(false, true)) dispatch.accept(context::close);
    }
}
