// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.mcpserver;

import com.checkba.model.dto.SearchRequest;
import com.checkba.model.dto.SearchResult;
import com.checkba.model.entity.Project;
import com.checkba.model.entity.ProjectFile;
import com.checkba.repository.ProjectFileRepository;
import com.checkba.service.ContentSearchService;
import com.checkba.service.LangText;
import com.checkba.service.ProjectMemberService;
import com.checkba.service.ProjectService;
import com.checkba.service.ai.tools.ToolMeta;
import com.checkba.service.file.ProjectFileTextExtractor;
import com.checkba.service.revision.PendingRevisionService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 本机 MCP 服务器第一期的只读工具：列项目、列文件、读文件、检索（docs/plans/stella-alignment/mcp-server.md）。
 *
 * <p>只读边界：只调查询类服务，不经 ToolRegistry、不发 SSE、不改库。读文件走
 * {@link ProjectFileTextExtractor#extract}——不走 OCR，因此不产生云端请求与扣费；
 * 每次调用都按项目读权限再核一遍。
 */
@Service
@Slf4j
@RequiredArgsConstructor
public class LocalMcpServerTools {

    static final int MAX_FILES = 500;
    static final int MAX_HITS = 50;
    static final int DEFAULT_READ_CHARS = 20_000;
    static final int MAX_READ_CHARS = 80_000;

    /** 一个 MCP 工具的元数据。coversAgentTools 是它在 agent 工具里对应的能力，供能力目录标注。 */
    public record Definition(String name, String description, Map<String, Object> inputSchema,
                             ToolMeta.Access access, String scope, List<String> coversAgentTools) {}

    /** 工具执行失败：message 原样回给 MCP 客户端（isError=true）。 */
    public static class ToolError extends RuntimeException {
        public ToolError(String message) { super(message); }
    }

    public static final List<Definition> DEFINITIONS = List.of(
            new Definition("list_projects",
                    "List the AI WorkDeck projects (matters) the local user can read. Returns id, name and type.",
                    schema(Map.of(), List.of()),
                    ToolMeta.Access.READ, "awd:project.read", List.of()),
            new Definition("list_project_files",
                    "List the files of one project (not deleted, folders excluded) with fileId, name, path, type "
                            + "and size. Use the fileId with read_file.",
                    schema(Map.of("projectId", prop("integer", "Project id from list_projects")),
                            List.of("projectId")),
                    ToolMeta.Access.READ, "awd:project.read", List.of("list_files", "search_project_files")),
            new Definition("read_file",
                    "Read the plain text of one project file by fileId (Word/Excel/PowerPoint, text-layer PDF, "
                            + "plain text). No OCR: scanned files that were never read in AI WorkDeck return no text. "
                            + "Long files are paged: pass nextOffset back as offset to continue.",
                    schema(Map.of(
                            "fileId", prop("integer", "File id from list_project_files or search_project"),
                            "offset", prop("integer", "Character offset to start from (default 0)"),
                            "maxChars", prop("integer", "Max characters to return (default "
                                    + DEFAULT_READ_CHARS + ", max " + MAX_READ_CHARS + ")")),
                            List.of("fileId")),
                    ToolMeta.Access.READ, "awd:project.read", List.of("extract_file_text", "read_file")),
            new Definition("search_project",
                    "Full-text search across the files of one project. Returns up to " + MAX_HITS
                            + " matching lines with fileId, file name and snippet.",
                    schema(Map.of(
                            "projectId", prop("integer", "Project id from list_projects"),
                            "query", prop("string", "Text to look for (literal, case-insensitive)")),
                            List.of("projectId", "query")),
                    ToolMeta.Access.READ, "awd:project.read", List.of("search_project_content")),
            new Definition("propose_revision",
                    "Propose edits to a Word document (.docx/.doc). Nothing is written to the file: the proposal "
                            + "is queued and the lawyer reviews it in AI WorkDeck; on acceptance it lands as tracked "
                            + "changes (redlines). Pass the `version` returned by read_file as baseVersion; if the "
                            + "file changed since, the proposal is marked stale and not applied. Each edit replaces "
                            + "the first occurrence of `find` (copy it verbatim from read_file, make it unique); "
                            + "`replace` may be empty to delete. Max " + PendingRevisionService.MAX_EDITS + " edits.",
                    proposeSchema(),
                    ToolMeta.Access.WRITE, "awd:project.propose", List.of()));

    private final ProjectService projectService;
    private final ProjectMemberService projectMemberService;
    private final ProjectFileRepository projectFileRepository;
    private final ProjectFileTextExtractor textExtractor;
    private final ContentSearchService contentSearchService;
    private final PendingRevisionService pendingRevisionService;

    /** 执行一个工具，返回可 JSON 序列化的结果；参数或权限问题抛 {@link ToolError}。 */
    public Object call(String name, Map<String, Object> args, Long userId) {
        return call(name, args, userId, null);
    }

    /** clientName 来自 MCP 请求头，只用于标注待审修订的来源（mcp:&lt;clientName&gt;）。 */
    public Object call(String name, Map<String, Object> args, Long userId, String clientName) {
        Map<String, Object> a = args == null ? Map.of() : args;
        return switch (name == null ? "" : name) {
            case "list_projects" -> listProjects(userId);
            case "list_project_files" -> listProjectFiles(readableProject(a, userId));
            case "read_file" -> readFile(a, userId);
            case "propose_revision" -> proposeRevision(a, userId, clientName);
            case "search_project" -> search(readableProject(a, userId), a, userId);
            default -> throw new ToolError(LangText.of("未知工具：", "Unknown tool: ") + name);
        };
    }

    private List<Map<String, Object>> listProjects(Long userId) {
        List<Map<String, Object>> out = new ArrayList<>();
        for (Project p : projectService.getUserProjects(userId)) {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("projectId", p.getId());
            row.put("name", p.getName());
            row.put("type", p.getProjectType());
            out.add(row);
        }
        return out;
    }

    private Map<String, Object> listProjectFiles(Long projectId) {
        List<Map<String, Object>> files = new ArrayList<>();
        int total = 0;
        for (ProjectFile f : projectFileRepository.findByProjectIdAndIsDeletedFalseOrderBySortOrderAsc(projectId)) {
            if (Boolean.TRUE.equals(f.getIsFolder())) continue;
            total++;
            if (files.size() >= MAX_FILES) continue;
            files.add(fileRow(f));
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("projectId", projectId);
        out.put("total", total);
        out.put("truncated", total > files.size());
        out.put("files", files);
        return out;
    }

    private Map<String, Object> readFile(Map<String, Object> a, Long userId) {
        Long fileId = longArg(a, "fileId", true);
        ProjectFile pf = projectFileRepository.findById(fileId)
                .filter(f -> !Boolean.TRUE.equals(f.getIsDeleted()))
                .orElseThrow(() -> new ToolError(LangText.of("文件不存在：", "File not found: ") + fileId));
        if (pf.getProjectId() == null || !projectMemberService.hasReadPermission(pf.getProjectId(), userId)) {
            // 与「不存在」同一句：不向调用方透露别的项目里有哪些 id
            throw new ToolError(LangText.of("文件不存在：", "File not found: ") + fileId);
        }
        String text;
        try {
            text = textExtractor.extract(pf);
        } catch (Exception e) {
            throw new ToolError(LangText.of("读取失败：", "Read failed: ") + e.getMessage());
        }
        String body = text == null ? "" : text;
        Long offsetArg = longArg(a, "offset", false);
        Long maxArg = longArg(a, "maxChars", false);
        int start = offsetArg == null ? 0 : (int) Math.max(0, Math.min(offsetArg, body.length()));
        int limit = maxArg == null || maxArg <= 0 ? DEFAULT_READ_CHARS : (int) Math.min(maxArg, MAX_READ_CHARS);
        int end = Math.min(body.length(), start + limit);
        if (end < body.length() && end > start + 1 && Character.isHighSurrogate(body.charAt(end - 1))) end--;
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("fileId", pf.getId());
        out.put("projectId", pf.getProjectId());
        out.put("name", pf.getName());
        out.put("version", PendingRevisionService.fileVersion(pf));
        out.put("totalChars", body.length());
        out.put("offset", start);
        out.put("nextOffset", end < body.length() ? end : null);
        out.put("text", body.substring(start, end));
        return out;
    }

    private Map<String, Object> search(Long projectId, Map<String, Object> a, Long userId) {
        Object q = a.get("query");
        if (!(q instanceof String query) || query.isBlank()) {
            throw new ToolError(LangText.of("缺少参数 query", "Missing argument: query"));
        }
        SearchRequest request = new SearchRequest();
        request.setQuery(query.trim());
        SearchResult result = contentSearchService.searchContent(projectId, request, userId);
        List<Map<String, Object>> hits = new ArrayList<>();
        List<SearchResult.FileSearchResult> files =
                result == null || result.getResults() == null ? List.of() : result.getResults();
        for (SearchResult.FileSearchResult f : files) {
            List<SearchResult.MatchInfo> matches = f.getMatches() == null ? List.of() : f.getMatches();
            if (matches.isEmpty()) {
                if (hits.size() < MAX_HITS) hits.add(hit(f, null, null));
                continue;
            }
            for (SearchResult.MatchInfo m : matches) {
                if (hits.size() >= MAX_HITS) break;
                hits.add(hit(f, m.getLineNumber(), m.getContent()));
            }
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("projectId", projectId);
        out.put("query", query.trim());
        out.put("totalMatches", result == null ? 0 : result.getTotalMatches());
        out.put("hits", hits);
        return out;
    }

    private Map<String, Object> proposeRevision(Map<String, Object> a, Long userId, String clientName) {
        Long fileId = longArg(a, "fileId", true);
        Object bv = a.get("baseVersion");
        if (!(bv instanceof String baseVersion) || baseVersion.isBlank()) {
            throw new ToolError(LangText.of("缺少参数 baseVersion", "Missing argument: baseVersion"));
        }
        if (!(a.get("edits") instanceof List<?> raw)) {
            throw new ToolError(LangText.of("缺少参数 edits（数组）", "Missing argument: edits (array)"));
        }
        List<PendingRevisionService.Edit> edits = new ArrayList<>();
        for (Object o : raw) {
            if (!(o instanceof Map<?, ?> m) || !(m.get("find") instanceof String find)
                    || !(m.get("replace") instanceof String replace)) {
                throw new ToolError(LangText.of("每条 edit 需要字符串 find 和 replace",
                        "Each edit needs string find and replace"));
            }
            Object reason = m.get("reason");
            edits.add(new PendingRevisionService.Edit(find, replace, reason instanceof String s ? s : null));
        }
        String source = "mcp:" + sanitizeClient(clientName);
        try {
            var r = pendingRevisionService.propose(userId, fileId, baseVersion, edits, source);
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("proposalId", r.getId());
            out.put("status", r.getStatus());
            out.put("edits", edits.size());
            out.put("note", LangText.of("已提交待审，未修改文件；等待用户在 AI WorkDeck 中审阅。",
                    "Queued for review; the file was not changed. The user reviews it in AI WorkDeck."));
            return out;
        } catch (PendingRevisionService.RevisionException e) {
            throw new ToolError(e.getMessage());
        }
    }

    static String sanitizeClient(String name) {
        String n = name == null ? "" : name.replaceAll("[^A-Za-z0-9._ -]", "").trim();
        if (n.length() > 40) n = n.substring(0, 40);
        return n.isEmpty() ? "client" : n;
    }

    private static Map<String, Object> proposeSchema() {
        Map<String, Object> edit = new LinkedHashMap<>();
        edit.put("type", "object");
        edit.put("properties", new java.util.TreeMap<>(Map.of(
                "find", prop("string", "Exact text to find (non-empty, max " + PendingRevisionService.MAX_FIND_CHARS + " chars)"),
                "replace", prop("string", "Replacement text (empty to delete, max " + PendingRevisionService.MAX_REPLACE_CHARS + " chars)"),
                "reason", prop("string", "Why (shown to the reviewer, max " + PendingRevisionService.MAX_REASON_CHARS + " chars)"))));
        edit.put("required", List.of("find", "replace"));
        Map<String, Object> edits = new LinkedHashMap<>();
        edits.put("type", "array");
        edits.put("description", "Edits in order (max " + PendingRevisionService.MAX_EDITS + ")");
        edits.put("minItems", 1);
        edits.put("maxItems", PendingRevisionService.MAX_EDITS);
        edits.put("items", edit);
        return schema(Map.of(
                "fileId", prop("integer", "File id from list_project_files"),
                "baseVersion", prop("string", "The `version` returned by read_file for this file"),
                "edits", edits), List.of("fileId", "baseVersion", "edits"));
    }

    private Long readableProject(Map<String, Object> a, Long userId) {
        Long projectId = longArg(a, "projectId", true);
        if (!projectMemberService.hasReadPermission(projectId, userId)) {
            throw new ToolError(LangText.of("项目不存在：", "Project not found: ") + projectId);
        }
        return projectId;
    }

    private static Map<String, Object> fileRow(ProjectFile f) {
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("fileId", f.getId());
        row.put("name", f.getName());
        row.put("path", f.getFilePath());
        row.put("type", f.getFileType());
        row.put("size", f.getFileSize());
        return row;
    }

    private static Map<String, Object> hit(SearchResult.FileSearchResult f, Integer line, String snippet) {
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("fileId", f.getFileId());
        row.put("name", f.getFileName());
        row.put("line", line);
        row.put("snippet", snippet);
        return row;
    }

    static Long longArg(Map<String, Object> a, String key, boolean required) {
        Object v = a.get(key);
        if (v == null) {
            if (required) throw new ToolError(LangText.of("缺少参数 ", "Missing argument: ") + key);
            return null;
        }
        if (v instanceof Number n && n.doubleValue() == Math.rint(n.doubleValue())) return n.longValue();
        if (v instanceof String s && s.trim().matches("-?\\d{1,18}")) return Long.parseLong(s.trim());
        throw new ToolError(LangText.of("参数必须是整数：", "Argument must be an integer: ") + key);
    }

    private static Map<String, Object> schema(Map<String, Object> properties, List<String> required) {
        Map<String, Object> s = new LinkedHashMap<>();
        s.put("type", "object");
        s.put("properties", new java.util.TreeMap<>(properties));
        s.put("required", required);
        s.put("additionalProperties", false);
        return s;
    }

    private static Map<String, Object> prop(String type, String description) {
        return Map.of("type", type, "description", description);
    }
}
