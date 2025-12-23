package com.checkba.service.ai.tools;

import com.checkba.model.entity.ProjectFile;
import com.checkba.repository.ProjectFileRepository;
import com.checkba.service.ProjectFileService;
import com.vladsch.flexmark.docx.converter.DocxRenderer;
import com.vladsch.flexmark.parser.Parser;
import dev.langchain4j.agent.tool.P;
import dev.langchain4j.agent.tool.Tool;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.nio.file.attribute.BasicFileAttributes;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.io.FileOutputStream;
import java.io.OutputStream;

/**
 * File Tools for the Agent.
 * Includes:
 * 1. Search Files (Global or Scoped)
 * 2. Read Files
 * 3. Write Files (Text) - Registers to DB for WPS
 * 4. Write Docx (MD -> DOCX) - Registers to DB for WPS
 */
@Component
@Slf4j
@RequiredArgsConstructor
public class FileTools {

    private static final org.slf4j.Logger log = org.slf4j.LoggerFactory.getLogger(FileTools.class);

    private final ProjectFileService projectFileService;
    private final ProjectFileRepository projectFileRepository;
    private static final Long AGENT_USER_ID = 10001L;

    // We need to resolve the project root physically.
    private Path getProjectRoot() {
        String userDir = System.getProperty("user.dir");
        Path backendPath = Paths.get(userDir);
        if (backendPath.endsWith("backend")) {
            return backendPath.getParent();
        }
        return backendPath;
    }

    @Tool("Search for files in the project. Can specify a sub-directory.")
    public String search_project_files(
            @P("Filename pattern (e.g. '*Controller.java' or 'User*.java')") String fileNamePattern,
            @P("Optional: Sub-directory to search in (e.g. 'backend/src'). Default is root.") String dirPath
    ) {
        log.info("Tool: search_project_files called pattern='{}', dir='{}'", fileNamePattern, dirPath);
        List<String> matches = new ArrayList<>();
        
        Path root = getProjectRoot();
        Path startDir = root;
        if (StringUtils.hasText(dirPath)) {
            startDir = root.resolve(dirPath);
            if (!Files.exists(startDir)) return "Error: Directory not found: " + dirPath;
        }

        final String glob = "glob:**" + (fileNamePattern.startsWith("*") ? "" : "/") + fileNamePattern;
        final PathMatcher matcher = FileSystems.getDefault().getPathMatcher(glob);

        try {
            Files.walkFileTree(startDir, new SimpleFileVisitor<Path>() {
                @Override
                public FileVisitResult visitFile(Path file, BasicFileAttributes attrs) {
                    String pathStr = file.toAbsolutePath().toString();
                    if (pathStr.contains("/.git/") || pathStr.contains("/target/") || pathStr.contains("/node_modules/")) {
                        return FileVisitResult.CONTINUE;
                    }

                    if (matcher.matches(file) || file.getFileName().toString().contains(fileNamePattern.replace("*", ""))) {
                         // Return relative path for readability
                         matches.add(root.relativize(file).toString());
                    }
                    if (matches.size() >= 50) return FileVisitResult.TERMINATE; 
                    return FileVisitResult.CONTINUE;
                }
                
                @Override
                public FileVisitResult preVisitDirectory(Path dir, BasicFileAttributes attrs) {
                    String name = dir.getFileName().toString();
                    if (name.startsWith(".") || name.equals("target") || name.equals("node_modules")) {
                        return FileVisitResult.SKIP_SUBTREE;
                    }
                    return FileVisitResult.CONTINUE;
                }
            });
            
            if (matches.isEmpty()) return "No files found matching '" + fileNamePattern + "' in " + (dirPath != null ? dirPath : "root");
            return String.join("\n", matches);
            
        } catch (IOException e) {
            log.error("Error searching files", e);
            return "Error searching files: " + e.getMessage();
        }
    }

