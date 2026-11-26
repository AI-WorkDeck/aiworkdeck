// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.ai;

import dev.langchain4j.data.message.AiMessage;
import dev.langchain4j.data.message.UserMessage;
import dev.langchain4j.model.output.Response;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.*;

/** Q24：平台通道（awdai_）每次请求带本轮计费标记 X-AWD-Turn；BYOK 与畸形标记一律不带。 */
class OpenRouterTurnTagHeaderTest {

    private static final String TAG = "0123456789abcdef0123456789abcdef";
    private ServerSocket server;
    private final List<String> turnHeaders = new CopyOnWriteArrayList<>();

    @AfterEach
    void stop() throws IOException { if (server != null) server.close(); }

    private String startServer() throws IOException {
        server = new ServerSocket(0, 50, InetAddress.getLoopbackAddress());
        Thread t = new Thread(() -> {
            while (!server.isClosed()) {
                try (Socket s = server.accept()) {
                    BufferedInputStream in = new BufferedInputStream(s.getInputStream());
                    ByteArrayOutputStream head = new ByteArrayOutputStream();
                    int b, matched = 0;
                    byte[] end = {'\r', '\n', '\r', '\n'};
                    while (matched < 4 && (b = in.read()) != -1) {
                        head.write(b);
                        matched = b == end[matched] ? matched + 1 : (b == '\r' ? 1 : 0);
                    }
                    int length = 0;
                    String tag = "absent";
                    for (String line : head.toString(StandardCharsets.ISO_8859_1).split("\r\n")) {
                        String lower = line.toLowerCase(Locale.ROOT);
                        if (lower.startsWith("content-length:")) length = Integer.parseInt(line.substring(15).trim());
                        if (lower.startsWith("x-awd-turn:")) tag = line.substring(11).trim();
                    }
                    turnHeaders.add(tag);
                    in.readNBytes(length);
                    byte[] payload = ("data: {\"id\":\"gen-1\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"好\"},"
                            + "\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n").getBytes(StandardCharsets.UTF_8);
                    OutputStream os = s.getOutputStream();
                    os.write(("HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: " + payload.length
                            + "\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.US_ASCII));
                    os.write(payload);
                    os.flush();
                } catch (IOException ignored) {
                }
            }
        }, "turn-tag-server");
        t.setDaemon(true);
        t.start();
        return "http://127.0.0.1:" + server.getLocalPort() + "/api/v1";
    }

    private void run(String baseUrl, String apiKey, String tag) throws Exception {
        CountDownLatch done = new CountDownLatch(1);
        new OpenRouterStreamingChatModel(apiKey, baseUrl, "deepseek/deepseek-v4-flash", Duration.ofSeconds(20))
                .generate(List.of(UserMessage.from("你好")), (List<dev.langchain4j.agent.tool.ToolSpecification>) null,
                        new ReasoningStreamingHandler() {
                            @Override public void onNext(String token) { }
                            @Override public void onComplete(Response<AiMessage> response) { done.countDown(); }
                            @Override public void onError(Throwable error) { done.countDown(); }
                            @Override public String turnTag() { return tag; }
                        });
        assertTrue(done.await(15, TimeUnit.SECONDS));
    }

    @Test
    void platformChannelSendsTheTurnTag() throws Exception {
        run(startServer(), "awdai_synthetic", TAG);
        assertEquals(List.of(TAG), turnHeaders);
    }

    @Test
    void ownKeyAndMalformedTagsSendNothing() throws Exception {
        String url = startServer();
        run(url, "sk-or-synthetic", TAG);
        run(url, "awdai_synthetic", "NOT-A-TAG");
        run(url, "awdai_synthetic", null);
        assertEquals(List.of("absent", "absent", "absent"), turnHeaders);
    }
}
