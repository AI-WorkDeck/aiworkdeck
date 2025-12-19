package com.checkba.model.ai;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class AiAssistantConfig {
    private String id;
    private String name;
    private String systemPrompt;
    private List<String> tools; // e.g. ["renameFile", "listFiles"]
    private String description;
    
    // Custom user instruction that overrides system prompt if present
    private String userPrompt;

    public AiAssistantConfig(String id, String name, String systemPrompt, List<String> tools, String description) {
        this.id = id;
        this.name = name;
        this.systemPrompt = systemPrompt;
        this.tools = tools;
        this.description = description;
    }
}
