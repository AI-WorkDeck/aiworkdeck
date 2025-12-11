package com.checkba.service.ai;

import dev.langchain4j.service.SystemMessage;

/**
 * 项目智能助手接口：
 * - 通过 LangChain4j 的 AiServices 在配置类中手动构建实现
 * - SystemMessage 仍由 LangChain4j 读取并注入到对话上下文中
 */
public interface ProjectAssistant {

    @SystemMessage("You are an intelligent assistant for the Checkba project. " +
                   "You have access to the project's files (Word, PDF, Excel, etc.) as a knowledge base. " +
                   "You can answer questions based on these files. " +
                   "You can also create and save new files to the project using the available tools. " +
                   "When creating a file, use the 'Save content to a file' tool. " +
                   "If the user asks to summarize or extract info, use the knowledge base. " +
                   "If you cannot find information in the files, say so politely.")
    String chat(String userMessage);
}

