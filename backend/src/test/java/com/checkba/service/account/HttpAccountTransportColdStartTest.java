// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.account;

import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.Executors;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** 官网重启后首个 ai-key（含模型目录冷拉取，~5.7s）不得被 5 秒超时判成网络失败。 */
class HttpAccountTransportColdStartTest {

    private HttpServer server;

    @AfterEach
    void stop() {
        if (server != null) server.stop(0);
    }

    private String start(String path, long delayMs) throws Exception {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.setExecutor(Executors.newCachedThreadPool());
        server.createContext(path, ex -> {
            try {
                Thread.sleep(delayMs);
            } catch (InterruptedException ignored) {
            }
            byte[] out = "{\"openrouterKey\":\"k\"}".getBytes(StandardCharsets.UTF_8);
            ex.sendResponseHeaders(200, out.length);
            ex.getResponseBody().write(out);
            ex.close();
        });
        server.start();
        return "http://127.0.0.1:" + server.getAddress().getPort();
    }

    @Test
    void slowAiKeyColdStartStillSucceeds() throws Exception {
        String base = start("/api/account/ai-key", 6000);
        AccountTransport.Reply reply = new HttpAccountTransport().send("POST", base + "/api/account/ai-key", "awdk_x", "{}");
        assertEquals(200, reply.status());
        assertTrue(reply.body().contains("openrouterKey"));
    }

    @Test
    void otherAccountCallsKeepFiveSecondTimeout() throws Exception {
        String base = start("/api/account/me", 6000);
        AccountTransport.Reply reply = new HttpAccountTransport().send("GET", base + "/api/account/me", "awdk_x", null);
        assertTrue(reply.networkFailure());
    }
}
