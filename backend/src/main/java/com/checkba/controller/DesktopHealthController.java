// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.controller;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
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

    public DesktopHealthController(DataSource dataSource) {
        this.dataSource = dataSource;
    }

    @GetMapping("/api/desktop/health")
    public ResponseEntity<Map<String, String>> health() {
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
