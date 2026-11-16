// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ai;

import dev.langchain4j.data.message.ChatMessage;

import java.util.List;

/** 测试用：从别的包调到包内可见的 {@link AgentOrchestrator#appendViewedPages}。 */
public final class AgentOrchestratorViewedPagesAccess {
    private AgentOrchestratorViewedPagesAccess() {}

    public static void append(List<ChatMessage> messages, ToolImageInbox.Batch batch) {
        AgentOrchestrator.appendViewedPages(messages, batch);
    }
}
