// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ai;

import com.checkba.service.ProjectMemberService;
import com.checkba.service.SystemSettingService;
import com.checkba.service.ai.tools.TaskTools;
import com.checkba.service.mcpserver.LocalMcpServerTools;
import com.checkba.service.mcpserver.McpToolProjection;
import com.checkba.service.plugin.HostServiceRegistry;
import com.checkba.service.task.ProjectTaskService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;

/** 对外 MCP 投影对真实 ToolRegistry（内置 TaskTools + examples/hello-agent-tools 声明式插件）的行为。 */
class McpToolProjectionTest {

    @TempDir
    Path pluginsDir;

    private final Map<String, String> store = new HashMap<>();
    private final ProjectTaskService tasks = mock(ProjectTaskService.class);
    private final ProjectMemberService members = mock(ProjectMemberService.class);
    private PluginService plugins;
    private McpToolProjection projection;
    private String manifest;

    @BeforeEach
    void setUp() throws IOException {
        Path example = Path.of("..", "examples", "hello-agent-tools", "manifest.json");
        Assumptions.assumeTrue(Files.isRegularFile(example), "examples/hello-agent-tools 不在（非完整仓库检出），跳过");
        manifest = Files.readString(example);
        SystemSettingService settings = mock(SystemSettingService.class);
        when(settings.get(anyString(), anyString())).thenAnswer(i -> store.getOrDefault(i.<String>getArgument(0), i.getArgument(1)));
        doAnswer(i -> store.put(i.getArgument(0), i.getArgument(1))).when(settings).set(anyString(), anyString());
        plugins = new PluginService(settings, pluginsDir.toString());
        ToolRegistry registry = new ToolRegistry(List.of(new TaskTools(tasks)), plugins, new ClientCapabilityService());
        registry.setHostServiceRegistry(new HostServiceRegistry(tasks, members, null, null, null, null, null));
        registry.init();
        projection = new McpToolProjection(registry, members, new ObjectMapper());
    }

    private void install(String json) throws IOException {
        Path dir = pluginsDir.resolve("hello-agent-tools");
        Files.createDirectories(dir.resolve("web"));
        Files.writeString(dir.resolve("web/index.html"), "<html></html>");
        Files.writeString(dir.resolve("manifest.json"), json, StandardCharsets.UTF_8);
        plugins.init();
    }

    private List<String> names() {
        return projection.list().stream().map(McpToolProjection.Projected::name).toList();
    }

    @Test
    void projectsReadToolsOnlyAndNeverExposesServerContextParams() throws IOException {
        install(manifest);
        List<String> names = names();
        assertTrue(names.contains("task_list"), names.toString());
        assertTrue(names.contains("hello_agent_tools_list_tasks"), names.toString());
        // 内置 write 白名单（P2-5）投影；未声明 mcp:true 的插件写工具不投影
        assertTrue(names.contains("task_create"), names.toString());
        assertTrue(names.contains("task_update"), names.toString());
        assertEquals(com.checkba.service.ai.tools.ToolMeta.Access.WRITE, projection.find("task_create").orElseThrow().access());
        // 会话内生工具永不投影
        for (String inApp : List.of("ask_user", "list_tools", "todo_write", "use_skill", "dispatch_subtask", "list_attached_files", "create_skill")) {
            assertFalse(names.contains(inApp), inApp);
        }
        assertFalse(names.contains("hello_agent_tools_add_task"));
        // 精修工具由 LocalMcpServerTools 提供，投影层不重复
        assertTrue(names.stream().noneMatch(LocalMcpServerTools::isCurated));
        assertEquals(names.stream().sorted().toList(), names);
        for (McpToolProjection.Projected p : projection.list()) {
            @SuppressWarnings("unchecked")
            Map<String, Object> props = (Map<String, Object>) p.inputSchema().get("properties");
            assertFalse(props.containsKey("userId") || props.containsKey("conversationId") || props.containsKey("userMessage"), p.name());
            assertEquals("object", p.inputSchema().get("type"));
        }
        @SuppressWarnings("unchecked")
        Map<String, Object> taskListProps = (Map<String, Object>) projection.find("task_list").orElseThrow().inputSchema().get("properties");
        assertTrue(taskListProps.containsKey("projectId"));
        assertTrue(taskListProps.containsKey("from"));
    }

    @Test
    void declaredMcpFlagControlsProjection() throws IOException {
        // write + mcp:true 投影；read + mcp:false 不投影；destructive 永不
        install(manifest.replace("\"permissions\": [\"tasks\"]\n    }\n  ],", "\"permissions\": [\"tasks\"],\n      \"mcp\": true\n    }\n  ],")
                .replace("\"access\": \"read\",", "\"access\": \"read\",\n      \"mcp\": false,"));
        assertTrue(names().contains("hello_agent_tools_add_task"), names().toString());
        assertFalse(names().contains("hello_agent_tools_list_tasks"));
        plugins.setEnabled("hello-agent-tools", false);
        assertFalse(names().contains("hello_agent_tools_add_task"));
    }

    @Test
    void toolsRequiringConfirmationAreNeverProjectedEvenWithMcpTrue() throws IOException {
        // 外部 Agent 答不了确认卡：confirm:always 的写工具即使 mcp:true 也不投影
        String m = manifest.replace("\"permissions\": [\"tasks\"]\n    }\n  ],",
                "\"permissions\": [\"tasks\"],\n      \"mcp\": true,\n      \"confirm\": \"always\"\n    }\n  ],");
        assertNotEquals(manifest, m);
        install(m);
        assertFalse(names().contains("hello_agent_tools_add_task"), names().toString());
        assertTrue(names().contains("hello_agent_tools_list_tasks"));
    }

    @Test
    void callRunsRegistryWithProjectPermission() throws IOException {
        install(manifest);
        when(tasks.listForUser(7L, null, null)).thenReturn(List.of(Map.of("id", 1, "title", "举证期限")));
        var tool = projection.find("hello_agent_tools_list_tasks").orElseThrow();
        assertTrue(projection.call(tool, Map.of(), 7L, "mcp:abcd1234").contains("举证期限"));

        var taskList = projection.find("task_list").orElseThrow();
        when(members.hasReadPermission(5L, 7L)).thenReturn(true);
        projection.call(taskList, Map.of("projectId", 5), 7L, "mcp:abcd1234");
        var denied = assertThrows(LocalMcpServerTools.ToolError.class,
                () -> projection.call(taskList, Map.of("projectId", 6), 7L, "mcp:abcd1234"));
        assertTrue(denied.getMessage().contains("6"));
    }
}
