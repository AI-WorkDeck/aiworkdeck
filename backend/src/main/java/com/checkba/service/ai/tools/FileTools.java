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

    @Tool("List files in a project directory. Useful for exploring file structure before renaming or organizing.")
    public String listFiles(
            @P("The ID of the project") String projectId,
            @P("The relative directory path (use '.' for root)") String dirPath) {
        try {
            Path root = getProjectRoot(projectId);
            Path targetDir = root.resolve(dirPath.equals(".") ? "" : dirPath).normalize();
            
            if (!targetDir.startsWith(root)) {
                return "Error: Access denied (path traversal).";
            }
            
            if (!Files.exists(targetDir)) {
                return "Error: Directory not found: " + dirPath;
            }
            
            StringBuilder sb = new StringBuilder();
            try (var stream = Files.list(targetDir)) {
                stream.limit(50).forEach(path -> {
                    String name = path.getFileName().toString();
                    String type = Files.isDirectory(path) ? "[DIR]" : "[FILE]";
                    sb.append(type).append(" ").append(name).append("\n");
                });
            }
            return sb.toString();
        } catch (IOException e) {
            return "Error listing files: " + e.getMessage();
        }
    }

    @Tool("Rename a file or move it within the project.")
    public String renameFile(
            @P("The ID of the project") String projectId,
            @P("The original file path (relative to project root)") String oldPath,
            @P("The new file name (or relative path)") String newName) {
        try {
            Path root = getProjectRoot(projectId);
            Path source = root.resolve(oldPath).normalize();
            
            // If newName is just a name, resolve it against source parent
            Path target;
            if (newName.contains("/") || newName.contains("\\")) {
                 target = root.resolve(newName).normalize();
            } else {
                 target = source.getParent().resolve(newName).normalize();
            }

            if (!source.startsWith(root) || !target.startsWith(root)) {
                return "Error: Access denied (path traversal).";
            }
            
            if (!Files.exists(source)) {
                return "Error: Source file not found: " + oldPath;
            }
            
            Files.move(source, target);
            log.info("AI renamed file: {} -> {}", source, target);
            return "Success: Renamed to " + root.relativize(target);
        } catch (IOException e) {
            return "Error renaming file: " + e.getMessage();
        }
    }

    private Path getProjectRoot(String projectId) {
         // Assuming projects are stored in storageRoot/projects/{projectId}/edit 
         // But legacy files might be in storageRoot/projects/{projectId}/files or similar.
         // Based on saveFile method: storageRoot.resolve("projects").resolve(projectId).resolve("edit");
         // Let's assume we want to operate on the "edit" folder for now as it seems to be the workspace.
         // Or check if user meant the entire project structure. 
         // Given "Rename Assistant", user might probably want to rename uploaded files.
         // Uploaded files location needs to be verified. 
         // OssStorageService usually handles uploads. 
         // Assuming a unified local storage for this demo:
         return getStorageRoot().resolve("projects").resolve(projectId);
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
