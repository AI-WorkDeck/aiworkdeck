// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ai;

import com.checkba.model.entity.ProjectTask;
import com.checkba.service.ProjectMemberService;
import com.checkba.service.SystemSettingService;
import com.checkba.service.ai.tools.ToolContext;
import com.checkba.service.plugin.HostServiceRegistry;
import com.checkba.service.task.ProjectTaskService;
import dev.langchain4j.agent.tool.ToolSpecification;
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
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;

/**
 * 声明式 Agent 工具端到端（规范 v2.13 §20，设计 P1-2/P1-3）：
 * examples/hello-agent-tools 装进插件目录后，两个工具出现在 ToolRegistry，读工具可执行，
 * 写工具缺权限被拒，禁用插件后消失；非法声明只丢工具段、插件照常加载。
 */
class PluginDeclaredToolsTest {

    @TempDir
    Path pluginsDir;

    private final Map<String, String> store = new HashMap<>();
    private final ProjectTaskService tasks = mock(ProjectTaskService.class);
    private final ProjectMemberService members = mock(ProjectMemberService.class);
    private PluginService plugins;
    private ToolRegistry registry;
    private String manifest;
    private final ToolContext ctx = new ToolContext(5L, "conv-1", 7L, "model");

    @BeforeEach
    void setUp() throws IOException {
        Path example = Path.of("..", "examples", "hello-agent-tools", "manifest.json");
        Assumptions.assumeTrue(Files.isRegularFile(example), "examples/hello-agent-tools 不在（非完整仓库检出），跳过");
        manifest = Files.readString(example);
        SystemSettingService settings = mock(SystemSettingService.class);
        when(settings.get(anyString(), anyString())).thenAnswer(i -> store.getOrDefault(i.<String>getArgument(0), i.getArgument(1)));
        doAnswer(i -> store.put(i.getArgument(0), i.getArgument(1))).when(settings).set(anyString(), anyString());
        plugins = new PluginService(settings, pluginsDir.toString());
        registry = new ToolRegistry(List.of(), plugins, new ClientCapabilityService());
        registry.setHostServiceRegistry(new HostServiceRegistry(tasks, members, null, null, null));
        registry.init();
    }

    private void install(String json) throws IOException {
        Path dir = pluginsDir.resolve("hello-agent-tools");
        Files.createDirectories(dir.resolve("web"));
        Files.writeString(dir.resolve("web/index.html"), "<html></html>");
        Files.writeString(dir.resolve("manifest.json"), json, StandardCharsets.UTF_8);
        plugins.init();
    }

    private List<String> names() {
        return registry.getAllSpecifications().stream().map(ToolSpecification::name).toList();
    }

    @Test
    void installedToolsAppearExecuteAndDisappearWhenDisabled() throws IOException {
        install(manifest);
        assertTrue(names().containsAll(List.of("hello_agent_tools_list_tasks", "hello_agent_tools_add_task")));
        assertTrue(registry.pluginToolNames().contains("hello_agent_tools_list_tasks"));
        assertTrue(registry.resolve("hello_agent_tools_add_task").orElseThrow().fromPlugin());

        // 读工具：身份取自服务端上下文，模型传的 userId 被忽略
        when(tasks.listForUser(7L, null, null)).thenReturn(List.of(Map.of("id", 1, "title", "举证期限")));
        var read = registry.execute("hello_agent_tools_list_tasks", "{\"userId\":99}", ctx);
        assertTrue(read.found());
        assertTrue(read.output().contains("举证期限"), read.output());

        // 写工具：成员权限通过则建事项
        when(members.hasWritePermission(5L, 7L)).thenReturn(true);
        ProjectTask task = new ProjectTask();
        task.setId(11L);
        when(tasks.createAiTask(eq(5L), any(ProjectTaskService.TaskDraft.class), eq(7L))).thenReturn(task);
        when(tasks.toResponseMap(task)).thenReturn(Map.of("id", 11));
        var write = registry.execute("hello_agent_tools_add_task", "{\"title\":\"开庭\",\"dueDate\":\"2026-12-01\"}", ctx);
        assertTrue(write.output().contains("11"), write.output());

        // 无权限的项目：refusal
        var denied = registry.execute("hello_agent_tools_add_task",
                "{\"title\":\"x\",\"dueDate\":\"2026-12-01\",\"projectId\":9}", ctx);
        assertTrue(denied.output().startsWith("Error"), denied.output());

        // ASK 只放声明为 read 的
        assertEquals(java.util.Set.of("hello_agent_tools_list_tasks"), registry.declaredReadToolNames());

        plugins.setEnabled("hello-agent-tools", false);
        assertFalse(names().contains("hello_agent_tools_list_tasks"));
        assertFalse(names().contains("hello_agent_tools_add_task"));
        assertTrue(registry.resolve("hello_agent_tools_list_tasks").isEmpty());
        assertFalse(registry.execute("hello_agent_tools_list_tasks", "{}", ctx).found());
    }

