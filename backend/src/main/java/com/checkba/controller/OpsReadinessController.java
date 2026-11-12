// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.controller;

import org.springframework.beans.factory.ObjectProvider;
import org.springframework.boot.actuate.health.HealthComponent;
import org.springframework.boot.actuate.health.HealthEndpoint;
import org.springframework.boot.actuate.health.Status;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/**
 * Public readiness probe for server profiles (application-ops.yml): the actuator "readiness"
 * group (readinessState, db, diskSpace) collapsed to UP/DOWN with no component detail.
 * Details live only on the loopback management port. Without the ops profile the health
 * endpoint is disabled and this path is a plain 404 (desktop has /api/desktop/health).
 */
@RestController
public class OpsReadinessController {
    private static final Map<String, String> UP = Map.of("status", "UP");
    private static final Map<String, String> DOWN = Map.of("status", "DOWN");

    private final ObjectProvider<HealthEndpoint> health;

    public OpsReadinessController(ObjectProvider<HealthEndpoint> health) {
        this.health = health;
    }

    @GetMapping("/api/health/ready")
    public ResponseEntity<Map<String, String>> ready() {
        HealthEndpoint endpoint = health.getIfAvailable();
        if (endpoint == null) return ResponseEntity.notFound().build();
        HealthComponent readiness = endpoint.healthForPath("readiness");
        boolean up = readiness != null && Status.UP.equals(readiness.getStatus());
        return up ? ResponseEntity.ok(UP) : ResponseEntity.status(503).body(DOWN);
    }
}
