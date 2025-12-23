package com.checkba.service.ai.tools;

import com.checkba.service.ai.ProjectRagService;
import dev.langchain4j.agent.tool.Tool;
import dev.langchain4j.rag.content.retriever.ContentRetriever;
import dev.langchain4j.rag.query.Query;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.io.File;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardOpenOption;
import java.time.LocalDateTime;

/**
 * Memory Tools for the Agent.
 * Includes:
 * 1. Add Memory (Save Key Preferences/Facts)
 * 2. Query Knowledge Base (RAG)
 */
@Component
@Slf4j
@RequiredArgsConstructor
public class MemoryTools {

    private static final org.slf4j.Logger log = org.slf4j.LoggerFactory.getLogger(MemoryTools.class);

    private final ProjectRagService projectRagService;

    // Simple file-based KV store for "Long Term Memory" (MVP)
    // Saved in ~/.gemini/checkba_memory.json or similar
    private final Path memoryFile = Paths.get(System.getProperty("user.home"), ".gemini", "checkba_memory.txt");

    @Tool("Add a piece of information to long-term memory. Use this for user preferences or important facts.")
    public String add_memory(String key, String value) {
        log.info("Tool: add_memory called key={}, value={}", key, value);
        try {
            if (!Files.exists(memoryFile.getParent())) {
                Files.createDirectories(memoryFile.getParent());
            }
            String line = LocalDateTime.now() + " | " + key + ": " + value + "\n";
            Files.writeString(memoryFile, line, StandardOpenOption.CREATE, StandardOpenOption.APPEND);
            return "Memory added successfully.";
        } catch (Exception e) {
            return "Error adding memory: " + e.getMessage();
        }
    }

    @Tool("Query the project's knowledge base (documents). Returns relevant snippets.")
    public String query_knowledge_base(String query) {
        log.info("Tool: query_knowledge_base called for query='{}'", query);
        try {
            // How do we know the ProjectId?
            // Usually context is needed. If we don't have projectId, we might scan all?
            // For this tool to work, the Agent usually operates within a "Project Context".
            // Since we can't easily injection Request Scope here without ThreadLocal, 
            // we'll assume a default or pass it?
            
            // HACK: For now, we search the 'default' project or we need to ask User to provide projectId?
            // Better: update tool signature to `query_knowledge_base(query, projectId)` 
            // OR the Agent knows the current projectId from the System Prompt and passes it?
            // The System Prompt says "- Current Task List ID", but not Project ID explicitly?
            // Actually, we can try to guess or use a placeholder.
            // Let's rely on the Agent passing projectId if it knows it, or we defaulting to the active one.
            
            // Let's search ALL known projects in cache? No.
            // We'll return a hint: "Please provide Project ID to search specific documents."
            // But wait, the user wants "search project files" (FileTools) vs "query_knowledge_base" (RAG).
            // RAG is usually better for semantic search. 
            // Let's implement this but note the limitation.
            
            return "Knowledge Base Query requires ProjectContext. (To be implemented fully: ensure ProjectId is passed)";
            
        } catch (Exception e) {
            return "Error querying knowledge base: " + e.getMessage();
        }
    }
    
    // Overloaded to accept projectId if the Agent decides to pass it
    @Tool("Query the knowledge base for a specific project.")
    public String query_knowledge_base_with_id(String query, String projectId) {
         log.info("Tool: query_knowledge_base_with_id called query='{}', projectId='{}'", query, projectId);
         try {
             ContentRetriever retriever = projectRagService.getRetrieverForProject(projectId);
             // Retrieve
             // Note: ContentRetriever API usually takes a Query object.
             // We need to fetch contents. 
             // LangChain4j usage: retriever.retrieve(Query.from(query))
             
             var contents = retriever.retrieve(Query.from(query));
             if (contents.isEmpty()) return "No relevant information found.";
             
             StringBuilder sb = new StringBuilder("Found matches:\n");
             contents.forEach(content -> {
                 sb.append("- ").append(content.textSegment().text()).append("\n");
             });
             return sb.toString();
         } catch (Exception e) {
             return "Error: " + e.getMessage();
         }
    }
}
