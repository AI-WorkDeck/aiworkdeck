package com.checkba.service.ai.context;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;

@Service
public class FileContentExtractorService {

    private static final Logger log = LoggerFactory.getLogger(FileContentExtractorService.class);

    private static final long MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
    private static final Set<String> ALLOWED_TEXT_EXTENSIONS = new HashSet<>(Arrays.asList(
            "java", "kt", "scala", "groovy", // JVM
            "js", "jsx", "ts", "tsx", "vue", "svelte", // Frontend
            "html", "htm", "css", "scss", "less", // Web
            "xml", "yml", "yaml", "json", "properties", "toml", // Config
            "md", "txt", "csv", "sql", "sh", "bat", "dockerfile", ".gitignore", ".env" // Misc
    ));

    private final dev.langchain4j.data.document.parser.apache.tika.ApacheTikaDocumentParser tikaParser;

    public FileContentExtractorService() {
        this.tikaParser = new dev.langchain4j.data.document.parser.apache.tika.ApacheTikaDocumentParser();
    }

    /**
     * Extract text from a file.
     * Checks file size limit and file type validity.
     *
     * @param file The file to read.
     * @return Extracted text or an error message/empty string if skipped.
     */
    public String extractText(File file) {
        if (file == null || !file.exists() || file.isDirectory()) {
            return "";
        }

        if (file.length() > MAX_FILE_SIZE) {
            log.warn("File skipped due to size limit ({} > 10MB): {}", file.length(), file.getName());
            return "[System: File skipped - exceeds 10MB limit]";
        }

        String fileName = file.getName();
        try {
            if (isTextFile(fileName)) {
                return Files.readString(file.toPath());
            } else if (isSupportedBinary(fileName)) {
                return parseBinary(file);
            } else {
                // Unknown/Unsupported type, skip silently or return indicator
                return ""; // Skip
            }
        } catch (Exception e) {
            log.warn("Failed to extract text from file: {}", fileName, e);
            return "[System: Error reading file content]";
        }
    }

    public boolean isTextFile(String fileName) {
        if (!StringUtils.hasText(fileName)) return false;
        String ext = getExtension(fileName);
        return ALLOWED_TEXT_EXTENSIONS.contains(ext) || isConfigFile(fileName);
    }

    public boolean isSupportedBinary(String fileName) {
        if (!StringUtils.hasText(fileName)) return false;
        String ext = getExtension(fileName);
        return "pdf".equals(ext) || "doc".equals(ext) || "docx".equals(ext) ||
               "ppt".equals(ext) || "pptx".equals(ext) || "xls".equals(ext) || "xlsx".equals(ext);
    }

    private String parseBinary(File file) {
        try {
            dev.langchain4j.data.document.Document doc = tikaParser.parse(Files.newInputStream(file.toPath()));
            return doc.text();
        } catch (Exception e) {
            log.error("Tika extraction failed for: {}", file.getName(), e);
            return "[System: Binary file parsing failed]";
        }
    }

    private String getExtension(String fileName) {
        int dotIndex = fileName.lastIndexOf('.');
        if (dotIndex > 0 && dotIndex < fileName.length() - 1) {
            return fileName.substring(dotIndex + 1).toLowerCase();
        }
        return "";
    }
    
    // Some files like Dockerfile makefile don't have extensions or strict conventions
    private boolean isConfigFile(String fileName) {
        String lower = fileName.toLowerCase();
        return lower.equals("dockerfile") || lower.equals("makefile") || lower.equals("jenkinsfile");
    }
}
