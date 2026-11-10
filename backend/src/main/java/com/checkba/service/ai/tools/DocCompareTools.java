// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ai.tools;

import com.checkba.model.entity.ProjectFile;
import com.checkba.repository.ProjectFileRepository;
import com.checkba.service.LangText;
import com.checkba.service.revision.PendingRevisionService;
import com.checkba.service.ProjectFileService;
import com.checkba.service.ai.EditorBridgeService;
import com.checkba.service.ai.review.ParagraphDiff;
import com.checkba.service.ai.review.ParagraphDiff.Change;
import com.checkba.version.merge.DocxUnitReader;
import com.checkba.version.merge.Unit;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import dev.langchain4j.agent.tool.P;
import dev.langchain4j.agent.tool.Tool;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 两份 docx 比对（tool-system-v2 V7 D1，律师收到对方回稿后的第一件事）。两个工具，因为访问级别与宿主不同：
 *
 * <ul>
 *   <li>{@code compare_docx_summary}：只读、纯后端，任何会话（含 MCP）可用。段落级差异清单，
 *       可选附一组 {@code propose_revision} 同形的 edits；永不写文件。</li>
 *   <li>{@code compare_docx_redline}：写入、只在桌面编辑器（LOWA）里可用。让前端用 LibreOffice 原生
 *       「比较文档」（与工作台「比对稿」同一条链路）生成<b>新的</b>带修订痕迹的 docx，两份原件不动。</li>
 * </ul>
 *
 * <p>刻意不叫 {@code doc_compare_*}：{@code doc_} 前缀会被能力闸当成「要有活跃 Word 文档的 LOWA 工具」，
 * 而比对两份项目文件既不需要打开文档，摘要一支还应当在纯对话 / Office / MCP 会话里可用。
 */
@Component
@Slf4j
@RequiredArgsConstructor
public class DocCompareTools implements AgentToolComponent {

    /** 编辑器侧宿主动作名（前端 agentClientActions.handleCompareDocxFiles）。三处预算表同名登记。 */
    static final String HOST_ACTION = "compare_docx_files";

    /** 摘要里最多逐条列出的差异数、每段引文的字符上限。 */
    static final int MAX_LISTED = 60;
    static final int EXCERPT_CHARS = 160;

    private static final ObjectMapper JSON = new ObjectMapper();

    private final ProjectFileRepository projectFileRepository;
    private final ProjectFileService projectFileService;
    private final EditorBridgeService editorBridgeService;

    @org.springframework.beans.factory.annotation.Autowired(required = false)
    private com.checkba.service.ProjectMemberService projectMemberService;

    // ==================== 摘要（READ）====================

    @ToolMeta(displayName = "比对两份文档摘要", category = "document", access = ToolMeta.Access.READ)
    @Tool("逐段比对两份 .docx 文件，列出新增、删除、修改的段落及所在条款，只读不改文件。\n"
            + "何时用：收到对方回稿、想知道两个版本改了哪些条款；只差空白、换行的段落不算差异。\n"
            + "includeEdits=true 时附一组 propose_revision 同形的 edits（find/replace，按基准稿给出）。要带修订痕迹的比对稿用 compare_docx_redline。")
    public String compare_docx_summary(
            @P("基准稿（旧版本）的项目文件 ID，来自 doc_list_project_files") Long baseFileId,
            @P("修订稿（新版本）的项目文件 ID") Long revisedFileId,
            @P(value = "可选。true=另附 propose_revision 形状的 edits，默认 false", required = false) Boolean includeEdits
    ) {
        log.info("Tool: compare_docx_summary called base={}, revised={}", baseFileId, revisedFileId);
        try {
            ProjectFile base = resolveDocx(baseFileId, false);
            ProjectFile revised = resolveDocx(revisedFileId, false);
            List<String> a = paragraphs(base);
            List<String> b = paragraphs(revised);
            List<Change> changes;
            try {
                changes = ParagraphDiff.diff(a, b);
            } catch (IllegalArgumentException tooLarge) {
                return "Error: " + LangText.of(
                        "两份文档太长，无法在后端逐段比对。请用 compare_docx_redline 在编辑器里生成比对稿。",
                        "The documents are too long to diff paragraph by paragraph on the backend. Use compare_docx_redline to build a comparison document in the editor.");
            }
            return render(base, revised, a, changes, Boolean.TRUE.equals(includeEdits));
        } catch (IllegalArgumentException e) {
            return "Error: " + e.getMessage();
        } catch (Exception e) {
            log.warn("compare_docx_summary failed", e);
            return "Error: " + LangText.of("比对失败：", "Comparison failed: ") + e.getMessage();
        }
    }

