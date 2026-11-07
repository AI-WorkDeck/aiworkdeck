// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ai.capability;

import com.checkba.service.ai.tools.ToolMeta;
import com.checkba.service.mcpserver.LocalMcpServerTools;
import dev.langchain4j.agent.tool.Tool;

import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;

/**
 * 能力目录：给每个 agent 工具标出「读 / 写 / 破坏性」与权限范围，并渲染成
 * {@code docs/capability-catalog.md}（对齐 Stella 的 capability-coverage，见
 * docs/plans/stella-alignment/mcp-server.md）。
 *
 * <p>纯函数、无 Spring 依赖：输入是工具组件类，输出是条目列表与 Markdown。
 * 生成与漂移校验由 {@code CapabilityCatalogDocTest} 负责。
 *
 * <p>访问级别优先取 {@code @ToolMeta(access=...)} 显式声明，否则按工具名动词推断；
 * 拿不准的一律算写入（多算只是多一次确认，漏算会把写操作当成只读放出去）。
 */
public final class CapabilityCatalog {

    private CapabilityCatalog() {}

    /** 一条能力。id 即工具名；mcpTool 是覆盖它的 MCP 服务器工具名（没有为 null）。 */
    public record Capability(String id, String category, ToolMeta.Access access, String scope,
                             String host, boolean offeredToModel, String mcpTool) {}

    /** 出现即破坏性：删除、移入回收站、回滚覆盖、不可逆涂黑。 */
    static final Set<String> DESTRUCTIVE_VERBS = Set.of("delete", "remove", "trash", "restore", "redact");

    /** 出现即写入（优先于只读动词：doc_find_replace 里有 find，但它是写入）。 */
    static final Set<String> WRITE_VERBS = Set.of(
            "accept", "add", "annotate", "apply", "commit", "copy", "create", "define", "dispatch", "edit",
            "export", "freeze", "generate", "group", "highlight", "import", "insert", "install",
            "link", "manage", "merge", "modify", "move", "open", "protect", "pull", "redo", "refine", "reject",
            "rename", "render", "replace", "reply", "resolve", "rotate", "run", "save", "scaffold", "scan",
            "select", "set", "sort", "split", "start", "step", "stream", "undo", "update", "use", "write");

    /** 没有写入动词时，出现即只读。 */
    static final Set<String> READ_VERBS = Set.of(
            "ask", "audit", "browse", "changes", "check", "context", "count", "debug", "extract", "find", "get",
            "goto", "history", "inspect", "list", "query", "read", "recognition", "retrieve", "search",
            "status", "summary", "verify");

    /** 按工具名推断访问级别。 */
    public static ToolMeta.Access inferAccess(String toolName) {
        List<String> words = List.of(toolName.toLowerCase(Locale.ROOT).split("_"));
        if (words.stream().anyMatch(DESTRUCTIVE_VERBS::contains)) return ToolMeta.Access.DESTRUCTIVE;
        if (words.stream().anyMatch(WRITE_VERBS::contains)) return ToolMeta.Access.WRITE;
        if (words.stream().anyMatch(READ_VERBS::contains)) return ToolMeta.Access.READ;
        return ToolMeta.Access.WRITE;
    }

    /** 声明式插件工具（manifest tools[].access）：以声明为准，不推断；未声明或无法识别时才退回按名推断。 */
    public static ToolMeta.Access accessOfDeclared(String toolName, String declared) {
        if (declared != null) {
            switch (declared.toLowerCase(Locale.ROOT)) {
                case "read": return ToolMeta.Access.READ;
                case "write": return ToolMeta.Access.WRITE;
                case "destructive": return ToolMeta.Access.DESTRUCTIVE;
                default: break;
            }
        }
        return inferAccess(toolName);
    }

    /** 显式声明优先；声明了文件副作用的工具至少是写入。 */
    public static ToolMeta.Access accessOf(String toolName, ToolMeta meta) {
        if (meta != null && meta.access() != ToolMeta.Access.INFERRED) return meta.access();
        ToolMeta.Access inferred = inferAccess(toolName);
        if (inferred == ToolMeta.Access.READ && meta != null && !meta.fileEffect().isEmpty()) {
            return ToolMeta.Access.WRITE;
        }
        return inferred;
    }

    /**
     * 权限范围 {@code awd:<领域>.<read|write>}。领域：editor（桌面编辑器内的文档）、office-addin
     * （Office/WPS 任务窗格）、memory（用户记忆）、external（向外部服务发请求）、system（执行代码、
     * 子 agent、插件与 skill 安装）、project（项目文件与项目数据，默认）。
     */
    public static String scopeOf(String toolName, ToolMeta meta, ToolMeta.Access access) {
        return "awd:" + areaOf(toolName, meta) + (access == ToolMeta.Access.READ ? ".read" : ".write");
    }

    static String areaOf(String name, ToolMeta meta) {
        String category = meta == null ? "" : meta.category();
        ToolMeta.Host host = meta == null ? ToolMeta.Host.NONE : meta.requiresHost();
        if (name.startsWith("office_") || name.startsWith("ref_") || host == ToolMeta.Host.OFFICE) return "office-addin";
        if (name.startsWith("doc_") || name.startsWith("sheet_") || name.startsWith("slide_")
                || host == ToolMeta.Host.LOWA) return "editor";
        if (name.startsWith("memory_") || name.endsWith("_memory") || "memory".equals(category)) return "memory";
        if (Set.of("web", "legal", "data").contains(category) || name.startsWith("qichacha_")
                || name.startsWith("law_") || name.startsWith("tmeet_")) return "external";
        if (Set.of("python", "agent", "plugin").contains(category) || name.startsWith("plugin_dev_")
                || name.startsWith("capability_") || name.endsWith("_skill")) return "system";
        return "project";
    }

