// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ai;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.DynamicTest;
import org.junit.jupiter.api.TestFactory;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.HashMap;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 白名单与 OpenRouter 线上目录的对拍（默认跳过；设置 {@code RUN_LIVE_MODEL_CHECK=1} 后启用）。
 *
 * <p><b>为什么必须有</b>：{@link AllowedModels} 的单价是人手抄的，而它直接决定 BYOK 用户看到的
 * 花费估算。2026-08-08 首次对拍就抓到 5 条价格错，其中 {@code moonshotai/kimi-k2.6} 的
 * 输入价与输出价分别把用户超收了 14% 和 40%。这条测试是价格漂移的唯一护栏——
 * 上游调价、模型下线、模型停止支持 tools 都只会在这里暴露出来。
 *
 * <p><b>为什么默认跳过</b>：mvn test 默认离线可跑是硬要求（CI 与开发机都不该因为
 * openrouter.ai 抖动而红）。所以门控写法与 {@code RealLlmSmokeTest} 一致：
 * 类级 {@code @EnabledIfEnvironmentVariable} 挡住整批，另在工厂里补一层
 * {@code assumeTrue}，防止有人绕过条件扩展直跑方法。
 *
 * <p>运行：{@code RUN_LIVE_MODEL_CHECK=1 mvn test -Dtest=AllowedModelsLiveContractTest}
 *
 * <p>失败时的处理顺序：先确认线上是真的变了（浏览器打开 openrouter.ai 的模型页核对），
 * 再改 {@link AllowedModels} 的价格或把模型换掉；**不要**为了让测试变绿而放宽容差。
 *
 * <p><b>多供应商模型按区间对拍</b>（2026-11-25，CEO 批准）：OpenRouter 目录里的 headline 单价
 * 等于当前最便宜的那个在线 endpoint，多供应商模型的 headline 会随供应商上下线反复跳
 * （deepseek-v4-pro 一天内 $1.28 → $0.58 → $0.89，12 家供应商 $0.89–$1.95）。
 * 平台计费用的是上游回传的 usage.cost，这张表只决定 BYOK 花费估算和选择器价位，
 * 所以对「有多个 endpoint 的单档模型」，只要我们记的单价落在线上 endpoint 的最低–最高价之间就算对；
 * 单供应商模型、分档模型仍按 1% 精确对拍。
 */
@DisplayName("模型白名单对拍 OpenRouter 线上目录（默认跳过）")
@EnabledIfEnvironmentVariable(named = "RUN_LIVE_MODEL_CHECK", matches = "1")
class AllowedModelsLiveContractTest {

    private static final String MODELS_URL = "https://openrouter.ai/api/v1/models";
    /** 单个模型的全部在线供应商及其单价：{@code /models/{id}/endpoints}（公开端点）。 */
    private static final String ENDPOINTS_URL = "https://openrouter.ai/api/v1/models/%s/endpoints";

    /** 单价容差：上游偶有末位舍入差异，1% 足够吸收，又抓得住 14% 这类真错。 */
    private static final double PRICE_TOLERANCE = 0.01;

    @TestFactory
    Stream<DynamicTest> everyWhitelistedModelMatchesUpstream() {
        Assumptions.assumeTrue("1".equals(System.getenv("RUN_LIVE_MODEL_CHECK")),
                "未设置 RUN_LIVE_MODEL_CHECK=1，跳过联网对拍");

        Map<String, JsonNode> upstream = fetchUpstreamCatalog();

        // 一个模型一条动态用例：价格漂移往往是批量的（上游整档调价），
        // 一条测试撞死在第一个不一致上会让人以为只错了一条
        return Stream.of(AllowedModels.values())
                .map(m -> DynamicTest.dynamicTest(m.getModelId(), () -> assertMatchesUpstream(m, upstream)));
    }

