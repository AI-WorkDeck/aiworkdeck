// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.ai;

import com.checkba.service.LangText;
import com.checkba.service.account.AccountException;
import com.checkba.service.account.AccountTransport;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

/** Provider catalogue scoped to the actual platform credential and trusted endpoint. */
@Service
public class PlatformModelCatalog {
    private final PlatformAiChannel channel;
    private final AccountTransport transport;
    private final String openRouterBase;
    private final ObjectMapper mapper = new ObjectMapper();
    private final Map<String, Snapshot> cache = new ConcurrentHashMap<>();
    private record Snapshot(long expiresAt, Catalog catalog) {}
    public record Model(String id, String name, String vendor, int contextLength, int maxOutputTokens,
                        boolean supportsTools, boolean supportsVision, double inputPricePerMillion,
                        double outputPricePerMillion, boolean tiered) {}
    public record Catalog(String provider, String currency, String defaultModel,
                          double marginMultiplier, List<Model> models) {}

    public PlatformModelCatalog(PlatformAiChannel channel, AccountTransport transport,
            @Value("${ai.model.open-router.base-url:https://openrouter.ai/api/v1}") String openRouterBase) {
        this.channel = channel;
        this.transport = transport;
        this.openRouterBase = openRouterBase.replaceAll("/+$", "");
    }

    public Catalog current() {
        PlatformAiKeyService.Resolved connection = channel.connection();
        String base = connection.bailian() ? connection.baseUrl() : openRouterBase;
        String key = base + ":" + connection.fingerprint();
        Snapshot previous = cache.get(key);
        if (previous != null && previous.expiresAt() > System.currentTimeMillis()) return previous.catalog();
        AccountTransport.Reply reply = transport.send("GET", base + "/models", connection.apiKey(), null);
        if (reply.networkFailure() || reply.status() != 200) {
            throw new AccountException(AccountException.Kind.NETWORK,
                    LangText.of("模型目录暂时不可用，请稍后重试", "The model catalogue is temporarily unavailable. Retry shortly"));
        }
        Catalog catalog;
        try { catalog = parse(reply.body(), connection.bailian(), connection.defaultModel()); }
        catch (Exception e) {
            throw new AccountException(AccountException.Kind.MALFORMED,
                    LangText.of("模型目录数据不完整，请稍后重试", "The model catalogue is incomplete. Retry shortly"));
        }
        if (cache.size() >= 256) cache.clear();
        cache.put(key, new Snapshot(System.currentTimeMillis() + 60_000, catalog));
        return catalog;
    }

    Catalog parse(String json, boolean bailian, String preferredDefault) throws Exception {
        Map<?, ?> body = mapper.readValue(json, Map.class);
        Object raw = body.get(bailian ? "models" : "data");
        if (!(raw instanceof List<?> items)) throw new IllegalArgumentException("models");
        List<Model> models = new ArrayList<>();
        for (Object item : items) {
            if (!(item instanceof Map<?, ?> row) || !(row.get("id") instanceof String id) || id.isBlank()) continue;
            String name = row.get("name") instanceof String value ? value : id;
            if (bailian) {
                if (!validPrice(row.get("inputPricePerMillion")) || !validPrice(row.get("outputPricePerMillion"))) continue;
                models.add(new Model(id, name, row.get("vendor") instanceof String value ? value : "Alibaba Cloud",
                        integer(row.get("contextLength")), integer(row.get("maxOutputTokens")),
                        Boolean.TRUE.equals(row.get("supportsTools")), Boolean.TRUE.equals(row.get("supportsVision")),
                        number(row.get("inputPricePerMillion")), number(row.get("outputPricePerMillion")), Boolean.TRUE.equals(row.get("tiered"))));
            } else {
                Map<?, ?> architecture = row.get("architecture") instanceof Map<?, ?> map ? map : Map.of();
                if (!(architecture.get("output_modalities") instanceof List<?> outputs) || !outputs.contains("text")) continue;
                Map<?, ?> price = row.get("pricing") instanceof Map<?, ?> map ? map : Map.of();
                if (!validPrice(price.get("prompt")) || !validPrice(price.get("completion"))) continue;
                boolean tools = row.get("supported_parameters") instanceof List<?> parameters && parameters.contains("tools");
                boolean vision = architecture.get("input_modalities") instanceof List<?> inputs && inputs.contains("image");
                Map<?, ?> top = row.get("top_provider") instanceof Map<?, ?> map ? map : Map.of();
                models.add(new Model(id, name, id.contains("/") ? id.substring(0, id.indexOf('/')) : "OpenRouter",
                        integer(row.get("context_length")), integer(top.get("max_completion_tokens")), tools, vision,
                        number(price.get("prompt")) * 1_000_000, number(price.get("completion")) * 1_000_000, row.get("pricing_tiers") instanceof List<?> tiers && tiers.size() > 1));
            }
        }
        if (models.isEmpty()) throw new IllegalArgumentException("empty catalogue");
        String preferred = body.get("defaultModel") instanceof String value ? value : preferredDefault;
        String defaultModel = models.stream().filter(Model::supportsTools).filter(m -> m.id().equals(preferred))
                .map(Model::id).findFirst().orElseGet(() -> models.stream().filter(Model::supportsTools)
                        .map(Model::id).findFirst().orElse(models.get(0).id()));
        double margin = validPrice(body.get("marginMultiplier")) ? number(body.get("marginMultiplier")) : 1;
        return new Catalog(bailian ? "bailian" : "openrouter", bailian ? "CNY" : "USD", defaultModel, margin, List.copyOf(models));
    }

