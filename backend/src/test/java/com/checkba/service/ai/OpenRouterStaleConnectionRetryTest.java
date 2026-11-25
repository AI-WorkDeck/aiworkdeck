// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.ai;

import dev.langchain4j.data.message.AiMessage;
import dev.langchain4j.data.message.UserMessage;
import dev.langchain4j.model.StreamingResponseHandler;
import dev.langchain4j.model.output.Response;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
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
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Q19：首轮对话偶发「执行中断：Stream Error: Broken pipe」。复用到一条对端已关闭的
 * keep-alive 连接时，客户端在写请求体/等响应头时就会被掐断；平台通道（awdai_）为了计费
 * 不在编排层重放，于是第一句话直接失败。
 *
 * <p>这里用裸 socket 服务端把「陈旧的池化连接」在客户端看到的样子造出来：读完请求就把连接
 * 直接 RST 掉，一个字节的响应都不给。修复后：同一个 X-Request-Id 重发恰好一次（网关按它
 * 幂等预扣，不会重复扣费），第二条连接正常出字。
 */
class OpenRouterStaleConnectionRetryTest {

    private ServerSocket server;
    private final List<String> requestIds = new CopyOnWriteArrayList<>();

    @AfterEach
    void stop() throws IOException {
        if (server != null) server.close();
    }

    /** dropFirst 个连接读完请求就 RST；之后的连接回一条正常的 SSE 流。 */
    private String startServer(int dropFirst) throws IOException {
        server = new ServerSocket(0, 50, InetAddress.getLoopbackAddress());
        Thread t = new Thread(() -> {
            int n = 0;
            while (!server.isClosed()) {
                try (Socket s = server.accept()) {
                    n++;
                    readRequest(s.getInputStream());
                    if (n <= dropFirst) {
                        s.setSoLinger(true, 0); // RST, like a peer that already closed the idle connection
                        continue;
                    }
                    OutputStream os = s.getOutputStream();
                    String sse = "data: {\"id\":\"gen-1\",\"object\":\"chat.completion.chunk\",\"choices\":[{\"index\":0,"
                            + "\"delta\":{\"content\":\"好的\"},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n";
                    byte[] payload = sse.getBytes(StandardCharsets.UTF_8);
                    os.write(("HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: " + payload.length
                            + "\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.US_ASCII));
                    os.write(payload);
                    os.flush();
                } catch (IOException ignored) {
                    // server closed / client went away
                }
            }
        }, "stale-connection-server");
        t.setDaemon(true);
        t.start();
        return "http://127.0.0.1:" + server.getLocalPort() + "/api/v1";
    }

    private void readRequest(InputStream raw) throws IOException {
        BufferedInputStream in = new BufferedInputStream(raw);
        ByteArrayOutputStream head = new ByteArrayOutputStream();
        int b, matched = 0;
        byte[] end = {'\r', '\n', '\r', '\n'};
        while (matched < 4 && (b = in.read()) != -1) {
            head.write(b);
            matched = b == end[matched] ? matched + 1 : (b == '\r' ? 1 : 0);
        }
        int length = 0;
        String id = null;
        for (String line : head.toString(StandardCharsets.ISO_8859_1).split("\r\n")) {
            String lower = line.toLowerCase(Locale.ROOT);
            if (lower.startsWith("content-length:")) length = Integer.parseInt(line.substring(15).trim());
            if (lower.startsWith("x-request-id:")) id = line.substring(13).trim();
        }
        requestIds.add(String.valueOf(id));
        in.readNBytes(length);
    }

    private record Outcome(boolean completed, Throwable error, String text) { }

    private Outcome run(String baseUrl, String apiKey) throws Exception {
        CountDownLatch done = new CountDownLatch(1);
        AtomicBoolean completed = new AtomicBoolean();
        AtomicReference<Throwable> error = new AtomicReference<>();
        StringBuilder text = new StringBuilder();
        new OpenRouterStreamingChatModel(apiKey, baseUrl, "deepseek/deepseek-v4-flash", Duration.ofSeconds(20))
                .generate(List.of(UserMessage.from("你好")), (List<dev.langchain4j.agent.tool.ToolSpecification>) null, new StreamingResponseHandler<AiMessage>() {
                    @Override public void onNext(String token) { text.append(token); }
                    @Override public void onComplete(Response<AiMessage> response) { completed.set(true); done.countDown(); }
                    @Override public void onError(Throwable t) { error.set(t); done.countDown(); }
                });
        assertTrue(done.await(20, TimeUnit.SECONDS), "no terminal callback");
        return new Outcome(completed.get(), error.get(), text.toString());
    }

    @Test
    @DisplayName("平台通道：陈旧连接被掐断后用同一个 X-Request-Id 重发一次，第一句话照常回答")
    void platformChannelRetriesOnceWithTheSameRequestId() throws Exception {
        Outcome o = run(startServer(1), "awdai_test_key");
        assertNull(o.error(), () -> "first turn failed: " + o.error());
        assertTrue(o.completed());
        assertEquals("好的", o.text());
        assertEquals(2, requestIds.size(), "exactly one retry");
        assertNotEquals("null", requestIds.get(0), "the platform gateway's idempotency key must be sent");
        assertEquals(requestIds.get(0), requestIds.get(1), "the retry reuses the same id, so it can never be charged twice");
    }

    @Test
    @DisplayName("平台通道：重发也失败就停下报错（只重发一次），终态归为「网络不可达」而不是 Java 原文")
    void platformChannelRetriesOnlyOnce() throws Exception {
        Outcome o = run(startServer(5), "awdai_test_key");
        assertFalse(o.completed());
        assertNotNull(o.error());
        assertEquals(2, requestIds.size(), "one original attempt plus one retry, no more");
    }

    @Test
    @DisplayName("连接层失败的判定：断管/重置/流提前结束算；读超时不算（对端可能已在处理）")
    void connectionLevelFailureClassification() {
        assertTrue(OpenRouterStreamingChatModel.isConnectionLevelFailure(new java.net.SocketException("Broken pipe")));
        assertTrue(OpenRouterStreamingChatModel.isConnectionLevelFailure(new java.net.SocketException("Connection reset")));
        assertTrue(OpenRouterStreamingChatModel.isConnectionLevelFailure(new IOException("unexpected end of stream on http://x/...")));
        assertFalse(OpenRouterStreamingChatModel.isConnectionLevelFailure(new java.net.SocketTimeoutException("timeout")));
        assertTrue(LlmErrorClassifier.isNetworkUnreachable(new java.net.SocketException("Broken pipe")),
                "a terminal broken pipe gets the network notice, not raw Java text");
    }

    @Test
    @DisplayName("空闲连接回收时长短于上游 keep-alive（生产 nginx 75s）")
    void idleEvictionIsBelowUpstreamKeepAlive() {
        assertTrue(OpenRouterStreamingChatModel.IDLE_CONNECTION_EVICT_SECONDS < 75);
    }
}
