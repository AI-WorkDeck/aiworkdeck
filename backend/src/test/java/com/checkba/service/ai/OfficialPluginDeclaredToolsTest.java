// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ai;

import com.checkba.service.ProjectMemberService;
import com.checkba.service.SystemSettingService;
import com.checkba.service.ai.tools.ToolContext;
import com.checkba.service.im.ImGatewayService;
import com.checkba.service.lawfirm.LawFirmManagementService;
import com.checkba.service.plugin.HostServiceRegistry;
import com.checkba.service.task.ProjectTaskService;
import dev.langchain4j.agent.tool.ToolSpecification;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.beans.factory.ObjectProvider;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;

/**
 * 官方插件 lawfirm-management / project-im / desensitize 的声明式工具（P2-3）：
 * 直接装 official-plugins 里的真实 manifest，启用时出现在 ToolRegistry，禁用后消失；
 * 描述经 l10n 解析（无残留 %key%），且 l10n 覆盖该插件已有的全部语言。
 */
class OfficialPluginDeclaredToolsTest {

    private static final Map<String, List<String>> TOOLS = Map.of(
            "lawfirm-management", List.of("lawfirm_management_matter_overview", "lawfirm_management_conflict_check", "lawfirm_management_fee_ledger"),
            "project-im", List.of("project_im_list_conversations", "project_im_read_messages"),
            "desensitize", List.of("desensitize_preview", "desensitize_redact"));

    @TempDir
    Path pluginsDir;

    private final Map<String, String> store = new HashMap<>();
    private final LawFirmManagementService lawfirm = mock(LawFirmManagementService.class);
    private final ImGatewayService im = mock(ImGatewayService.class);
    private PluginService plugins;
    private ToolRegistry registry;
    private final ToolContext ctx = new ToolContext(5L, "conv-1", 7L, "model");

    @SuppressWarnings("unchecked")
    @BeforeEach
    void setUp() {
        Assumptions.assumeTrue(Files.isDirectory(Path.of("..", "official-plugins", "desensitize")), "official-plugins 不在，跳过");
        SystemSettingService settings = mock(SystemSettingService.class);
        when(settings.get(anyString(), anyString())).thenAnswer(i -> store.getOrDefault(i.<String>getArgument(0), i.getArgument(1)));
        doAnswer(i -> store.put(i.getArgument(0), i.getArgument(1))).when(settings).set(anyString(), anyString());
        plugins = new PluginService(settings, pluginsDir.toString());
        registry = new ToolRegistry(List.of(), plugins, new ClientCapabilityService());
        ObjectProvider<LawFirmManagementService> lawfirmProvider = mock(ObjectProvider.class);
        ObjectProvider<ImGatewayService> imProvider = mock(ObjectProvider.class);
        when(lawfirmProvider.getIfAvailable()).thenReturn(lawfirm);
        when(imProvider.getIfAvailable()).thenReturn(im);
        registry.setHostServiceRegistry(new HostServiceRegistry(mock(ProjectTaskService.class), mock(ProjectMemberService.class),
                null, null, null, lawfirmProvider, imProvider));
        registry.init();
    }

    private void install(String id) throws IOException {
        Path src = Path.of("..", "official-plugins", id);
        Path dst = pluginsDir.resolve(id);
        Files.createDirectories(dst.resolve("web"));
        Files.writeString(dst.resolve("web/index.html"), "<html></html>");
        Files.copy(src.resolve("manifest.json"), dst.resolve("manifest.json"));
        Files.createDirectories(dst.resolve("l10n"));
        try (Stream<Path> l10n = Files.list(src.resolve("l10n"))) {
            for (Path f : l10n.toList()) Files.copy(f, dst.resolve("l10n").resolve(f.getFileName()));
        }
        plugins.init();
    }

    private List<String> names() {
        return registry.getAllSpecifications().stream().map(ToolSpecification::name).toList();
    }

    @Test
    void toolsAppearWhenEnabledAndVanishWhenDisabled() throws IOException {
        for (String id : TOOLS.keySet()) install(id);
        for (var e : TOOLS.entrySet()) {
            assertNotNull(plugins.getPlugin(e.getKey()), e.getKey());
            assertTrue(names().containsAll(e.getValue()), e.getKey() + " 工具应出现: " + names());
            assertTrue(registry.pluginToolNames().containsAll(e.getValue()));
        }
        // 只有 desensitize_redact 是写；其余都是 read（ASK 可用）
        assertEquals(java.util.Set.of("lawfirm_management_matter_overview", "lawfirm_management_conflict_check",
                "lawfirm_management_fee_ledger", "project_im_list_conversations", "project_im_read_messages", "desensitize_preview"),
                registry.declaredReadToolNames());

        for (var e : TOOLS.entrySet()) {
            plugins.setEnabled(e.getKey(), false);
            for (String tool : e.getValue()) {
                assertFalse(names().contains(tool), tool);
                assertTrue(registry.resolve(tool).isEmpty(), tool);
            }
            plugins.setEnabled(e.getKey(), true);
            assertTrue(names().containsAll(e.getValue()), e.getKey() + " 重新启用后应回来");
        }
    }

    @Test
    void descriptionsAreLocalizedAndEveryLocaleHasEveryKey() throws IOException {
        for (String id : TOOLS.keySet()) install(id);
        for (ToolSpecification spec : registry.getAllSpecifications()) {
            if (TOOLS.values().stream().noneMatch(l -> l.contains(spec.name()))) continue;
            assertNotNull(spec.description(), spec.name());
            assertFalse(spec.description().isBlank() || spec.description().contains("%tool."), spec.name() + ": " + spec.description());
        }
        for (var e : TOOLS.entrySet()) {
            try (Stream<Path> files = Files.list(Path.of("..", "official-plugins", e.getKey(), "l10n"))) {
                for (Path f : files.toList()) {
                    String json = Files.readString(f);
                    for (String tool : e.getValue()) {
                        assertTrue(json.contains("\"tool." + tool + ".desc\""), f + " 缺 " + tool);
                    }
                }
            }
        }
    }

    @Test
    void lawfirmToolRunsThroughHostServiceWithServerIdentity() throws IOException {
        install("lawfirm-management");
        when(lawfirm.execute(eq(7L), isNull(), eq("overview"), any())).thenReturn(Map.of("summary", Map.of("totalIntakes", 3)));
        var r = registry.execute("lawfirm_management_matter_overview", "{\"userId\":99}", ctx);
        assertTrue(r.output().contains("totalIntakes"), r.output());
    }

    @Test
    void imToolDenialReachesTheModelAsAnError() throws IOException {
        install("project-im");
        when(im.execute(eq(7L), eq("messages"), any())).thenThrow(new IllegalArgumentException("无权访问该会话"));
        var r = registry.execute("project_im_read_messages", "{\"imConversationId\":\"c9\"}", ctx);
        assertTrue(r.output().startsWith("Error"), r.output());
        assertTrue(r.output().contains("无权访问该会话"), r.output());
    }

    private static <T> T isNull() { return org.mockito.ArgumentMatchers.isNull(); }
    private static <T> T eq(T v) { return org.mockito.ArgumentMatchers.eq(v); }
}
