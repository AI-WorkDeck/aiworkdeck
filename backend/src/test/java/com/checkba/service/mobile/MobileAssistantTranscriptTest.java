// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.mobile;

import com.checkba.model.entity.MobileAssistantTurn;
import com.checkba.service.AppLanguageScope;
import org.junit.jupiter.api.Test;
import java.time.Instant;
import java.util.List;
import static org.junit.jupiter.api.Assertions.*;

class MobileAssistantTranscriptTest {
    @Test void marksEachCompletedAssistantAnswerWithoutChangingQuestionsOrStoredTurns() {
        var first = turn("completed", "User wording", "First answer");
        first.setSourcesJson("[{\"projectName\":\"Evidence\",\"sourceUpdatedAt\":\"2026-11-01\"}]");
        var failed = turn("failed", "Another question", "Partial answer");
        var last = turn("completed", "Final question", "Last answer");
        var messages = AppLanguageScope.call("en-US", () -> MobileAssistantTranscript.from(List.of(first, failed, last)));
        assertEquals(5, messages.size());
        assertEquals("User wording", messages.get(0).content());
        assertEquals("USER", messages.get(0).role());
        assertEquals("ASSISTANT", messages.get(1).role());
        assertEquals("AI-generated content. Verify before use.\n\nFirst answer\n\nSource projects (transcript copied; source files were not copied):\n- Evidence · 2026-11-01", messages.get(1).content());
        assertEquals("Another question", messages.get(2).content());
        assertEquals("Final question", messages.get(3).content());
        assertEquals("AI-generated content. Verify before use.\n\nLast answer", messages.get(4).content());
        assertEquals(first.getCreatedAt().toString(), messages.get(1).createdAt());
        assertEquals("First answer", first.getAnswer());
        assertEquals("User wording", first.getQuestion());
    }

    @Test void chineseCopyRetainsVisibleNoticeEvenWithoutSourceNotes() {
        var messages = AppLanguageScope.call("zh-CN", () -> MobileAssistantTranscript.from(List.of(turn("completed", "问题", "回答"))));
        assertEquals("问题", messages.get(0).content());
        assertEquals("AI 生成内容，请核实后使用。\n\n回答", messages.get(1).content());
    }

    private static MobileAssistantTurn turn(String status, String question, String answer) {
        var turn = new MobileAssistantTurn();
        turn.setStatus(status); turn.setQuestion(question); turn.setAnswer(answer);
        turn.setCreatedAt(Instant.parse("2026-11-04T00:00:00Z"));
        return turn;
    }
}
