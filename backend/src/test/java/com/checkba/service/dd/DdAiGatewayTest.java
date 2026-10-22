// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.dd;

import com.checkba.config.AiModelProperties;
import com.checkba.service.ai.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.Test;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicInteger;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class DdAiGatewayTest {
    @Test void imageWaitsForSlowProviderWithoutRepeatingPaidRequest() throws Exception {
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        AtomicInteger requests = new AtomicInteger();
        server.createContext("/images", exchange -> {
            requests.incrementAndGet(); exchange.getRequestBody().readAllBytes();
            try { Thread.sleep(11_000); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
            byte[] body = "{\"data\":[{\"b64_json\":\"AQID\"}],\"usage\":{\"prompt_tokens\":10,\"completion_tokens\":20,\"cost\":0.04}}".getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200, body.length); exchange.getResponseBody().write(body); exchange.close();
        });
        server.start();
        try {
            ChatModelFactory models = mock(ChatModelFactory.class);
            TokenUsageService usage = mock(TokenUsageService.class);
            when(models.resolveProvider()).thenReturn(AiModelProperties.Provider.OPENROUTER);
            when(models.decisionCredentials(null, AiModelProperties.Provider.OPENROUTER)).thenReturn(
                    new ChatModelFactory.DecisionCredentials("synthetic-key", "http://127.0.0.1:" + server.getAddress().getPort(), false));
            var gateway = new DdAiGateway(models, mock(AuxModelResolver.class), usage, new ObjectMapper());
            assertArrayEquals(new byte[]{1, 2, 3}, gateway.example(1L, 2L, "组织架构图", "仅合成数据"));
            assertEquals(1, requests.get());
            verify(usage).recordDecisionUsage(eq(1L), eq(2L), eq("dd-example"), eq(DdAiGateway.EXAMPLE_MODEL), eq(10), eq(20), eq(new java.math.BigDecimal("0.04")), eq(false));
        } finally { server.stop(0); }
    }
}
