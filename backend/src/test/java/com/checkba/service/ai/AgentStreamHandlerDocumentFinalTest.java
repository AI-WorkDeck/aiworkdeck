// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.ai;

import dev.langchain4j.data.message.AiMessage;
import dev.langchain4j.model.output.Response;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class AgentStreamHandlerDocumentFinalTest {
    @Test
    void everyTagSplitPreservesBodyButExcludesFinalAndHiddenContent() {
        String text = "信件正文。<thinking>思考</thinking><process>工具</process>正文尾。<final>修改说明。</final>";
        for (int split = 1; split < text.length(); split++) {
            AgentStreamHandler handler = new AgentStreamHandler(mock(SseEmitterService.class), "split",
                    mock(TokenUsageService.class), "1", 1L, "script", 0);
            StringBuilder editor = new StringBuilder();
            StringBuilder chat = new StringBuilder();
            handler.setOnEditorStream(editor::append);
            handler.setOnToken(chat::append);
            handler.setOnComplete(ignored -> {});
            handler.onNext(text.substring(0, split));
            handler.onNext(text.substring(split));
            handler.onComplete(Response.from(AiMessage.from(text)));
            assertEquals("信件正文。正文尾。", editor.toString(), "split=" + split);
            assertEquals(text, chat.toString());
        }
    }
}