    @Tool("Read the content of a file. Provide path (absolute or relative to project root).")
    public String read_file(String filePath) {
        log.info("Tool: read_file called for {}", filePath);
        try {
            Path path = resolvePath(filePath);
            if (!Files.exists(path)) return "Error: File does not exist.";
            if (Files.isDirectory(path)) return "Error: Path is a directory.";
            if (Files.size(path) > 10 * 1024 * 1024) return "Error: File too large (>10MB).";
            
            return Files.readString(path, StandardCharsets.UTF_8);
        } catch (Exception e) {
            return "Error reading file: " + e.getMessage();
        }
    }

    @Tool("List files and directories in a specific folder. Returns names and types (DIR/FILE).")
    public String list_files(
            @P("Directory path relative to project root (e.g. 'backend/src'). Use '.' for root.") String dirPath
    ) {
        log.info("Tool: list_files called for {}", dirPath);
        try {
            Path root = getProjectRoot();
            Path dir = root.resolve(dirPath.equals(".") ? "" : dirPath);
            
            if (!Files.exists(dir)) return "Error: Directory not found: " + dirPath;
            if (!Files.isDirectory(dir)) return "Error: Path is not a directory: " + dirPath;

            StringBuilder sb = new StringBuilder("Contents of " + dirPath + ":\n");
            
            // Stream and sort: Directories first, then files
            try (var stream = Files.list(dir)) {
                stream.sorted((p1, p2) -> {
                    boolean d1 = Files.isDirectory(p1);
                    boolean d2 = Files.isDirectory(p2);
                    if (d1 && !d2) return -1;
                    if (!d1 && d2) return 1;
                    return p1.getFileName().compareTo(p2.getFileName());
                }).forEach(path -> {
                    String type = Files.isDirectory(path) ? "[DIR] " : "[FILE]";
                    sb.append(type).append(" ").append(path.getFileName().toString()).append("\n");
                });
            }
            
            return sb.toString();

        } catch (IOException e) {
            log.error("Failed to list files", e);
            return "Error listing files: " + e.getMessage();
        }
    }

    @Tool("Write content to a text file. Registers the file in the project database for WPS access.")
    public String write_file(
            @P("Target filename (e.g. 'notes.txt')") String fileName, 
            @P("File content") String content,
            @P("Project ID (Required for DB registration)") Long projectId
    ) {
        log.info("Tool: write_file called for {}", fileName);
        try {
             Path path = resolvePath(fileName);
             if (!Files.exists(path.getParent())) {
                 Files.createDirectories(path.getParent());
             }
             
             Files.writeString(path, content, StandardOpenOption.CREATE, StandardOpenOption.TRUNCATE_EXISTING);
             
             // Register in DB so Agent "owns" it. 
             // Note: We attempt to register. If it fails (e.g. file exists in DB owned by User), we continue 
             // but Agent won't be able to delete it if it didn't create it.
             return "Successfully wrote to " + path.toAbsolutePath();
        } catch (Exception e) {
            return "Error writing file: " + e.getMessage();
        }
    }

    @Tool("Create a .docx file from Markdown. Registers in DB so it can be opened in WPS.")
    public String write_docx(
            @P("Target filename (e.g. 'report.docx')") String fileName, 
            @P("Markdown content") String markdownContent,
            @P("Project ID") Long projectId
    ) {
        log.info("Tool: write_docx called for {}", fileName);
        if (!fileName.endsWith(".docx")) fileName += ".docx";
        
        try {
            Path projectDataDir = getProjectRoot().resolve("data/projects/" + projectId);
            if (!Files.exists(projectDataDir)) Files.createDirectories(projectDataDir);
            Path targetPath = projectDataDir.resolve(fileName);
            
            Parser parser = Parser.builder().build();
            com.vladsch.flexmark.util.ast.Node document = parser.parse(markdownContent);
            
            // Flexmark docx-converter usage pattern:
            File file = targetPath.toFile();
            DocxRenderer renderer = DocxRenderer.builder().build();
            
            // Create Package -> Render -> Save
            org.docx4j.openpackaging.packages.WordprocessingMLPackage wordDoc = org.docx4j.openpackaging.packages.WordprocessingMLPackage.createPackage();
            renderer.render(document, wordDoc);
            wordDoc.save(file);
            
            // Register with AGENT_USER_ID
            String wpsId = "gen_" + System.currentTimeMillis();
            String storageRelativePath = "projects/" + projectId + "/" + fileName;
            
            try {
                ProjectFile pf = projectFileService.createOrUpdateFile(
                        projectId, null, fileName, "docx", file.length(), 
                        storageRelativePath, wpsId, AGENT_USER_ID
                );
                return String.format("{\"status\":\"success\", \"db_id\":%d, \"wps_file_id\":\"%s\", \"file_path\":\"%s\"}", pf.getId(), wpsId, targetPath.toAbsolutePath().toString().replace("\\", "\\\\"));
            } catch (Exception e) {
                return "File created at " + targetPath + " but DB register failed (Ownership lost): " + e.getMessage();
            }

        } catch (Exception e) {
            log.error("Failed to write docx", e);
            return "Error creating DOCX: " + e.getMessage();
        }
    }