    @Test
    void toolWithoutDeclaredPermissionIsRefused() throws IOException {
        // manifest.permissions 里没有 tasks：工具自身 permissions 为空也能通过校验，运行时被服务表要求的权限拦住
        install(manifest.replace("\"permissions\": [\"tasks\"],\n  \"minHostVersion\"", "\"permissions\": [],\n  \"minHostVersion\"")
                .replace("\"permissions\": [\"tasks\"]", "\"permissions\": []"));
        assertTrue(names().contains("hello_agent_tools_add_task"));
        var r = registry.execute("hello_agent_tools_add_task", "{\"title\":\"x\",\"dueDate\":\"2026-12-01\"}", ctx);
        assertTrue(r.output().contains("permission denied"), r.output());
        verify(tasks, never()).createAiTask(any(), any(ProjectTaskService.TaskDraft.class), any());
    }

    @Test
    void invalidDeclarationSkipsToolsButPluginStillLoads() throws IOException {
        install(manifest.replace("hello_agent_tools_add_task", "bad_prefix_add_task"));
        assertNotNull(plugins.getPlugin("hello-agent-tools"));
        assertTrue(plugins.getDeclaredTools().isEmpty());
        assertFalse(names().contains("hello_agent_tools_list_tasks"));
        assertFalse(names().contains("bad_prefix_add_task"));
    }

    @Test
    void validatorRejectsRulesBrokenByTheManifest() throws IOException {
        install(manifest);
        var meta = plugins.getPlugin("hello-agent-tools");
        PluginManifestContractValidator.validateTools(meta);
        for (String[] bad : new String[][]{
                {"\"access\": \"read\"", "\"access\": \"admin\""},
                {"\"operation\": \"listForUser\"", "\"operation\": \"nope\""},
                {"\"permissions\": [\"tasks\"],\n      \"keywords\"", "\"permissions\": [\"network\"],\n      \"keywords\""},
                {"\"additionalProperties\": false\n      },\n      \"handler\": { \"type\": \"service\", \"service\": \"calendar\", \"operation\": \"listForUser\"",
                        "\"minimum\": 1\n      },\n      \"handler\": { \"type\": \"service\", \"service\": \"calendar\", \"operation\": \"listForUser\""},
                {"{ \"type\": \"service\", \"service\": \"calendar\", \"operation\": \"create\" }", "{ \"type\": \"connection\", \"connectionId\": \"crm\", \"operation\": \"x\" }"}}) {
            String broken = manifest.replace(bad[0], bad[1]);
            assertNotEquals(manifest, broken, bad[0]);
            var parsed = plugins.parseManifest(broken);
            assertThrows(IllegalArgumentException.class, () -> PluginManifestContractValidator.validateTools(parsed), bad[1]);
        }
    }

    @Test
    void declaredKeywordsFeedPluginToolsDisclosure() throws IOException {
        install(manifest);
        var policy = new ToolDisclosurePolicy(true);
        policy.setPluginToolKeywords(registry::declaredToolKeywords);
        assertTrue(policy.categoriesHintedBy("please run hello agent now").contains(ToolDisclosurePolicy.PLUGIN_TOOLS_CATEGORY));
        assertFalse(policy.categoriesHintedBy("这是什么文件").contains(ToolDisclosurePolicy.PLUGIN_TOOLS_CATEGORY));
        plugins.setEnabled("hello-agent-tools", false);
        assertFalse(policy.categoriesHintedBy("please run hello agent now").contains(ToolDisclosurePolicy.PLUGIN_TOOLS_CATEGORY));
    }
}
