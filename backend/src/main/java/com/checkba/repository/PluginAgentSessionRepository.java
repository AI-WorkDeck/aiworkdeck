// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.repository;

import com.checkba.model.entity.PluginAgentSession;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.Optional;

public interface PluginAgentSessionRepository extends JpaRepository<PluginAgentSession, Long> {
    Optional<PluginAgentSession> findByPluginIdAndUserIdAndProjectIdAndSessionKey(
            String pluginId, Long userId, Long projectId, String sessionKey);
}
