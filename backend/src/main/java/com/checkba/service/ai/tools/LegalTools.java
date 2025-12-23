package com.checkba.service.ai.tools;

import com.checkba.service.ProjectFileService;
import com.checkba.service.ai.mcp.McpClientService;
import com.checkba.model.entity.ProjectFile;
import dev.langchain4j.agent.tool.Tool;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

import java.util.HashMap;
import java.util.Map;

/**
 * Legal Tools Set for the Agent.
 * Includes:
 * 1. File Operations (Read Document) - using Tika or simple read
 * 2. PKULaw MCP Integration - using standard MCP SDK
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class LegalTools {

    private final ProjectFileService projectFileService;
    private final McpClientService mcpClientService;

    // --- File Operations ---

    @Tool("Read document content. Use this to read files from the project. Provide fileId.")
    public String read_document(String fileId) {
        log.info("Tool: read_document called for fileId={}", fileId);
        try {
            Long fId = Long.parseLong(fileId);
            ProjectFile file = projectFileService.getFile(fId);
            if (file == null) return "Error: File not found.";

            String filePath = file.getFilePath();
            if (!StringUtils.hasText(filePath)) return "Error: File path is empty.";

            byte[] bytes = projectFileService.getFileBytes(fId);
            if (bytes == null || bytes.length == 0) return "File is empty.";
            
            String fileName = file.getName().toLowerCase();
            
            // Text Files
            if (fileName.endsWith(".txt") || fileName.endsWith(".md") || fileName.endsWith(".java") 
                || fileName.endsWith(".py") || fileName.endsWith(".xml") || fileName.endsWith(".json")
                || fileName.endsWith(".yaml") || fileName.endsWith(".yml") || fileName.endsWith(".log")) {
                return new String(bytes, java.nio.charset.StandardCharsets.UTF_8);
            }
            
            // Heavy Files (PDF, DOCX) -> Use Tika
            try (java.io.InputStream is = new java.io.ByteArrayInputStream(bytes)) {
                dev.langchain4j.data.document.parser.apache.tika.ApacheTikaDocumentParser parser = new dev.langchain4j.data.document.parser.apache.tika.ApacheTikaDocumentParser();
                dev.langchain4j.data.document.Document doc = parser.parse(is);
                return doc.text();
            }
            
        } catch (Exception e) {
            log.error("Failed to read document {}", fileId, e);
            return "Error reading document: " + e.getMessage();
        }
    }

    // --- PKULaw MCP Integration (using standard MCP SDK) ---

    @Tool("Search for laws and regulations using PKULaw MCP Semantic Search. Use this for general legal questions. Returns a list of relevant articles.")
    public String law_search(String query) {
        log.info("Tool: law_search (semantic) called for query='{}'", query);
        return mcpClientService.callTool("pkulaw-semantic", "search_article", Map.of("query", query));
    }

    @Tool("Search for laws by keywords in title or fulltext. Use this when you need specific laws by name.")
    public String law_search_keyword(String title, String fulltext) {
        log.info("Tool: law_search_keyword called for title='{}', fulltext='{}'", title, fulltext);
        Map<String, Object> args = new HashMap<>();
        if (StringUtils.hasText(title)) args.put("title", title);
        if (StringUtils.hasText(fulltext)) args.put("fulltext", fulltext);
        
        return mcpClientService.callTool("pkulaw-keyword", "get_law_list", args);
    }

    @Tool("Identify law names and articles from text and trace their source.")
    public String law_recognition(String text) {
        log.info("Tool: law_recognition called for text length={}", text.length());
        return mcpClientService.callTool("pkulaw-recognition", "law_recognition", Map.of("text", text));
    }

    @Tool("Get the full content of a specific law article by its title and article number. Use this when you have article info from law_search results.")
    public String get_law_article(String title, String number) {
        log.info("Tool: get_law_article called for title='{}', number='{}'", title, number);
        return mcpClientService.callTool("pkulaw-semantic", "get_article", Map.of("title", title, "number", number));
    }
}
