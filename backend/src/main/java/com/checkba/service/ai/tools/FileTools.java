package com.checkba.service.ai.tools;

import com.checkba.storage.StorageProperties;
import dev.langchain4j.agent.tool.Tool;
import dev.langchain4j.agent.tool.P;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardOpenOption;

@Component
@Slf4j
@RequiredArgsConstructor
public class FileTools {

    private final StorageProperties storageProperties;

    @Tool("Save content to a file in the project workspace. Use this when asked to create, write, or save a file.")
    public String saveFile(
            @P("The ID of the project") String projectId,
            @P("The name of the file (e.g., summary.txt, report.md)") String fileName,
            @P("The content to write to the file") String content) {
        
        try {
            Path storageRoot = getStorageRoot();
            
            // New structure: projects/{projectId}/edit/{fileName}
            // AI generated files are considered editable
            Path projectEditDir = storageRoot.resolve("projects").resolve(projectId).resolve("edit");
            
            if (!Files.exists(projectEditDir)) {
                Files.createDirectories(projectEditDir);
            }
            
            Path filePath = projectEditDir.resolve(fileName);
            
            // Security check
            if (!filePath.normalize().startsWith(storageRoot.normalize())) {
                return "Error: Invalid file path (directory traversal detected).";
            }

            Files.writeString(filePath, content, StandardCharsets.UTF_8, 
                    StandardOpenOption.CREATE, StandardOpenOption.TRUNCATE_EXISTING);
            
            log.info("AI generated file saved: {}", filePath);
            
            // Note: We might want to register this file in DB (ProjectFile) so it appears in frontend.
            // But FileTools operates at a lower level. Frontend might need to "scan" or refresh to see it,
            // or we need to inject ProjectFileRepository here. 
            // For now, we just save the file physically as requested.
            
            return "File saved successfully as " + fileName;
        } catch (IOException e) {
            log.error("Failed to save file", e);
            return "Error saving file: " + e.getMessage();
        }
    }

    private Path getStorageRoot() {
        String rootPath = storageProperties.getLocal().getRootPath();
        if (rootPath == null) rootPath = "data/wps-files";
        
        if (Paths.get(rootPath).isAbsolute()) {
            return Paths.get(rootPath);
        } else {
            String userDir = System.getProperty("user.dir");
            Path projectRoot = Paths.get(userDir);
            if (userDir.endsWith("backend")) {
                projectRoot = projectRoot.getParent();
            }
            return projectRoot.resolve(rootPath);
        }
    }
}
