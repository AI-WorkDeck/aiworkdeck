package com.checkba.config;

import com.checkba.service.ai.DynamicContentRetriever;
import com.checkba.service.ai.GeminiChatLanguageModel;
import com.checkba.service.ai.ProjectAssistant;
import com.checkba.service.ai.tools.FileTools;
import dev.langchain4j.model.chat.ChatLanguageModel;
import dev.langchain4j.service.AiServices;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * AI 服务统一配置：
 * - 根据配置选择不同的大模型供应商（Ollama / Google Gemini）
 * - 创建 ProjectAssistant，实现对话 + RAG + 文件工具
 */
@Slf4j
@Configuration
@RequiredArgsConstructor
public class AiConfiguration {

    private final AiModelProperties aiModelProperties;
    private final DynamicContentRetriever dynamicContentRetriever;
    private final FileTools fileTools;

    /**
     * 统一的 ChatLanguageModel，根据 ai.model.provider 切换供应商。
     */
    @Bean
    public ChatLanguageModel projectChatLanguageModel() {
        AiModelProperties.Provider provider = aiModelProperties.getProvider();
        if (provider == null) {
            provider = AiModelProperties.Provider.OLLAMA;
        }

        switch (provider) {
            case GEMINI:
                AiModelProperties.Gemini geminiCfg = aiModelProperties.getGemini();
                log.info("Using Google Gemini chat model: model={} endpoint={}",
                        geminiCfg.getModelName(), geminiCfg.getApiBaseUrl());
                return new GeminiChatLanguageModel(
                        geminiCfg.getApiBaseUrl(),
                        geminiCfg.getModelName(),
                        geminiCfg.getApiKey(),
                        geminiCfg.getTimeout()
                );
            case OLLAMA:
            default:
                AiModelProperties.Ollama ollamaCfg = aiModelProperties.getOllama();
                log.info("Using Ollama chat model: baseUrl={} model={}",
                        ollamaCfg.getBaseUrl(), ollamaCfg.getModelName());
                return dev.langchain4j.model.ollama.OllamaChatModel.builder()
                        .baseUrl(ollamaCfg.getBaseUrl())
                        .modelName(ollamaCfg.getModelName())
                        .temperature(ollamaCfg.getTemperature())
                        .timeout(ollamaCfg.getTimeout())
                        .build();
        }
    }

    /**
     * ProjectAssistant Bean：
     * - 使用上面的 ChatLanguageModel
     * - 注入 RAG 检索器（动态按项目加载向量）
     * - 仅在支持工具的模型下注入文件工具（支持“保存内容到文件”等能力）
     */
    @Bean
    public ProjectAssistant projectAssistant(ChatLanguageModel projectChatLanguageModel) {
        AiModelProperties.Provider provider = aiModelProperties.getProvider();
        if (provider == null) {
            provider = AiModelProperties.Provider.OLLAMA;
        }

        AiServices<ProjectAssistant> builder = AiServices
                .builder(ProjectAssistant.class)
                .chatLanguageModel(projectChatLanguageModel)
                .contentRetriever(dynamicContentRetriever);

        // 目前 GeminiChatLanguageModel 尚未实现 Tool 调用能力，
        // 只在本地 Ollama 场景下启用 FileTools，避免抛出
        // "Tools are currently not supported by this model" 的错误。
        if (provider == AiModelProperties.Provider.OLLAMA) {
            builder.tools(fileTools);
        }

        return builder.build();
    }
}


