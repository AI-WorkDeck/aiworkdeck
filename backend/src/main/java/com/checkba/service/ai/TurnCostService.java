// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ai;

import com.checkba.config.AiModelProperties;
import com.checkba.service.account.AccountService;
import com.checkba.service.telemetry.InstallIdentityService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.io.InputStream;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Q24：一轮对话在国内站平台通道上的实扣金额。
 *
 * <p>本轮每次网关请求都带了 {@code X-AWD-Turn}（{@link InstallIdentityService#turnTag}），官网按标记汇总
 * 已结算请求的金额。这里用同一把账户运行凭据（awdai_）去问，渲染层既拿不到凭据也拿不到标记。
 * 国内站平台通道问官网账（按标记汇总）；国际平台通道按本轮记下的 OpenRouter 生成 id 问 OpenRouter
 * （{@link TurnGenerations}）。查不全或不可用一律回 {@code available:false}，前端保留「查看用量」。
 */
@Service
@Slf4j
public class TurnCostService {

    private static final java.util.regex.Pattern RUN_ID = java.util.regex.Pattern.compile("^[A-Za-z0-9-]{8,64}$");

    private final PlatformAiChannel channel;
    private final AccountService accountService;
    private final InstallIdentityService installIdentity;
    private final ObjectMapper json;
    private final AiModelProperties aiModelProperties;
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5))
            .followRedirects(HttpClient.Redirect.NEVER).build();

    public TurnCostService(PlatformAiChannel channel, AccountService accountService,
                           InstallIdentityService installIdentity, ObjectMapper json, AiModelProperties aiModelProperties) {
        this.channel = channel;
        this.accountService = accountService;
        this.installIdentity = installIdentity;
        this.json = json;
        this.aiModelProperties = aiModelProperties;
    }

    /** 不可用（不是国内站平台通道、官网没有这个端点、网络失败）时回 {@code available:false}。 */
    public Map<String, Object> turnCost(Long userId, String conversationId, String runId) {
        if (runId == null || !RUN_ID.matcher(runId).matches()) return unavailable();
        PlatformAiKeyService.Resolved resolved = channel.resolveFor(userId);
        if (resolved == null || resolved.apiKey() == null || resolved.apiKey().isBlank()) return unavailable();
        String tag = installIdentity.turnTag(conversationId, runId);
        if (tag == null) return unavailable();
        if (!resolved.bailian()) return openRouterCost(resolved.apiKey(), tag);
        if (!resolved.apiKey().startsWith("awdai_")) return unavailable();
        String base = accountService.platformAiBaseUrl();
        if (base == null || !base.endsWith("/v1")) return unavailable();
        String url = base.substring(0, base.length() - "/v1".length()) + "/turn-cost?tag="
                + URLEncoder.encode(tag, StandardCharsets.UTF_8);
        try {
            HttpRequest request = HttpRequest.newBuilder(URI.create(url)).timeout(Duration.ofSeconds(8))
                    .header("Authorization", "Bearer " + resolved.apiKey())
                    .header("Accept", "application/json").GET().build();
            HttpResponse<InputStream> response = http.send(request, HttpResponse.BodyHandlers.ofInputStream());
            byte[] body;
            try (InputStream in = response.body()) { body = in.readNBytes(16 * 1024); }
            if (response.statusCode() != 200) return unavailable();
            JsonNode root = json.readTree(body);
            JsonNode data = root == null ? null : root.path("data");
            if (root == null || root.path("code").asInt(-1) != 0 || data == null || !data.isObject()) return unavailable();
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("available", true);
            out.put("cents", data.path("cents").asLong(0));
            out.put("currency", "USD".equals(data.path("currency").asText()) ? "USD" : "CNY");
            out.put("calls", data.path("calls").asInt(0));
            out.put("pending", data.path("pending").asInt(0) + PlatformTurnScope.openWork(tag));
            out.put("subscriptionCents", data.path("subscriptionCents").asLong(0));
            out.put("walletCents", data.path("walletCents").asLong(0));
            out.put("bqtCents", data.path("bqtCents").asLong(0));
            // 这一轮还有带不上标记的平台调用（演示文稿生成），金额只是其余部分
            out.put("excludesPresentation", PlatformTurnScope.hadUntaggedSpend(tag));
            return out;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return unavailable();
        } catch (Exception e) {
            log.debug("[TurnCost] lookup failed: {}", e.toString());
            return unavailable();
        }
    }

    /**
     * 国际平台通道：按本轮记下的 OpenRouter 生成 id 逐个查 {@code GET /generation?id=}（同一把运行凭据），
     * 汇总 total_cost（美元）。某个 id 还查不到算 pending；轮次里有拿不到 id 的调用就不给数。
     */
    private Map<String, Object> openRouterCost(String apiKey, String tag) {
        java.util.List<String> ids = TurnGenerations.idsFor(tag);
        if (ids.isEmpty() || TurnGenerations.incomplete(tag)) return unavailable();
        String base = aiModelProperties == null || aiModelProperties.getOpenRouter() == null ? null
                : aiModelProperties.getOpenRouter().getBaseUrl();
        if (base == null || !base.startsWith("https://") && !base.startsWith("http://")) return unavailable();
        String root = base.replaceAll("/+$", "");
        java.math.BigDecimal total = java.math.BigDecimal.ZERO;
        int pending = 0;
        for (String id : ids) {
            try {
                HttpRequest request = HttpRequest.newBuilder(URI.create(root + "/generation?id="
                                + URLEncoder.encode(id, StandardCharsets.UTF_8)))
                        .timeout(Duration.ofSeconds(8)).header("Authorization", "Bearer " + apiKey)
                        .header("Accept", "application/json").GET().build();
                HttpResponse<InputStream> response = http.send(request, HttpResponse.BodyHandlers.ofInputStream());
                byte[] body;
                try (InputStream in = response.body()) { body = in.readNBytes(64 * 1024); }
                if (response.statusCode() == 404) { pending++; continue; }
                if (response.statusCode() != 200) return unavailable();
                JsonNode cost = json.readTree(body).path("data").path("total_cost");
                if (!cost.isNumber()) { pending++; continue; }
                total = total.add(cost.decimalValue());
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return unavailable();
            } catch (Exception e) {
                log.debug("[TurnCost] OpenRouter lookup failed: {}", e.toString());
                return unavailable();
            }
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("available", true);
        out.put("currency", "USD");
        // 美元金额常常不到一美分：用百万分之一美元给出精确值，前端按需显示到 4 位小数
        out.put("micros", total.movePointRight(6).setScale(0, java.math.RoundingMode.HALF_UP).longValueExact());
        out.put("cents", total.movePointRight(2).setScale(0, java.math.RoundingMode.HALF_UP).longValueExact());
        out.put("calls", ids.size());
        out.put("pending", pending + PlatformTurnScope.openWork(tag));
        out.put("excludesPresentation", PlatformTurnScope.hadUntaggedSpend(tag));
        return out;
    }

    private static Map<String, Object> unavailable() {
        return Map.of("available", false);
    }
}
