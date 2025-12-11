package com.checkba.service.ai;

import cn.hutool.http.HttpRequest;
import cn.hutool.http.HttpResponse;
import cn.hutool.json.JSONArray;
import cn.hutool.json.JSONObject;
import cn.hutool.json.JSONUtil;
import dev.langchain4j.data.message.AiMessage;
import dev.langchain4j.data.message.ChatMessage;
import dev.langchain4j.data.message.ChatMessageType;
import dev.langchain4j.model.chat.ChatLanguageModel;
import dev.langchain4j.model.output.Response;
import lombok.extern.slf4j.Slf4j;

import java.time.Duration;
import java.util.List;

/**
 * 基于 Google Gemini HTTP API 的 ChatLanguageModel 实现。
 *
 * 说明：
 * - 通过官方 REST 接口 /models/{model}:generateContent 调用
 * - 将 LangChain4j 的 ChatMessage 序列化为 Gemini 的 contents 结构
 */
@Slf4j
public class GeminiChatLanguageModel implements ChatLanguageModel {

    private final String apiBaseUrl;
    private final String modelName;
    private final String apiKey;
    private final Duration timeout;

    public GeminiChatLanguageModel(String apiBaseUrl, String modelName, String apiKey, Duration timeout) {
        this.apiBaseUrl = apiBaseUrl != null ? apiBaseUrl : "https://generativelanguage.googleapis.com/v1beta";
        this.modelName = modelName != null ? modelName : "gemini-1.5-pro";
        this.apiKey = apiKey;
        this.timeout = timeout != null ? timeout : Duration.ofSeconds(60);
    }

    @Override
    public Response<AiMessage> generate(List<ChatMessage> messages) {
        if (apiKey == null || apiKey.isEmpty()) {
            throw new IllegalStateException("Gemini API key is not configured (ai.model.gemini.api-key)");
        }

        try {
            String url = String.format("%s/models/%s:generateContent?key=%s",
                    apiBaseUrl, modelName, apiKey);

            JSONObject body = new JSONObject();
            JSONArray contents = new JSONArray();

            // 将 SYSTEM 消息合并为前缀，附加到下一条 USER 消息上，尽量保留指示信息
            StringBuilder systemPrefix = new StringBuilder();

            for (ChatMessage message : messages) {
                ChatMessageType type = message.type();
                String text = message.text();
                if (text == null || text.isEmpty()) {
                    continue;
                }

                if (type == ChatMessageType.SYSTEM) {
                    if (systemPrefix.length() > 0) {
                        systemPrefix.append("\n");
                    }
                    systemPrefix.append(text);
                    continue;
                }

                // LangChain4j 中：
                // - USER → user
                // - AI   → model
                // 其余类型（如 TOOL_EXECUTION_RESULT）这里先忽略或按 user 处理
                String role;
                if (type == ChatMessageType.AI) {
                    role = "model";
                } else {
                    role = "user";
                }

                JSONObject content = new JSONObject();
                content.set("role", role);

                JSONArray parts = new JSONArray();
                JSONObject part = new JSONObject();

                if (systemPrefix.length() > 0 && type == ChatMessageType.USER) {
                    part.set("text", systemPrefix + "\n\n" + text);
                    systemPrefix.setLength(0);
                } else {
                    part.set("text", text);
                }

                parts.add(part);
                content.set("parts", parts);
                contents.add(content);
            }

            // 如果只有 SystemMessage，被上面逻辑吃掉了，这里做一次兜底
            if (contents.isEmpty()) {
                JSONObject content = new JSONObject();
                content.set("role", "user");
                JSONArray parts = new JSONArray();
                JSONObject part = new JSONObject();
                part.set("text", systemPrefix.length() > 0 ? systemPrefix.toString() : "");
                parts.add(part);
                content.set("parts", parts);
                contents.add(content);
            }

            body.set("contents", contents);

            log.debug("Calling Gemini API: url={} body={}", url, body.toString());

            HttpResponse response = HttpRequest.post(url)
                    .header("Content-Type", "application/json")
                    .body(body.toString())
                    .timeout((int) timeout.toMillis())
                    .execute();

            String respBody = response.body();
            log.debug("Gemini raw response: {}", respBody);

            if (response.getStatus() / 100 != 2) {
                log.error("Gemini API error, status={} body={}", response.getStatus(), respBody);
                throw new RuntimeException("Gemini API error: " + response.getStatus() + " " + respBody);
            }

            JSONObject root = JSONUtil.parseObj(respBody);
            JSONArray candidates = root.getJSONArray("candidates");
            if (candidates == null || candidates.isEmpty()) {
                throw new RuntimeException("Gemini returned no candidates");
            }

            JSONObject first = candidates.getJSONObject(0);
            JSONObject content = first.getJSONObject("content");
            if (content == null) {
                throw new RuntimeException("Gemini response missing content");
            }

            JSONArray parts = content.getJSONArray("parts");
            if (parts == null || parts.isEmpty()) {
                throw new RuntimeException("Gemini response has empty parts");
            }

            StringBuilder textBuilder = new StringBuilder();
            for (int i = 0; i < parts.size(); i++) {
                JSONObject part = parts.getJSONObject(i);
                String t = part.getStr("text");
                if (t != null) {
                    textBuilder.append(t);
                }
            }

            String answer = textBuilder.toString().trim();
            return Response.from(AiMessage.aiMessage(answer));
        } catch (Exception e) {
            log.error("Error calling Gemini API", e);
            throw new RuntimeException("Error calling Gemini API: " + e.getMessage(), e);
        }
    }
}