    private void assertMatchesUpstream(AllowedModels model, Map<String, JsonNode> upstream) {
        JsonNode entry = upstream.get(model.getModelId());
        assertNotNull(entry, "模型已从 OpenRouter 目录消失（下线或改名）：" + model.getModelId()
                + "。留在白名单里会让选到它的用户直接报错，必须换掉。");

        // tools 支持是白名单的构造性前提：AllowedModels 里刻意没有 toolCalling 字段，
        // 靠这条断言守。模型停止支持 tools 会让整个 Agent 模式静默退化。
        JsonNode params = entry.path("supported_parameters");
        boolean supportsTools = false;
        for (JsonNode p : params) {
            if ("tools".equals(p.asText())) {
                supportsTools = true;
                break;
            }
        }
        assertTrue(supportsTools,
                model.getModelId() + " 已不支持 tools，supported_parameters=" + params);

        // 视觉能力：来源是 architecture.input_modalities 是否含 "image"。
        // 这一位和单价一样是人手抄的、会在我们背后变，所以必须对拍。
        // 两个方向的严重性不同：
        //   我们标 true 而上游没有 image → 我们会把 image 内容块发给一个读不了图的模型，
        //     换来一个必然的 400，用户看到的是一句英文报错。这是必须红的。
        //   我们标 false 而上游有 image → 只是少给了能力（图片走 OCR，功能仍可用），
        //     所以也断言，但错误信息要说清楚这是「漏标」而不是「会坏」。
        JsonNode modalities = entry.path("architecture").path("input_modalities");
        assertTrue(modalities.isArray(),
                model.getModelId() + " 的 architecture.input_modalities 不是数组，实际节点=" + modalities
                        + "。上游改了字段结构，vision 位从此无人看守，先确认新字段名再改这条断言。");
        boolean upstreamVision = false;
        for (JsonNode mod : modalities) {
            if ("image".equals(mod.asText())) {
                upstreamVision = true;
                break;
            }
        }
        if (model.isVision()) {
            assertTrue(upstreamVision, model.getModelId()
                    + " 我们标了支持视觉，上游 input_modalities 却没有 image（实际=" + modalities
                    + "）。这条必须改 AllowedModels：不改的话选到它的用户一发图就是一个上游 400。");
        } else {
            assertFalse(upstreamVision, model.getModelId()
                    + " 上游已支持图像输入（input_modalities=" + modalities
                    + "），我们还标着不支持——用户的图片被白白降级成 OCR 文本。把 vision 位改成 true。");
        }

        assertEquals(model.getContextLength(), entry.path("context_length").asInt(),
                model.getModelId() + " context length drift");

        List<JsonNode> overrides = new ArrayList<>();
        entry.path("pricing").path("overrides").forEach(overrides::add);
        overrides.sort(Comparator.comparingInt(n -> n.path("min_prompt_tokens").asInt()));
        assertEquals(1 + overrides.size(), model.getPriceTiers().size(),
                model.getModelId() + " price tier count drift");
        for (int i = 0; i < overrides.size(); i++) {
            JsonNode override = overrides.get(i);
            AllowedModels.PriceTier tier = model.getPriceTiers().get(i + 1);
            assertEquals(override.path("min_prompt_tokens").asInt(), tier.minPromptTokens(),
                    model.getModelId() + " tier boundary drift");
            assertPriceClose(model, "tier input", tier.inputPricePerM(), override.path("prompt"));
            assertPriceClose(model, "tier output", tier.outputPricePerM(), override.path("completion"));
        }

        // OpenRouter 的 pricing 是「每 token 的美元数」字符串，我们记的是 $/1M tokens
        AllowedModels.PriceTier first = model.getPriceTiers().get(0);
        if (model.getPriceTiers().size() == 1) {
            List<JsonNode> endpoints = fetchEndpoints(model.getModelId());
            if (endpoints.size() > 1) {
                assertPriceWithinEndpoints(model, "输入", first.inputPricePerM(), endpoints, "prompt");
                assertPriceWithinEndpoints(model, "输出", first.outputPricePerM(), endpoints, "completion");
                return;
            }
        }
        assertPriceClose(model, "输入", first.inputPricePerM(), entry.path("pricing").path("prompt"));
        assertPriceClose(model, "输出", first.outputPricePerM(), entry.path("pricing").path("completion"));
    }

    /** 多供应商模型：我们记的单价必须落在线上各 endpoint 单价的 [最低, 最高] 之间（各留 1% 舍入余量）。 */
    private void assertPriceWithinEndpoints(AllowedModels model, String label, double oursPerM,
                                            List<JsonNode> endpoints, String field) {
        double min = Double.MAX_VALUE, max = 0d;
        for (JsonNode e : endpoints) {
            JsonNode price = e.path("pricing").path(field);
            assertTrue(price.isTextual() || price.isNumber(),
                    model.getModelId() + " 的 endpoint " + e.path("provider_name").asText() + " 缺" + label + "单价");
            double perM = Double.parseDouble(price.asText()) * 1_000_000d;
            min = Math.min(min, perM);
            max = Math.max(max, perM);
        }
        assertTrue(oursPerM >= min * (1 - PRICE_TOLERANCE) && oursPerM <= max * (1 + PRICE_TOLERANCE), String.format(
                "%s 的%s单价 $%s/1M 不在线上 %d 家供应商的区间 $%s–$%s/1M 内。改 AllowedModels，不要放宽区间。",
                model.getModelId(), label, oursPerM, endpoints.size(), min, max));
    }

