// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.controller;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.availability.ApplicationAvailability;
import org.springframework.boot.availability.ReadinessState;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.Map;

/** LocalModeAccessFilter and LocalModeLoopbackGuard restrict this profile to loopback. */
@RestController
@ConditionalOnProperty(name = "security.local-mode", havingValue = "true")
public class DesktopHealthController {
    private final DataSource dataSource;
    private final ApplicationAvailability availability;

    public DesktopHealthController(DataSource dataSource, ApplicationAvailability availability) {
        this.dataSource = dataSource;
        this.availability = availability;
    }

    /** Full backend path for the startup probe. The early core implements its own narrower readiness. */
    @GetMapping("/api/desktop/startup-health")
    public ResponseEntity<Map<String, String>> startupHealth() {
        ResponseEntity<Map<String, String>> health = health();
        if (!health.getStatusCode().is2xxSuccessful()) return health;
        var body = new java.util.HashMap<>(health.getBody());
        body.put("phase", "full");
        return ResponseEntity.ok(body);
    }

    @GetMapping("/api/desktop/health")
    public ResponseEntity<Map<String, String>> health() {
        // A listening server/database can precede repository validation, runners and ready listeners.
        if (availability.getReadinessState() != ReadinessState.ACCEPTING_TRAFFIC) {
            return ResponseEntity.status(503).body(Map.of("status", "DOWN"));
        }
        // Desktop Hikari acquisition is bounded to 2s; no business transactions or project locks.
        try (Connection connection = dataSource.getConnection();
             Statement statement = connection.createStatement()) {
            statement.setQueryTimeout(1);
            try (ResultSet result = statement.executeQuery("SELECT 1")) {
                if (result.next() && result.getInt(1) == 1) {
                    return ResponseEntity.ok(Map.of("status", "UP", "build",
                            System.getenv().getOrDefault("AWD_BACKEND_BUILD", "")));
                }
            }
        } catch (SQLException ignored) {
            // Do not expose JDBC URLs or credentials through a diagnostic response.
        }
        return ResponseEntity.status(503).body(Map.of("status", "DOWN"));
    }
}