    /** 从工具组件类构建目录（口径同 ToolRegistry：扫 {@code @Tool} 方法），按 id 排序。 */
    public static List<Capability> fromToolClasses(Collection<Class<?>> toolClasses) {
        Map<String, String> covered = new LinkedHashMap<>();
        for (LocalMcpServerTools.Definition def : LocalMcpServerTools.DEFINITIONS) {
            for (String agentTool : def.coversAgentTools()) covered.put(agentTool, def.name());
        }
        Map<String, Capability> byId = new TreeMap<>();
        for (Class<?> type : toolClasses) {
            for (Method method : type.getDeclaredMethods()) {
                if (!method.isAnnotationPresent(Tool.class)) continue;
                Tool tool = method.getAnnotation(Tool.class);
                String name = tool.name() == null || tool.name().isBlank() ? method.getName() : tool.name();
                ToolMeta meta = method.getAnnotation(ToolMeta.class);
                ToolMeta.Access access = accessOf(name, meta);
                String host = meta == null ? "NONE" : meta.requiresHost().name();
                byId.put(name, new Capability(name, meta == null || meta.category().isEmpty() ? "-" : meta.category(),
                        access, scopeOf(name, meta, access), host, meta == null || meta.offerToModel(),
                        covered.get(name)));
            }
        }
        return new ArrayList<>(byId.values());
    }

    /** 渲染 docs/capability-catalog.md。输出确定（排序固定、不含时间戳），便于漂移比对。 */
    public static String renderMarkdown(List<Capability> capabilities) {
        StringBuilder sb = new StringBuilder();
        sb.append("<!-- GENERATED by CapabilityCatalogDocTest — do not edit. -->\n");
        sb.append("<!-- Regenerate: cd backend && AWD_WRITE_CAPABILITY_CATALOG=1 mvn test -Dtest=CapabilityCatalogDocTest -->\n\n");
        sb.append("# AI WorkDeck 能力目录\n\n");
        sb.append("每个 agent 工具的访问级别与权限范围，以及本机 MCP 服务器（`/mcp`）开放了哪些。\n");
        sb.append("访问级别优先取 `@ToolMeta(access=...)`，否则按工具名动词推断，拿不准的算写入；\n");
        sb.append("规则见 `backend/src/main/java/com/checkba/service/ai/capability/CapabilityCatalog.java`。\n\n");
        sb.append("- **read**：只读；**write**：写入，可撤回；**destructive**：删除、覆盖或不可逆，需用户确认。\n");
        sb.append("- 权限范围 `awd:<领域>.<read|write>`：project 项目文件与数据、editor 桌面编辑器、office-addin 任务窗格、"
                + "memory 用户记忆、external 外部服务、system 代码执行与扩展安装。\n");
        sb.append("- 宿主：NONE 纯后端可完成；LOWA 需桌面编辑器；OFFICE 需 Office/WPS 任务窗格。\n\n");

        Map<ToolMeta.Access, Long> counts = new TreeMap<>();
        capabilities.forEach(c -> counts.merge(c.access(), 1L, Long::sum));
        sb.append("合计 ").append(capabilities.size()).append(" 个工具：");
        List<String> parts = new ArrayList<>();
        counts.forEach((a, n) -> parts.add(label(a) + " " + n));
        sb.append(String.join("，", parts)).append("。\n\n");

        sb.append("## MCP 服务器工具（本机 `/mcp`，只读）\n\n");
        sb.append("| MCP 工具 | 访问 | 权限范围 | 对应 agent 工具 |\n| --- | --- | --- | --- |\n");
        for (LocalMcpServerTools.Definition def : LocalMcpServerTools.DEFINITIONS) {
            sb.append("| `").append(def.name()).append("` | ").append(label(def.access())).append(" | ")
                    .append(def.scope()).append(" | ")
                    .append(def.coversAgentTools().isEmpty() ? "—"
                            : "`" + String.join("`, `", def.coversAgentTools()) + "`")
                    .append(" |\n");
        }
        sb.append('\n');

        Map<String, List<Capability>> byArea = new TreeMap<>();
        for (Capability c : capabilities) {
            String area = c.scope().substring("awd:".length(), c.scope().lastIndexOf('.'));
            byArea.computeIfAbsent(area, k -> new ArrayList<>()).add(c);
        }
        for (Map.Entry<String, List<Capability>> e : byArea.entrySet()) {
            sb.append("## ").append(e.getKey()).append("\n\n");
            sb.append("| 工具 | 访问 | 权限范围 | 类目 | 宿主 | 下发给模型 | MCP |\n");
            sb.append("| --- | --- | --- | --- | --- | --- | --- |\n");
            e.getValue().sort(Comparator.comparing(Capability::id));
            for (Capability c : e.getValue()) {
                sb.append("| `").append(c.id()).append("` | ").append(label(c.access())).append(" | ")
                        .append(c.scope()).append(" | ").append(c.category()).append(" | ")
                        .append(c.host()).append(" | ").append(c.offeredToModel() ? "是" : "否").append(" | ")
                        .append(c.mcpTool() == null ? "—" : "`" + c.mcpTool() + "`").append(" |\n");
            }
            sb.append('\n');
        }
        return sb.toString();
    }

    private static String label(ToolMeta.Access access) {
        return access.name().toLowerCase(Locale.ROOT);
    }
}
