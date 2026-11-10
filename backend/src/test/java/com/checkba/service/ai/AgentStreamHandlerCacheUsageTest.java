// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.ai;

import dev.langchain4j.data.message.AiMessage;
import dev.langchain4j.model.output.Response;
import dev.langchain4j.model.output.TokenUsage;
import org.junit.jupiter.api.Test;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

/** 缓存命中数从 onCacheUsage 落到 token_usage 记账调用上（只落库，不参与计费）。 */
class AgentStreamHandlerCacheUsageTest {

    @Test
    void cacheUsageReportedBeforeCompletionIsPassedToRecordUsage() {
        TokenUsageService service = mock(TokenUsageService.class);
        AgentStreamHandler handler = new AgentStreamHandler(mock(SseEmitterService.class), "conv",
                service, "1", 1L, "deepseek/deepseek-v4-flash", 0L);
        handler.setOnComplete(ignored -> {});
        handler.onNext("ok");
        handler.onCacheUsage(1000, 900, 0);
        handler.onComplete(Response.from(AiMessage.from("ok"), new TokenUsage(1000, 20)));
        verify(service).recordUsage(eq(1L), eq(1L), eq("deepseek/deepseek-v4-flash"), any(), eq("conv"),
                eq(900), eq(0));
    }

    @Test
    void absentCacheFieldsStayNull() {
        TokenUsageService service = mock(TokenUsageService.class);
        AgentStreamHandler handler = new AgentStreamHandler(mock(SseEmitterService.class), "conv",
                service, "1", 1L, "script", 0L);
        handler.setOnComplete(ignored -> {});
        handler.onNext("ok");
        handler.onComplete(Response.from(AiMessage.from("ok"), new TokenUsage(10, 2)));
        verify(service).recordUsage(eq(1L), eq(1L), eq("script"), any(), eq("conv"),
                org.mockito.ArgumentMatchers.<Integer>isNull(), org.mockito.ArgumentMatchers.<Integer>isNull());
    }
}