    private void assertPriceClose(AllowedModels model, String label, double oursPerM, JsonNode upstreamPerToken) {
        // 不用 asText(default)：MissingNode 的这个重载在 Jackson 里返回空串而不是默认值，
        // 会把「字段缺失」伪装成「价格 0」
        assertTrue(upstreamPerToken.isTextual() || upstreamPerToken.isNumber(),
                model.getModelId() + " 的 pricing 缺" + label + "单价，实际节点=" + upstreamPerToken);
        double upstreamPerM = Double.parseDouble(upstreamPerToken.asText()) * 1_000_000d;

        // 动态路由别名的 pricing 是 -1，那种模型本来就不该进白名单
        assertTrue(upstreamPerM >= 0,
                model.getModelId() + " 的" + label + "单价为负（动态路由别名？），静态价格表无法计价");

        if (upstreamPerM == 0d) {
            assertEquals(0d, oursPerM, model.getModelId() + " 上游" + label + "免费，我们却记了单价");
            return;
        }
        double drift = Math.abs(oursPerM - upstreamPerM) / upstreamPerM;
        assertTrue(drift <= PRICE_TOLERANCE, String.format(
                "%s 的%s单价漂移 %.1f%%：我们记 $%s/1M，线上是 $%s/1M。"
                        + "偏高就是对用户超收，偏低是低报花费，两者都要改 AllowedModels，不要放宽容差。",
                model.getModelId(), label, drift * 100, oursPerM, upstreamPerM));
    }

    /** 某模型的在线 endpoint 列表。 */
    private List<JsonNode> fetchEndpoints(String modelId) {
        JsonNode endpoints = getJson(String.format(ENDPOINTS_URL, modelId)).path("data").path("endpoints");
        assertTrue(endpoints.isArray() && endpoints.size() > 0, modelId + " 没有在线 endpoint，无法完成对拍");
        List<JsonNode> list = new ArrayList<>();
        endpoints.forEach(list::add);
        return list;
    }

    private JsonNode getJson(String url) {
        try {
            HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(15)).build();
            HttpRequest request = HttpRequest.newBuilder(URI.create(url))
                    .timeout(Duration.ofSeconds(30)).header("Accept", "application/json").GET().build();
            HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
            assertTrue(response.statusCode() == 200, "拉取 " + url + " 失败，HTTP " + response.statusCode() + "，无法完成对拍");
            return new ObjectMapper().readTree(response.body());
        } catch (java.io.IOException e) {
            throw new AssertionError("拉取 " + url + " 出错，无法完成对拍：" + e);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new AssertionError("拉取 " + url + " 被中断");
        }
    }

    /** 拉线上目录，按 id 索引。这里不带 API key——{@code /models} 是公开端点。 */
    private Map<String, JsonNode> fetchUpstreamCatalog() {
        try {
            HttpClient client = HttpClient.newBuilder()
                    .connectTimeout(Duration.ofSeconds(15))
                    .build();
            HttpRequest request = HttpRequest.newBuilder(URI.create(MODELS_URL))
                    .timeout(Duration.ofSeconds(30))
                    .header("Accept", "application/json")
                    .GET()
                    .build();
            HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
            // Explicit live checks must fail when unavailable; a skipped audit is not a successful audit.
            assertTrue(response.statusCode() == 200,
                    "拉取 OpenRouter 目录失败，HTTP " + response.statusCode() + "，无法完成对拍");

            JsonNode data = new ObjectMapper().readTree(response.body()).path("data");
            assertTrue(data.isArray() && data.size() > 0, "OpenRouter 目录为空，无法完成对拍");

            Map<String, JsonNode> byId = new HashMap<>();
            for (JsonNode entry : data) {
                byId.put(entry.path("id").asText(), entry);
            }
            return byId;
        } catch (java.io.IOException e) {
            throw new AssertionError("拉取 OpenRouter 目录出错，无法完成对拍：" + e);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new AssertionError("拉取 OpenRouter 目录被中断，无法完成对拍");
        }
    }
}
