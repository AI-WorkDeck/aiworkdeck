// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.mcpserver;

import com.checkba.service.LangText;
import com.checkba.service.ProjectMemberService;
import com.checkba.service.ai.ToolRegistry;
import com.checkba.service.ai.tools.ToolContext;
import com.checkba.service.ai.tools.ToolMeta;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import dev.langchain4j.model.chat.request.json.JsonObjectSchema;
import dev.langchain4j.model.chat.request.json.JsonSchemaElementHelper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

/**
 * 对外 MCP 的工具投影（docs/plans/agent-app-control.md C7）：同一张 {@link ToolRegistry}，应用内 Agent 与外部
 * Agent 两个消费者。{@code tools/list} = 手工精修工具（{@link LocalMcpServerTools#DEFINITIONS}，重名时它赢）+
 * {@link ToolRegistry#mcpCandidates()}；{@code tools/call} 走 {@link ToolRegistry#execute}，身份是本机用户。
 *
 * <p>userId/conversationId/userMessage 是服务端注入的上下文，永不出现在 inputSchema；需要项目的工具把
 * {@code projectId} 作为显式入参补回，并在执行前按本机用户核项目读（write 工具核写）权限。
 */
@Service
@Slf4j
public class McpToolProjection {

    private final ToolRegistry registry;
    private final ProjectMemberService projectMemberService;
    private final ObjectMapper objectMapper;

    public McpToolProjection(ToolRegistry registry, ProjectMemberService projectMemberService, ObjectMapper objectMapper) {
        this.registry = registry;
        this.projectMemberService = projectMemberService;
        this.objectMapper = objectMapper;
    }

    /** 一个投影出去的工具。 */
    public record Projected(String name, String description, Map<String, Object> inputSchema,
                            ToolMeta.Access access, boolean needsProject) {}

    /** 按工具名排序、去重（精修工具优先）。每次现算：插件启停、账户连接状态随时变。 */
    public List<Projected> list() {
        Set<String> curated = new java.util.HashSet<>();
        LocalMcpServerTools.DEFINITIONS.forEach(d -> curated.add(d.name()));
        Map<String, Projected> byName = new java.util.TreeMap<>();
        for (ToolRegistry.McpCandidate c : registry.mcpCandidates()) {
            String name = c.spec().name();
            if (curated.contains(name) || byName.containsKey(name)) continue;
            byName.put(name, new Projected(name, c.spec().description() == null ? "" : c.spec().description(),
                    inputSchema(c.spec().parameters(), c.needsProject()), c.access(), c.needsProject()));
        }
        List<Projected> out = new ArrayList<>(byName.values());
        out.sort(Comparator.comparing(Projected::name));
        if (out.size() > 60) log.info("MCP projection exposes {} registry tools (+{} curated)", out.size(), curated.size());
        return out;
    }

    public Optional<Projected> find(String name) {
        return list().stream().filter(p -> p.name().equals(name)).findFirst();
    }

    /** 执行投影工具；参数/权限问题抛 {@link LocalMcpServerTools.ToolError}，工具自报的 {@code Error:} 也当错误。 */
    public String call(Projected tool, Map<String, Object> args, Long userId, String conversationId) {
        Long projectId = null;
        Object raw = args.get("projectId");
        if (raw != null) projectId = LocalMcpServerTools.longArg(args, "projectId", false);
        if (projectId != null) {
            boolean allowed = tool.access() == ToolMeta.Access.READ
                    ? projectMemberService.hasReadPermission(projectId, userId)
                    : projectMemberService.hasWritePermission(projectId, userId);
            if (!allowed) throw new LocalMcpServerTools.ToolError(LangText.of("项目不存在：", "Project not found: ") + projectId);
        }
        String argsJson;
        try {
            argsJson = objectMapper.writeValueAsString(args);
        } catch (JsonProcessingException e) {
            throw new LocalMcpServerTools.ToolError(LangText.of("参数无效", "Invalid arguments"));
        }
        ToolContext ctx = new ToolContext(projectId, conversationId, userId, null);
        ToolRegistry.ToolResult result = registry.execute(tool.name(), argsJson, ctx);
        String output = result.output() == null ? "" : result.output();
        if (!result.found() || output.startsWith("Error")) throw new LocalMcpServerTools.ToolError(output);
        return output;
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> inputSchema(JsonObjectSchema params, boolean needsProject) {
        Map<String, Object> schema = params == null
                ? new LinkedHashMap<>() : new LinkedHashMap<>(JsonSchemaElementHelper.toMap(params));
        schema.put("type", "object");
        Map<String, Object> props = new java.util.TreeMap<>(
                schema.get("properties") instanceof Map<?, ?> m ? (Map<String, Object>) m : Map.of());
        props.keySet().removeAll(Set.of("userId", "conversationId", "userMessage"));
        List<String> required = new ArrayList<>(
                schema.get("required") instanceof List<?> r ? (List<String>) r : List.of());
        required.removeAll(Set.of("userId", "conversationId", "userMessage"));
        if (needsProject) {
            // 内置工具的 projectId 是「当前项目」：有的必须（读项目文件），有的可选（task_list 缺省查全部项目），
            // 规格里看不出，所以只补回可选入参，缺了由工具自己报错；声明式工具按 manifest 自己的 required。
            props.putIfAbsent("projectId", Map.of("type", "integer",
                    "description", "Project id from list_projects. Scopes the call to that project when the tool is project-bound."));
        }
        schema.put("properties", props);
        schema.put("required", required);
        return schema;
    }
}
