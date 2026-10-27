// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.controller;

import com.checkba.repository.UserRepository;
import com.checkba.service.AdminAccessService;
import com.checkba.service.LibreOfficePdfConverter;
import com.checkba.service.ai.tools.PythonTools;
import com.checkba.service.tmeet.TmeetCliService;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/** Desktop-only, read-only probes. Never launches installers, logs in, or opens user files. */
@RestController
@RequestMapping("/api/external-dependencies")
@RequiredArgsConstructor
public class ExternalDependenciesController {
    private final LibreOfficePdfConverter libreOffice;
    private final PythonTools pythonTools;
    private final TmeetCliService tmeet;
    private final UserRepository users;
    private final AdminAccessService admins;
    @Value("${security.local-mode:false}") private boolean localMode;

    @GetMapping
    public ResponseEntity<Map<String, Object>> check(
            @RequestHeader(value = "X-Session-Id", required = false) String session) {
        Long userId = AuthController.getUserIdFromSession(session);
        if (!localMode || userId == null || !users.findById(userId).map(admins::isAdmin).orElse(false)) {
            return ResponseEntity.status(403).body(Map.of("code", 1, "message", "Desktop administrator required"));
        }
        String os = System.getProperty("os.name", "").toLowerCase(Locale.ROOT);
        String platform = os.startsWith("windows") ? "windows" : os.startsWith("mac") ? "mac" : "other";
        // Each dependency is independent: one broken installation must not hide the others.
        return ResponseEntity.ok(Map.of("code", 0, "platform", platform, "dependencies", List.of(
                status("libreoffice", () -> libreOffice.probe().status()),
                status("docker", pythonTools::refreshDockerStatus),
                status("tmeet", tmeet::probeCliStatus))));
    }

    static Map<String, String> status(String id, java.util.function.Supplier<String> probe) {
        try { return Map.of("id", id, "status", probe.get()); }
        catch (RuntimeException e) { return Map.of("id", id, "status", "FAILED"); }
    }
}
