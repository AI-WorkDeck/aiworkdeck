package com.checkba.model.dto;

import lombok.Data;
import java.util.List;

/**
 * 全文搜索请求
 */
@Data
public class SearchRequest {
    private String query;
    private boolean caseSensitive = false;
    private boolean wholeWord = false;
    private boolean useRegex = false;
    private List<String> includePatterns;
    private List<String> excludePatterns;
    private List<String> fileTypes; // e.g., ["docx", "pdf", "pptx", "xlsx"]
    private List<Long> tagIds;
}
