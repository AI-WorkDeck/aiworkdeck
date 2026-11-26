// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ai;

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
 * 只有国内站平台通道（百炼网关）有这条账；其他情况一律回 {@code available:false}，前端保留「查看用量」。
 */
@Service
@Slf4j
public class TurnCostService {

    private static final java.util.regex.Pattern RUN_ID = java.util.regex.Pattern.compile("^[A-Za-z0-9-]{8,64}$");

    private final PlatformAiChannel channel;
    private final AccountService accountService;
    private final InstallIdentityService installIdentity;
    private final ObjectMapper json;
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5))
            .followRedirects(HttpClient.Redirect.NEVER).build();

    public TurnCostService(PlatformAiChannel channel, AccountService accountService,
                           InstallIdentityService installIdentity, ObjectMapper json) {
        this.channel = channel;
        this.accountService = accountService;
        this.installIdentity = installIdentity;
        this.json = json;
    }

    /** 不可用（不是国内站平台通道、官网没有这个端点、网络失败）时回 {@code available:false}。 */
    public Map<String, Object> turnCost(Long userId, String conversationId, String runId) {
        if (runId == null || !RUN_ID.matcher(runId).matches()) return unavailable();
        PlatformAiKeyService.Resolved resolved = channel.resolveFor(userId);
        if (resolved == null || !resolved.bailian() || resolved.apiKey() == null || !resolved.apiKey().startsWith("awdai_")) {
            return unavailable();
        }
        String tag = installIdentity.turnTag(conversationId, runId);
        if (tag == null) return unavailable();
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
            out.put("pending", data.path("pending").asInt(0));
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

    private static Map<String, Object> unavailable() {
        return Map.of("available", false);
    }
}