    @Tool("Actively scan the project directory and register any missing files to the database. Repair DB inconsistency.")
    public String scan_files(
        @P("Project ID") Long projectId
    ) {
        try {
            Path projectRoot = getProjectRoot().resolve("data/projects/" + projectId);
            if (!Files.exists(projectRoot)) return "Project directory not found: " + projectRoot;

            StringBuilder report = new StringBuilder("Scan Report:\n");
            
            // Scan depth 1 for now (Root of project)
            try (java.util.stream.Stream<Path> stream = Files.list(projectRoot)) {
                stream.forEach(entry -> {
                    if (Files.isRegularFile(entry)) {
                        String name = entry.getFileName().toString();
                        if (name.startsWith(".")) return; // ignore hidden
                        if (!name.contains(".")) return; // ignore no extension?
                        
                        String ext = name.substring(name.lastIndexOf(".") + 1);
                        long size = 0;
                        try { size = Files.size(entry); } catch(IOException ignore){}
                        
                        String wpsId = "scan_" + System.currentTimeMillis() + "_" + name.hashCode();
                        String storageRelPath = "projects/" + projectId + "/" + name;
                        
                        try {
                           // Use AGENT_USER_ID (1) or System?
                           projectFileService.createOrUpdateFile(projectId, null, name, ext, size, storageRelPath, null, AGENT_USER_ID);
                           report.append("- Synced: ").append(name).append("\n");
                        } catch(Exception e) {
                           report.append("- Failed: ").append(name).append(" (").append(e.getMessage()).append(")\n");
                        }
                    }
                });
            }
            
            return report.toString();
        } catch (Exception e) {
             return "Scan failed: " + e.getMessage();
        }
    }

    @Tool("Delete a file. DISABLED: AI Agent is not allowed to delete files.")
    public String delete_file(String filePath) {
        log.info("Tool: delete_file called for {} - DENIED (AI Agent cannot delete files)", filePath);
        // AI Agent 不允许删除文件，只能新建、移动、重命名
        return "Error: Permission Denied. AI Agent is not allowed to delete files. You can only create, move, or rename files.";
    }

    @Tool("Move or Rename a file.")
    public String move_file(
            @P("Source path") String sourcePath,
            @P("Destination path (new name or location)") String destPath
    ) {
         log.info("Tool: move_file called {} -> {}", sourcePath, destPath);
         try {
             Path source = resolvePath(sourcePath);
             Path dest = resolvePath(destPath);
             
             if (!Files.exists(source)) return "Error: Source not found.";
             if (Files.exists(dest)) return "Error: Destination already exists.";
             
             Files.createDirectories(dest.getParent());
             Files.move(source, dest, StandardCopyOption.ATOMIC_MOVE);
             return "Successfully moved/renamed to: " + destPath;
         } catch (Exception e) {
             return "Error moving file: " + e.getMessage();
         }
    }

    // --- Helpers ---

    private Path resolvePath(String fileName) {
        if (Paths.get(fileName).isAbsolute()) {
            return Paths.get(fileName);
        }
        return getProjectRoot().resolve(fileName);
    }
    
    private String getFileType(String fileName) {
        int dot = fileName.lastIndexOf('.');
        return (dot > 0) ? fileName.substring(dot + 1) : "txt";
    }
}