    // ==================== 修订比对稿（WRITE，桌面编辑器）====================

    @ToolMeta(displayName = "生成修订比对稿", category = "document", fileEffect = "ADDED",
            requiresHost = ToolMeta.Host.LOWA, access = ToolMeta.Access.WRITE)
    @Tool("用编辑器原生比较生成一份带修订痕迹的新 .docx，两份原件不改。\n"
            + "何时用：用户要「比对稿」「带修订的对比文件」；只想知道改了什么用 compare_docx_summary。\n"
            + "耗时较长（大文档可达数分钟）。成功返回新文件 ID，可用 doc_open_file 打开；失败原样转告原因，不要重复调用。")
    public String compare_docx_redline(
            @P("基准稿（旧版本）的项目文件 ID") Long baseFileId,
            @P("修订稿（新版本）的项目文件 ID") Long revisedFileId
    ) {
        log.info("Tool: compare_docx_redline called base={}, revised={}", baseFileId, revisedFileId);
        try {
            ProjectFile base = resolveDocx(baseFileId, true);
            ProjectFile revised = resolveDocx(revisedFileId, true);
            Map<String, Object> params = new LinkedHashMap<>();
            params.put("baseFileId", base.getId());
            params.put("revisedFileId", revised.getId());
            String raw = editorBridgeService.executeEditorCommand(HOST_ACTION, params);
            if (EditorBridgeService.isEditorBootingOutput(raw)) {
                return raw;
            }
            JsonNode node = JSON.readTree(raw);
            if (node.has("error")) {
                return "Error: " + node.path("error").asText();
            }
            long newId = node.path("fileId").asLong(-1);
            ProjectFile created = newId > 0 ? projectFileRepository.findById(newId).orElse(null) : null;
            if (created == null) {
                return "Error: " + LangText.of("编辑器没有返回新文件。", "The editor did not return a new file.");
            }
            return GeneratedFileLocation.createdResult(created, LangText.of(
                    "已生成修订比对稿《" + created.getName() + "》（文件ID: " + created.getId() + "），两份原件未改动。可用 doc_open_file 打开查看。",
                    "Created comparison document \"" + created.getName() + "\" (fileId: " + created.getId()
                            + "); both originals are untouched. Open it with doc_open_file."));
        } catch (IllegalArgumentException e) {
            return "Error: " + e.getMessage();
        } catch (Exception e) {
            log.warn("compare_docx_redline failed", e);
            return "Error: " + e.getMessage();
        }
    }

    // ==================== 内部 ====================

    /** write=true：文件必须属于当前项目（结果文件落在这个项目）；否则允许有读权限的跨项目文件。 */
    private ProjectFile resolveDocx(Long fileId, boolean write) {
        if (fileId == null) {
            throw new IllegalArgumentException(LangText.of("需要 baseFileId 与 revisedFileId。", "baseFileId and revisedFileId are required."));
        }
        ProjectFile pf = projectFileRepository.findById(fileId)
                .orElseThrow(() -> new IllegalArgumentException("File not found in database: " + fileId));
        String denied = write ? ToolFileGuard.rejectIfOutsideProject(pf)
                : ToolFileGuard.rejectIfCannotRead(pf, projectMemberService);
        if (denied != null) {
            throw new IllegalArgumentException(denied.replaceFirst("^Error: ", ""));
        }
        String name = pf.getName() == null ? "" : pf.getName().toLowerCase();
        if (Boolean.TRUE.equals(pf.getIsFolder()) || !name.endsWith(".docx")) {
            throw new IllegalArgumentException(LangText.of(
                    "只能比对 .docx 文件（fileId=" + fileId + " 是「" + pf.getName() + "」）。",
                    "Only .docx files can be compared (fileId=" + fileId + " is \"" + pf.getName() + "\")."));
        }
        return pf;
    }

    private List<String> paragraphs(ProjectFile pf) throws java.io.IOException {
        byte[] bytes = projectFileService.getFileBytes(pf.getId());
        if (bytes == null || bytes.length == 0) {
            throw new IllegalArgumentException(LangText.of("读不到文件内容：", "Cannot read file content: ") + pf.getName());
        }
        List<String> out = new ArrayList<>();
        for (Unit u : DocxUnitReader.read(bytes)) {
            out.add(u.text());
        }
        return out;
    }

    private static String excerpt(String s) {
        String t = s == null ? "" : s.strip().replaceAll("\\s+", " ");
        return t.length() <= EXCERPT_CHARS ? t : t.substring(0, EXCERPT_CHARS) + "…";
    }

