// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.ai;

import com.sun.net.httpserver.HttpServer;
import dev.langchain4j.model.chat.ChatLanguageModel;
import dev.langchain4j.model.openai.OpenAiChatModel;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/** Q24 intl (D36): a non-streamed intl platform call records OpenRouter's generation id under the turn. */
class TurnGenerationsListenerTest {

    private HttpServer server;

    @AfterEach
    void stop() { if (server != null) server.stop(0); }

    /** A non-streamed chat completion; {@code id} is what OpenRouter returns as the generation id. */
    private String start(String id) throws Exception {
        server = HttpServer.create(new InetSocketAddress(InetAddress.getLoopbackAddress(), 0), 0);
        server.createContext("/", ex -> {
            ex.getRequestBody().readAllBytes();
            String idField = id == null ? "" : "\"id\":\"" + id + "\",";
            byte[] body = ("{" + idField + "\"object\":\"chat.completion\",\"model\":\"m\",\"choices\":[{\"index\":0,"
                    + "\"message\":{\"role\":\"assistant\",\"content\":\"ok\"},\"finish_reason\":\"stop\"}],"
                    + "\"usage\":{\"prompt_tokens\":3,\"completion_tokens\":1,\"total_tokens\":4}}")
                    .getBytes(StandardCharsets.UTF_8);
            ex.getResponseHeaders().add("Content-Type", "application/json");
            ex.sendResponseHeaders(200, body.length);
            ex.getResponseBody().write(body);
            ex.close();
        });
        server.start();
        return "http://127.0.0.1:" + server.getAddress().getPort() + "/api/v1";
    }

    private static ChatLanguageModel model(String baseUrl, String apiKey) {
        return OpenAiChatModel.builder().apiKey(apiKey).baseUrl(baseUrl).modelName("m").maxRetries(0)
                .timeout(Duration.ofSeconds(10)).listeners(ChatModelFactory.turnListeners(apiKey))
                .logRequests(false).logResponses(false).build();
    }

    private static String tag(char c) { return String.valueOf(c).repeat(32); }

    @Test
    void intlCallInsideTurnRecordsGenerationId() throws Exception {
        String base = start("gen-intl-1");
        String tag = tag('a');
        PlatformTurnScope.run(tag, () -> model(base, "sk-or-synthetic").generate("hi"));
        assertEquals(List.of("gen-intl-1"), TurnGenerations.idsFor(tag));
        assertFalse(TurnGenerations.incomplete(tag));
    }

    @Test
    void intlCallWithoutIdMarksTurnIncomplete() throws Exception {
        String base = start(null);
        String tag = tag('b');
        PlatformTurnScope.run(tag, () -> model(base, "sk-or-synthetic").generate("hi"));
        assertEquals(List.of(), TurnGenerations.idsFor(tag));
        assertTrue(TurnGenerations.incomplete(tag));
    }

    @Test
    void cnPlatformKeyGetsNoListener() throws Exception {
        assertEquals(List.of(), ChatModelFactory.turnListeners("awdai_x"));
        String base = start("gen-cn");
        String tag = tag('c');
        PlatformTurnScope.run(tag, () -> model(base, "awdai_x").generate("hi"));
        assertEquals(List.of(), TurnGenerations.idsFor(tag));
        assertFalse(TurnGenerations.incomplete(tag));
    }

    @Test
    void callOutsideTurnOrWithMalformedTagRecordsNothing() throws Exception {
        String base = start("gen-x");
        model(base, "sk-or-synthetic").generate("hi");
        PlatformTurnScope.run("not-a-tag", () -> model(base, "sk-or-synthetic").generate("hi"));
        assertEquals(List.of(), TurnGenerations.idsFor("not-a-tag"));
        assertFalse(TurnGenerations.incomplete("not-a-tag"));
    }
}
