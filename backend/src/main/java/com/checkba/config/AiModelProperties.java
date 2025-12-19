package com.checkba.config;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

import java.time.Duration;

/**
 * AI 大模型相关配置（供应商可切换）。
 *
 * 配置前缀：ai.model
 */
@Data
@Component
@ConfigurationProperties(prefix = "ai.model")
public class AiModelProperties {

    /**
     * 模型提供商：
     * - OLLAMA：本地 Ollama 服务
     * - GEMINI：Google Gemini 云端模型
     */
    public enum Provider {
        OLLAMA,
        GEMINI
    }

    /**
     * 当前使用的模型提供商，默认继续使用本地 Ollama。
     */
    private Provider provider = Provider.OLLAMA;

    /**
     * Google Gemini 配置。
     */
    private Gemini gemini = new Gemini();

    /**
     * 本地 Ollama 配置（用于兼容当前的本地大模型设置）。
     */
    private Ollama ollama = new Ollama();

    @Data
    public static class Gemini {

        /**
         * Gemini API 密钥（建议通过环境变量 GEMINI_API_KEY 注入）。
         */
        private String apiKey;

        /**
         * 使用的 Gemini 模型名称，例如：gemini-2.5-pro、gemini-2.5-flash 等。
         * 参考官方文档当前推荐的通用文本模型：https://ai.google.dev/gemini-api/docs/pricing?hl=zh-cn
         */
        private String modelName = "gemini-2.5-pro";

        /**
         * Gemini API 基础地址。
         */
        private String apiBaseUrl = "https://generativelanguage.googleapis.com/v1beta";

        /**
         * 请求超时时间。
         */
        private Duration timeout = Duration.ofSeconds(60);
    }

    @Data
    public static class Ollama {

        /**
         * 本地 Ollama 服务地址。
         */
        private String baseUrl = "http://localhost:11434";

        /**
         * 用于对话的模型名称。
         */
        private String modelName = "qwen3-vl:8b";

        /**
         * 采样温度。
         */
        private Double temperature = 0.7;

        /**
         * 请求超时时间。
         */
        private Duration timeout = Duration.ofSeconds(300);
    }
}


