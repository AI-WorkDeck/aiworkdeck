// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.ai;

import com.checkba.service.account.AccountService;
import com.checkba.service.telemetry.InstallIdentityService;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

/** Q24：本轮费用查询只走国内站平台通道，凭据与标记不出后端；失败一律 available:false。 */
class TurnCostServiceTest {

    private HttpServer server;
    private String openRouterBase = "https://openrouter.invalid/api/v1";
    private final List<String> seen = new CopyOnWriteArrayList<>();

    @AfterEach
    void stop() { if (server != null) server.stop(0); }

    private String start(int status, String body) throws Exception {
        server = HttpServer.create(new InetSocketAddress(InetAddress.getLoopbackAddress(), 0), 0);
        server.createContext("/api/account/ai/turn-cost", ex -> {
            seen.add(ex.getRequestURI().getQuery() + " " + ex.getRequestHeaders().getFirst("Authorization"));
            byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
            ex.sendResponseHeaders(status, bytes.length);
            ex.getResponseBody().write(bytes);
            ex.close();
        });
        server.start();
        return "http://127.0.0.1:" + server.getAddress().getPort() + "/api/account/ai/v1";
    }

    private TurnCostService service(String base, PlatformAiKeyService.Resolved resolved, Path dir) {
        PlatformAiChannel channel = mock(PlatformAiChannel.class);
        when(channel.resolveFor(7L)).thenReturn(resolved);
        AccountService account = mock(AccountService.class);
        when(account.platformAiBaseUrl()).thenReturn(base);
        com.checkba.config.AiModelProperties props = new com.checkba.config.AiModelProperties();
        props.getOpenRouter().setBaseUrl(openRouterBase);
        return new TurnCostService(channel, account, new InstallIdentityService(dir.toString()), new ObjectMapper(), props);
    }

    private static PlatformAiKeyService.Resolved bailian() {
        return new PlatformAiKeyService.Resolved("awdai_synthetic", "fp", null, "bailian", "x", "m");
    }

    @Test
    void returnsTheSiteAmountForThisTurn(@TempDir Path dir) throws Exception {
        String base = start(200, "{\"code\":0,\"data\":{\"cents\":170,\"currency\":\"CNY\",\"calls\":3,\"pending\":0,"
                + "\"subscriptionCents\":0,\"walletCents\":170,\"bqtCents\":0}}");
        Map<String, Object> out = service(base, bailian(), dir).turnCost(7L, "conv-1", "0b6c2f1e-1111-4222-8333-944455556666");
        assertEquals(true, out.get("available"));
        assertEquals(170L, out.get("cents"));
        assertEquals("CNY", out.get("currency"));
        assertEquals(0, out.get("pending"));
        String expectedTag = new InstallIdentityService(dir.toString()).turnTag("conv-1", "0b6c2f1e-1111-4222-8333-944455556666");
        assertEquals(List.of("tag=" + expectedTag + " Bearer awdai_synthetic"), seen);
        assertFalse(out.toString().contains(expectedTag), "the tag never reaches the renderer");
        assertEquals(false, out.get("excludesPresentation"));
        PlatformTurnScope.beginWork(expectedTag);      // the turn's memory summary is still running
        assertEquals(1, service(base, bailian(), dir).turnCost(7L, "conv-1", "0b6c2f1e-1111-4222-8333-944455556666").get("pending"));
        PlatformTurnScope.endWork(expectedTag);
        PlatformTurnScope.run(expectedTag, PlatformTurnScope::markUntaggedSpend);
        assertEquals(true, service(base, bailian(), dir).turnCost(7L, "conv-1", "0b6c2f1e-1111-4222-8333-944455556666").get("excludesPresentation"));
    }

    @Test
    void unavailableOffThePlatformChannelOrOnFailure(@TempDir Path dir) throws Exception {
        String base = start(404, "{\"code\":1}");
        String run = "0b6c2f1e-1111-4222-8333-944455556666";
        assertEquals(false, service(base, bailian(), dir).turnCost(7L, "conv-1", run).get("available"));
        PlatformAiKeyService.Resolved intl = new PlatformAiKeyService.Resolved("sk-or-synthetic", "fp", null);
        assertEquals(false, service(base, intl, dir).turnCost(7L, "conv-1", run).get("available"), "intl turn with no generations recorded");
        assertEquals(false, service(base, null, dir).turnCost(7L, "conv-1", run).get("available"));
        assertEquals(false, service(base, bailian(), dir).turnCost(7L, "conv-1", "../etc").get("available"));
        assertEquals(1, seen.size(), "only the platform-channel lookup reached the site");
    }

    @Test
    void internationalTurnSumsOpenRouterGenerations(@TempDir Path dir) throws Exception {
        String run = "1b6c2f1e-1111-4222-8333-944455556666";
        String tag = new InstallIdentityService(dir.toString()).turnTag("conv-intl", run);
        server = HttpServer.create(new InetSocketAddress(InetAddress.getLoopbackAddress(), 0), 0);
        server.createContext("/api/v1/generation", ex -> {
            String q = ex.getRequestURI().getQuery();
            seen.add(q + " " + ex.getRequestHeaders().getFirst("Authorization"));
            String body = q.endsWith("gen-a") ? "{\"data\":{\"id\":\"gen-a\",\"total_cost\":0.0012}}"
                    : q.endsWith("gen-b") ? "{\"data\":{\"id\":\"gen-b\",\"total_cost\":0.0101}}" : "{}";
            int status = q.endsWith("gen-c") ? 404 : 200;
            byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
            ex.sendResponseHeaders(status, bytes.length);
            ex.getResponseBody().write(bytes);
            ex.close();
        });
        server.start();
        openRouterBase = "http://127.0.0.1:" + server.getAddress().getPort() + "/api/v1";
        PlatformAiKeyService.Resolved intl = new PlatformAiKeyService.Resolved("sk-or-synthetic", "fp", null);
        TurnGenerations.record(tag, "gen-a");
        TurnGenerations.record(tag, "gen-b");
        TurnGenerations.record(tag, "gen-a");          // duplicates count once
        Map<String, Object> out = service("http://unused/api/account/ai/v1", intl, dir).turnCost(7L, "conv-intl", run);
        assertEquals(true, out.get("available"));
        assertEquals("USD", out.get("currency"));
        assertEquals(11300L, out.get("micros"));
        assertEquals(0, out.get("pending"));
        assertEquals(2, out.get("calls"));
        assertTrue(seen.stream().allMatch(x -> x.endsWith("Bearer sk-or-synthetic")));
        TurnGenerations.record(tag, "gen-c");          // not yet available at OpenRouter
        assertEquals(1, service("http://unused/api/account/ai/v1", intl, dir).turnCost(7L, "conv-intl", run).get("pending"));
        PlatformTurnScope.run(tag, TurnGenerations::markIncomplete);   // an aux call without a generation id
        assertEquals(false, service("http://unused/api/account/ai/v1", intl, dir).turnCost(7L, "conv-intl", run).get("available"));
    }
}
