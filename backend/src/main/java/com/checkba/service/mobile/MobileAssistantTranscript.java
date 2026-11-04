// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.mobile;

import com.checkba.model.entity.MobileAssistantTurn;
import com.checkba.service.LangText;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.ArrayList;
import java.util.List;

/** The same complete transcript for cloud and desktop copies; source files are never exported. */
public final class MobileAssistantTranscript {
    private MobileAssistantTranscript() {}
    public record Message(String role, String content, String createdAt) {}
    public static List<Message> from(List<MobileAssistantTurn> turns) {
        List<Message> messages = new ArrayList<>();
        for (var turn : turns) {
            messages.add(new Message("USER", turn.getQuestion(), turn.getCreatedAt().toString()));
            if (!"completed".equals(turn.getStatus())) continue;
            String answer = LangText.of("AI 生成内容，请核实后使用。",
                    "AI-generated content. Verify before use.") + "\n\n" + turn.getAnswer();
            if (turn.getSourcesJson() != null && !turn.getSourcesJson().isBlank()) {
                try {
                    var sources = new ObjectMapper().readTree(turn.getSourcesJson());
                    StringBuilder notes = new StringBuilder();
                    for (var source : sources) notes.append("\n- ").append(source.path("projectName").asText())
                            .append(" · ").append(source.path("sourceUpdatedAt").asText());
                    if (!notes.isEmpty()) answer += LangText.of("\n\n来源项目（本次仅复制对话记录，未复制来源文件）：",
                            "\n\nSource projects (transcript copied; source files were not copied):") + notes;
                } catch (java.io.IOException e) { throw new IllegalStateException("Unreadable assistant source records", e); }
            }
            messages.add(new Message("ASSISTANT", answer, turn.getCreatedAt().toString()));
        }
        return List.copyOf(messages);
    }
}
