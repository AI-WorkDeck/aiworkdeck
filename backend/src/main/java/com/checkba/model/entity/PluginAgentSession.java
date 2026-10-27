// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.model.entity;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

/** Durable ownership and idempotent creation of a plugin's native Agent conversation. */
@Entity
@Table(name = "plugin_agent_session", uniqueConstraints = @UniqueConstraint(
        name = "uk_plugin_agent_session_scope", columnNames = {"plugin_id", "user_id", "project_id", "session_key"}))
@Getter
@Setter
public class PluginAgentSession {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    @Column(name = "plugin_id", nullable = false, length = 80)
    private String pluginId;
    @Column(name = "user_id", nullable = false)
    private Long userId;
    @Column(name = "project_id", nullable = false)
    private Long projectId;
    @Column(name = "session_key", nullable = false, length = 80)
    private String sessionKey;
    @Column(name = "conversation_id", nullable = false, unique = true, length = 64)
    private String conversationId;
    @Column(nullable = false, length = 120)
    private String title;
}
