package com.checkba.model.ai;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

public class AiAssistantConfig {
    private String id;
    private String name;
    private String systemPrompt;
    private List<String> tools; // e.g. ["renameFile", "listFiles"]
    private String description;
    
    // Custom user instruction that overrides system prompt if present
    private String userPrompt;

    public AiAssistantConfig() {}

    public AiAssistantConfig(String id, String name, String systemPrompt, List<String> tools, String description) {
        this.id = id;
        this.name = name;
        this.systemPrompt = systemPrompt;
        this.tools = tools;
        this.description = description;
    }

    public AiAssistantConfig(String id, String name, String systemPrompt, List<String> tools, String description, String userPrompt) {
        this.id = id;
        this.name = name;
        this.systemPrompt = systemPrompt;
        this.tools = tools;
        this.description = description;
        this.userPrompt = userPrompt;
    }

    public String getId() { return id; }
    public void setId(String id) { this.id = id; }
    public String getName() { return name; }
    public void setName(String name) { this.name = name; }
    public String getSystemPrompt() { return systemPrompt; }
    public void setSystemPrompt(String systemPrompt) { this.systemPrompt = systemPrompt; }
    public List<String> getTools() { return tools; }
    public void setTools(List<String> tools) { this.tools = tools; }
    public String getDescription() { return description; }
    public void setDescription(String description) { this.description = description; }
    public String getUserPrompt() { return userPrompt; }
    public void setUserPrompt(String userPrompt) { this.userPrompt = userPrompt; }
}
