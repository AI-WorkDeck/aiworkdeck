// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ai.eval;

import dev.langchain4j.agent.tool.ToolSpecification;
import dev.langchain4j.model.openai.OpenAiTokenizer;

import java.util.List;

/**
 * 工具面体量的统一口径（docs/plans/tool-surface-audit.md S0）。
 *
 * <p>上线路 JSON（与 {@code OpenRouterStreamingChatModel} 同一条编组，剔空白）再过 o200k 分词。
 * 不是各供应商的计费实数，只用来做前后对比。
 */
final class ToolSurfaceMetrics {

    private static final OpenAiTokenizer TOKENIZER = new OpenAiTokenizer("gpt-4o");

    private ToolSurfaceMetrics() {
    }

    static String wireJson(List<ToolSpecification> specs) {
        if (specs == null || specs.isEmpty()) {
            return "";
        }
        String json = dev.ai4j.openai4j.Json.toJson(
                dev.langchain4j.model.openai.InternalOpenAiHelper.toTools(specs, false));
        return json.replaceAll("[ \\t\\n\\r]", "");
    }

    static int schemaTokens(List<ToolSpecification> specs) {
        String json = wireJson(specs);
        return json.isEmpty() ? 0 : TOKENIZER.estimateTokenCountInText(json);
    }
}