    private String render(ProjectFile base, ProjectFile revised, List<String> baseParagraphs,
                          List<Change> changes, boolean includeEdits) throws Exception {
        int changed = 0, added = 0, removed = 0;
        for (Change c : changes) {
            switch (c.kind()) {
                case CHANGED -> changed++;
                case ADDED -> added++;
                case REMOVED -> removed++;
            }
        }
        StringBuilder sb = new StringBuilder();
        sb.append(LangText.of("基准稿《", "Base \"")).append(base.getName()).append(LangText.of("》(fileId=", "\" (fileId="))
                .append(base.getId()).append(LangText.of(") 对 修订稿《", ") vs revised \"")).append(revised.getName())
                .append(LangText.of("》(fileId=", "\" (fileId=")).append(revised.getId()).append(")\n");
        if (changes.isEmpty()) {
            sb.append(LangText.of("未发现文字差异（仅空白、换行不同的段落不计）。", "No textual differences (whitespace-only differences are ignored)."));
            return sb.toString();
        }
        sb.append(LangText.of(
                "共 " + changes.size() + " 处差异：修改 " + changed + "、新增 " + added + "、删除 " + removed + "。\n",
                changes.size() + " differences: " + changed + " changed, " + added + " added, " + removed + " removed.\n"));
        int n = 0;
        for (Change c : changes) {
            if (++n > MAX_LISTED) {
                sb.append(LangText.of("……另有 " + (changes.size() - MAX_LISTED) + " 处未列出。\n",
                        "... " + (changes.size() - MAX_LISTED) + " more not listed.\n"));
                break;
            }
            String clause = c.clause().isEmpty() ? LangText.of("（条款之前）", "(before first clause)") : c.clause();
            String tag = switch (c.kind()) {
                case CHANGED -> LangText.of("修改", "Changed");
                case ADDED -> LangText.of("新增", "Added");
                case REMOVED -> LangText.of("删除", "Removed");
            };
            sb.append(n).append(". [").append(tag).append("] ").append(clause).append('\n');
            if (c.kind() != ParagraphDiff.Kind.ADDED) {
                sb.append(LangText.of("   原：", "   Was: ")).append(excerpt(c.baseText())).append('\n');
            }
            if (c.kind() != ParagraphDiff.Kind.REMOVED) {
                sb.append(LangText.of("   新：", "   Now: ")).append(excerpt(c.revisedText())).append('\n');
            }
        }
        if (includeEdits) {
            appendEdits(sb, base, baseParagraphs, changes);
        }
        return sb.toString();
    }

    /**
     * propose_revision 同形的 edits（按基准稿）：修改 = 原段换新段，删除 = 原段换空。
     * 新增段没有可替换的原文，不生成 edit；find 在基准稿里不唯一或超长的也跳过，一并计数。
     */
    private void appendEdits(StringBuilder sb, ProjectFile base, List<String> baseParagraphs, List<Change> changes) throws Exception {
        String whole = String.join("\n", baseParagraphs);
        List<Map<String, String>> edits = new ArrayList<>();
        int skipped = 0;
        for (Change c : changes) {
            if (c.kind() == ParagraphDiff.Kind.ADDED) {
                skipped++;
                continue;
            }
            String find = c.baseText().strip();
            String replace = c.kind() == ParagraphDiff.Kind.REMOVED ? "" : c.revisedText().strip();
            if (find.isEmpty() || find.length() > PendingRevisionService.MAX_FIND_CHARS
                    || replace.length() > PendingRevisionService.MAX_REPLACE_CHARS
                    || whole.indexOf(find) != whole.lastIndexOf(find)
                    || edits.size() >= PendingRevisionService.MAX_EDITS) {
                skipped++;
                continue;
            }
            Map<String, String> e = new LinkedHashMap<>();
            e.put("find", find);
            e.put("replace", replace);
            e.put("reason", LangText.of("按修订稿" + (c.clause().isEmpty() ? "" : c.clause()) + "调整",
                    "Align with the revised draft" + (c.clause().isEmpty() ? "" : " (" + c.clause() + ")")));
            edits.add(e);
        }
        sb.append(LangText.of("\n【propose_revision 同形 edits】基准稿 fileId=", "\n[propose_revision-shaped edits] base fileId="))
                .append(base.getId()).append(LangText.of("；新增段落不生成 edit，需手工定位。已跳过 ", "; added paragraphs get no edit and need manual placement. Skipped "))
                .append(skipped).append(LangText.of(" 处。\n", ".\n"))
                .append(JSON.writerWithDefaultPrettyPrinter().writeValueAsString(edits)).append('\n');
    }
}
