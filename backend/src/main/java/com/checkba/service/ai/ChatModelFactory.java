package com.checkba.service.ai;

import com.checkba.config.AiModelProperties;
import dev.langchain4j.model.chat.ChatLanguageModel;
import dev.langchain4j.model.ollama.OllamaChatModel;
import dev.langchain4j.model.openai.OpenAiChatModel;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * ChatModel 工厂类。
 * 负责根据前端传入的 model 参数动态构建或从缓存获取 ChatLanguageModel 实例。
 * 支持 OpenRouter, Gemini, Ollama。
 */
@Service
@RequiredArgsConstructor
public class ChatModelFactory {

    private static final org.slf4j.Logger log = org.slf4j.LoggerFactory.getLogger(ChatModelFactory.class);

    private final AiModelProperties aiModelProperties;

    // 缓存: key = provider + ":" + modelName
    private final Map<String, ChatLanguageModel> modelCache = new ConcurrentHashMap<>();

    /**
     * 获取或创建 ChatLanguageModel。
     * @param modelId 前端传来的模型ID (e.g. "anthropic/claude-3.5-sonnet")。如果是 null，使用默认配置。
     * @return ChatLanguageModel 实例
     */
    public ChatLanguageModel getChatModel(String modelId) {
        // 1. Determine Provider and Normalized Model Name
        AiModelProperties.Provider provider = aiModelProperties.getProvider();
        String targetModel = modelId;

        if (targetModel == null || targetModel.isEmpty()) {
            targetModel = "default";
        }

        // Logic to switch provider based on modelId pattern if Provider is set to OPENROUTER or dynamic
        // For now, if modelId contains "/", we assume it's OpenRouter style (except for "google/gemini" if we treat it specially, but OpenRouter handles google too)
        
        // Strategy:
        // - If modelID is "default" or local-looking => use Configured Provider (Ollama/Gemini) properties.
        // - If modelID looks like "provider/model" (e.g. "anthropic/claude") => Force OpenRouter if generic, or check allowed list.

        if (AllowedModels.isAllowed(targetModel)) {
            // It's a valid OpenRouter/Cloud model
            return getOrCreateOpenRouterModel(targetModel);
        }

        // Fallback to configured default provider (Legacy behavior)
        // If the user wants to force specific internal models (Gemini/Ollama) via "default"
        if (provider == AiModelProperties.Provider.GEMINI || (targetModel.toLowerCase().contains("gemini") && !targetModel.contains("/"))) {
            return getOrCreateGeminiModel(aiModelProperties.getGemini().getModelName()); // fallback to config model name if generic request
        }

        // Default to Ollama
        return getOrCreateOllamaModel(aiModelProperties.getOllama().getModelName());
    }

    private ChatLanguageModel getOrCreateOpenRouterModel(String modelId) {
        String cacheKey = "openrouter:" + modelId;
        return modelCache.computeIfAbsent(cacheKey, k -> {
            log.info("Creating new OpenRouter ChatModel instance for: {}", modelId);
            AiModelProperties.OpenRouter config = aiModelProperties.getOpenRouter();
            return OpenAiChatModel.builder()
                    .apiKey(config.getApiKey())
                    .baseUrl(config.getBaseUrl())
                    .modelName(modelId)
                    .timeout(config.getTimeout())
                    .logRequests(true)
                    .logResponses(true)
                    // Custom Headers for OpenRouter
                    // .defaultRequestProperties(Map.of(
                    //         "HTTP-Referer", "https://checkba.com", // Replace with actual URL
                    //         "X-Title", "Checkba King IDE"
                    // ))
                    .build();
        });
    }