    public boolean contains(String id) { return current().models().stream().anyMatch(m -> m.id().equals(id)); }
    public Model model(String id) { return current().models().stream().filter(m -> m.id().equals(id)).findFirst().orElse(null); }

    public String resolve(String requested) {
        Catalog catalog = current();
        String id = AllowedModels.canonicalModelId(requested);
        if (catalog.models().stream().anyMatch(m -> m.id().equals(id))) return id;
        // Saved pre-migration OpenRouter choices cannot be sent to Bailian unchanged.
        if (requested == null || requested.isBlank() || "default".equals(requested)
                || SmartModelRouter.isAutoModel(requested) || "bailian".equals(catalog.provider()) && AllowedModels.isAllowed(requested)) {
            return catalog.defaultModel();
        }
        throw new AccountException(AccountException.Kind.CONFLICT,
                LangText.of("所选模型已不可用，请从模型列表重新选择", "The selected model is unavailable. Choose another model from the catalogue"));
    }

    public SmartModelRouter.RouteDecision adapt(SmartModelRouter.RouteDecision route, boolean needsVision) {
        Catalog catalog = current();
        Model exact = catalog.models().stream().filter(m -> m.id().equals(route.effectiveModelId()))
                .filter(m -> !needsVision || m.supportsVision()).filter(Model::supportsTools).findFirst().orElse(null);
        if ("bailian".equals(catalog.provider()) && route.routed()) {
            String preferred = route.tier() == SmartModelRouter.Tier.DEEP ? "qwen3.8-max" : "qwen3.8-flash";
            exact = catalog.models().stream().filter(Model::supportsTools)
                    .filter(m -> !needsVision || m.supportsVision())
                    .filter(m -> m.id().equals(preferred)).findFirst().orElse(exact);
        }
        if (exact == null) {
            List<Model> candidates = catalog.models().stream().filter(Model::supportsTools)
                    .filter(m -> !needsVision || m.supportsVision()).toList();
            exact = candidates.stream().filter(m -> m.id().equals(catalog.defaultModel())).findFirst()
                    .orElse(candidates.isEmpty() ? null : candidates.get(0));
        }
        if (exact == null) throw new AccountException(AccountException.Kind.CONFLICT,
                LangText.of("当前平台没有支持本次任务的模型", "This platform has no model supporting this task"));
        return new SmartModelRouter.RouteDecision(route.requestedModel(), exact.id(), exact.name(),
                route.tier(), route.reasoningEffort(), route.routed());
    }

    public String failover(List<String> candidates, String currentModel, Set<String> tried, boolean vision) {
        if (candidates == null) return null;
        Catalog catalog = current();
        for (String candidate : candidates) {
            if (candidate == null || candidate.isBlank() || candidate.equalsIgnoreCase(currentModel)
                    || tried != null && tried.contains(candidate.toLowerCase(Locale.ROOT))) continue;
            Model model = catalog.models().stream().filter(m -> m.id().equals(candidate))
                    .filter(Model::supportsTools).filter(m -> !vision || m.supportsVision()).findFirst().orElse(null);
            if (model != null) return model.id();
        }
        return null;
    }

    private static boolean validPrice(Object value) {
        try { double n = Double.parseDouble(String.valueOf(value)); return Double.isFinite(n) && n >= 0; }
        catch (Exception e) { return false; }
    }
    private static double number(Object value) { return Double.parseDouble(String.valueOf(value)); }
    private static int integer(Object value) { return value instanceof Number n ? Math.max(0, n.intValue()) : 0; }
}
