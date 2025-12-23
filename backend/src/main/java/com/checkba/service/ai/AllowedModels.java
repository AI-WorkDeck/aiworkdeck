package com.checkba.service.ai;

/**
 * 允许的模型白名单。
 * 防止前端传递恶意模型 ID 或非预期的高价模型。
 */
public enum AllowedModels {

    // Anthony
    // Google (via OpenRouter)
    GEMINI_2_0_FLASH_EXP_FREE("google/gemini-2.0-flash-exp:free", 0.0, 0.0),
    GEMINI_2_0_FLASH_001("google/gemini-2.0-flash-001", 0.1, 0.4),
    GEMINI_2_5_PRO("google/gemini-2.5-pro", 1.25, 5.0),
    GEMINI_2_5_FLASH("google/gemini-2.5-flash", 0.1, 0.4),
    GEMINI_3_PRO_PREVIEW("google/gemini-3-pro-preview", 1.25, 5.0),
    GEMINI_3_FLASH_PREVIEW("google/gemini-3-flash-preview", 0.1, 0.4),
    
    // Anthony
    CLAUDE_3_5_SONNET("anthropic/claude-3.5-sonnet", 3.0, 15.0), 
    CLAUDE_3_HAIKU("anthropic/claude-3-haiku", 0.25, 1.25),
    
    // OpenAI 
    GPT_4O("openai/gpt-4o", 5.0, 15.0),
    GPT_4O_MINI("openai/gpt-4o-mini", 0.15, 0.6),
    
    // Open Source
    LLAMA_3_70_B("meta-llama/llama-3-70b-instruct", 0.9, 0.9),
    QWEN_2_5_72B("qwen/qwen-2.5-72b-instruct", 0.35, 0.4);



    private final String modelId;
    /**
     * 预估输入价格 ($/1M tokens)
     */
    private final double inputPricePerM;
    /**
     * 预估输出价格 ($/1M tokens)
     */
    private final double outputPricePerM;

    AllowedModels(String modelId, double inputPricePerM, double outputPricePerM) {
        this.modelId = modelId;
        this.inputPricePerM = inputPricePerM;
        this.outputPricePerM = outputPricePerM;
    }

    public String getModelId() {
        return modelId;
    }

    public double getInputPricePerM() {
        return inputPricePerM;
    }

    public double getOutputPricePerM() {
        return outputPricePerM;
    }

    public static boolean isAllowed(String modelId) {
        if (modelId == null || modelId.trim().isEmpty()) return false;
        for (AllowedModels m : values()) {
            if (m.modelId.equalsIgnoreCase(modelId)) return true;
        }
        return false;
    }
    
    public static AllowedModels fromId(String modelId) {
        for (AllowedModels m : values()) {
            if (m.modelId.equalsIgnoreCase(modelId)) return m;
        }
        return null;
    }
}