    private ChatLanguageModel getOrCreateOllamaModel(String modelName) {
        String cacheKey = "ollama:" + modelName;
        return modelCache.computeIfAbsent(cacheKey, k -> {
            log.info("Creating new Ollama ChatModel instance for: {}", modelName);
            AiModelProperties.Ollama config = aiModelProperties.getOllama();
            return OllamaChatModel.builder()
                    .baseUrl(config.getBaseUrl())
                    .modelName(modelName) // use param or config? use param to support multiple local models if needed
                    .temperature(config.getTemperature())
                    .timeout(config.getTimeout())
                    .build();
        });
    }

    private ChatLanguageModel getOrCreateGeminiModel(String modelName) {
        String cacheKey = "gemini:" + modelName;
        return modelCache.computeIfAbsent(cacheKey, k -> {
            log.info("Creating new Gemini ChatModel instance for: {}", modelName);
            AiModelProperties.Gemini config = aiModelProperties.getGemini();
            return new GeminiChatLanguageModel(
                    config.getApiBaseUrl(),
                    modelName,
                    config.getApiKey(),
                    config.getTimeout()
            );
        });
    }
    // Streaming Cache
    private final Map<String, dev.langchain4j.model.chat.StreamingChatLanguageModel> streamingModelCache = new ConcurrentHashMap<>();

    public dev.langchain4j.model.chat.StreamingChatLanguageModel getStreamingChatModel(String modelId) {
        String targetModel = (modelId == null || modelId.isEmpty()) ? "default" : modelId;
        
        if (AllowedModels.isAllowed(targetModel)) {
            return getOrCreateOpenRouterStreamingModel(targetModel);
        }

        // Fallback or Local
        AiModelProperties.Provider provider = aiModelProperties.getProvider();
        if (provider == AiModelProperties.Provider.GEMINI || (targetModel.toLowerCase().contains("gemini") && !targetModel.contains("/"))) {
            // TODO: Implement Gemini Streaming. For now, throw or fallback? 
            // Or use OpenRouter for Gemini if configured?
            // Let's return a specific failure or just try OpenRouter if key is present?
            // For now, let's assume we use Ollama fallback or implement a simple Gemini adapter later.
            // Returning null might crash Orchestrator.
            // Let's try OpenRouter logic if it looks like a model ID, otherwise Ollama.
             return getOrCreateOllamaStreamingModel(aiModelProperties.getOllama().getModelName());
        }

        return getOrCreateOllamaStreamingModel(aiModelProperties.getOllama().getModelName());
    }

    private dev.langchain4j.model.chat.StreamingChatLanguageModel getOrCreateOpenRouterStreamingModel(String modelId) {
        String cacheKey = "openrouter_stream:" + modelId;
        return streamingModelCache.computeIfAbsent(cacheKey, k -> {
            log.info("Creating new OpenRouter StreamingChatModel for: {}", modelId);
            AiModelProperties.OpenRouter config = aiModelProperties.getOpenRouter();
            return dev.langchain4j.model.openai.OpenAiStreamingChatModel.builder()
                    .apiKey(config.getApiKey())
                    .baseUrl(config.getBaseUrl())
                    .modelName(modelId)
                    .timeout(config.getTimeout())
                    .logRequests(true)
                    .logResponses(true)
                    // .defaultRequestProperties(Map.of(
                    //         "HTTP-Referer", "https://checkba.com",
                    //         "X-Title", "Checkba King IDE"
                    // ))
                    .build();
        });
    }

    private dev.langchain4j.model.chat.StreamingChatLanguageModel getOrCreateOllamaStreamingModel(String modelName) {
        String cacheKey = "ollama_stream:" + modelName;
        return streamingModelCache.computeIfAbsent(cacheKey, k -> {
            log.info("Creating new Ollama StreamingChatModel for: {}", modelName);
            AiModelProperties.Ollama config = aiModelProperties.getOllama();
            return dev.langchain4j.model.ollama.OllamaStreamingChatModel.builder()
                    .baseUrl(config.getBaseUrl())
                    .modelName(modelName)
                    .temperature(config.getTemperature())
                    .timeout(config.getTimeout())
                    .build();
        });
    }
}
