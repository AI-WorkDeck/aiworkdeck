// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ai;

import com.checkba.service.SystemSettingService;
import com.checkba.service.ai.tools.AgentToolComponent;
import com.checkba.service.ai.tools.ToolContext;
import com.checkba.service.ai.tools.ToolMeta;
import dev.langchain4j.agent.tool.P;
import dev.langchain4j.agent.tool.Tool;
import dev.langchain4j.agent.tool.ToolSpecification;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.context.annotation.ClassPathScanningCandidateComponentProvider;
import org.springframework.core.type.filter.AssignableTypeFilter;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * 网页版（{@code Capability.WEB}）工具面的契约测试（W1 设计 §4.6 / P2 验收）。
 *
 * <p>枚举<b>真实注册表</b>里的每一个内置工具：必须在 {@link WebClientToolSurface} 里被显式归类
 *（放行或拒绝），否则红——新工具不会悄悄漏到网页上。再在真实注册表上核对三个消费点
 *（规格下发 / resolve / execute）都按白名单走，以及插件工具缺省不可见。
 */
class ClientCapabilityWebSurfaceTest {

    private static final String WEB = "conv-web";
    private static final String LOWA = "conv-lowa";

    private static ClientCapabilityService capabilities;
    private static ToolRegistry registry;
    /** 工具名 → 宿主声明（与 ToolRegistry @PostConstruct 推给能力服务的同一份）。 */
    private static final Map<String, ToolMeta.Host> HOSTS = new TreeMap<>();

    @BeforeAll
    static void realRegistry() {
        org.objenesis.ObjenesisStd objenesis = new org.objenesis.ObjenesisStd();
        List<AgentToolComponent> beans = new ArrayList<>();
        ClassPathScanningCandidateComponentProvider scanner = new ClassPathScanningCandidateComponentProvider(false);
        scanner.addIncludeFilter(new AssignableTypeFilter(AgentToolComponent.class));
        for (var candidate : scanner.findCandidateComponents("com.checkba")) {
            try {
                Class<?> type = Class.forName(candidate.getBeanClassName());
                var source = type.getProtectionDomain().getCodeSource();
                if (source != null && source.getLocation() != null
                        && source.getLocation().getPath().contains("test-classes")) continue;
                if (java.lang.reflect.Modifier.isAbstract(type.getModifiers())) continue;
                beans.add((AgentToolComponent) objenesis.newInstance(type));
                for (var method : type.getDeclaredMethods()) {
                    ToolMeta meta = method.getAnnotation(ToolMeta.class);
                    if (method.isAnnotationPresent(Tool.class)) {
                        HOSTS.put(dev.langchain4j.agent.tool.ToolSpecifications.toolSpecificationFrom(method).name(),
                                meta == null ? ToolMeta.Host.NONE : meta.requiresHost());
                    }
                }
            } catch (ClassNotFoundException e) {
                throw new IllegalStateException(e);
            }
        }
        capabilities = new ClientCapabilityService();
        registry = new ToolRegistry(beans, mock(PluginService.class), capabilities);
        registry.init();
        capabilities.record(WEB, "web");
        capabilities.record(LOWA, "lowa");
    }

    private static Set<String> builtinNames() {
        return new TreeSet<>(registry.toolNamesLongestFirst());
    }

    @Test
    @DisplayName("每个已注册的内置工具都在 WEB 白名单 / 拒绝表里被显式归类（新增工具没归类就红）")
    void everyRegisteredToolIsClassifiedForWeb() {
        Set<String> names = builtinNames();
        assertTrue(names.size() > 280, "扫到的工具太少，扫描口径坏了：" + names.size());
        List<String> unclassified = new ArrayList<>();
        List<String> both = new ArrayList<>();
        for (String name : names) {
            boolean allowed = WebClientToolSurface.allowsBuiltin(name);
            boolean denied = WebClientToolSurface.denies(name);
            if (!allowed && !denied) unclassified.add(name);
            if (allowed && denied) both.add(name);
        }
        assertTrue(unclassified.isEmpty(), "这些工具没在 WebClientToolSurface 里归类（网页版能不能用？）："
                + unclassified);
        assertTrue(both.isEmpty(), "同时被放行又被拒绝：" + both);
    }

    @Test
    @DisplayName("白名单与拒绝表里的名字都是真实注册的工具（改名后名单不许腐烂）")
    void surfaceListsOnlyNameRealTools() {
        Set<String> names = builtinNames();
        List<String> stale = new ArrayList<>();
        for (Set<String> list : List.of(WebClientToolSurface.EDITOR_TOOLS, WebClientToolSurface.BACKEND_TOOLS,
                WebClientToolSurface.DENIED_TOOLS)) {
            for (String name : list) if (!names.contains(name)) stale.add(name);
        }
        assertTrue(stale.isEmpty(), "名单里有不存在的工具：" + stale);
    }

    @Test
    @DisplayName("放行的工具没有声明桌面/任务窗格宿主，也不属于桌面专属前缀族")
    void allowedToolsDoNotNeedADesktopHost() {
        for (String name : builtinNames()) {
            if (!WebClientToolSurface.allowsBuiltin(name)) continue;
            assertEquals(ToolMeta.Host.NONE, HOSTS.getOrDefault(name, ToolMeta.Host.NONE),
                    name + " 声明了宿主依赖，不能对网页放行");
            for (String prefix : List.of("office_", "ref_", "sheet_", "slide_", "pptx_", "version_", "text_")) {
                assertFalse(name.startsWith(prefix), name);
            }
        }
        for (String name : WebClientToolSurface.EDITOR_TOOLS) {
            assertTrue(name.startsWith("doc_"), "W1 只开 Writer：" + name);
        }
    }

    @Test
    @DisplayName("WEB 会话下发的规格恰好是白名单里真下发的那些（快照）")
    void webSpecificationsAreExactlyTheAllowlist() {
        Set<String> offered = new TreeSet<>();
        for (ToolSpecification spec : registry.getAllSpecifications()) offered.add(spec.name());
        Set<String> expected = new TreeSet<>();
        for (String name : offered) if (WebClientToolSurface.allowsBuiltin(name)) expected.add(name);
        Set<String> actual = new TreeSet<>();
        for (ToolSpecification spec : registry.getAllSpecifications(WEB)) actual.add(spec.name());
        assertEquals(expected, actual);
        // Writer 活跃文档下编辑器工具仍在；非 Writer（W1 网页不开，但判据要稳）时 doc_ 编辑原语收起
        Set<String> writer = new TreeSet<>();
        for (ToolSpecification spec : registry.getAllSpecifications(WEB, ClientCapabilityService.DOC_KIND_WRITER)) {
            writer.add(spec.name());
        }
        assertEquals(expected, writer);
    }

    @Test
    @DisplayName("桌面专属工具在 WEB 会话的规格、resolve、execute 三处都不可见，且立即返回（不走编辑器桥等待）")
    void desktopOnlyToolsAreInvisibleAtAllThreePoints() {
        Set<String> specs = new TreeSet<>();
        for (ToolSpecification spec : registry.getAllSpecifications(WEB)) specs.add(spec.name());
        ToolContext ctx = new ToolContext(1L, WEB, 7L, "model-x");
        for (String name : List.of("version_status", "version_commit", "run_python", "sheet_write_cells",
                "slide_get_overview", "office_get_text", "ref_read", "pptx_generate", "doc_view_pages",
                "text_find_replace", "meeting_list", "capability_install", "plugin_dev_scaffold", "create_skill")) {
            assertTrue(registry.resolve(name).isPresent(), name + " 应当是真实注册的工具");
            assertFalse(specs.contains(name), name + " 不应下发给网页会话");
            assertTrue(registry.resolve(name, WEB).isEmpty(), name + " 不应在网页会话 resolve 到");
            long started = System.nanoTime();
            ToolRegistry.ToolResult result = registry.execute(name, "{}", ctx);
            long elapsedMs = (System.nanoTime() - started) / 1_000_000;
            assertFalse(result.found(), name + " 不应在网页会话执行");
            assertTrue(elapsedMs < 5_000, name + " 拒绝耗时 " + elapsedMs + "ms");
            // 同一工具在桌面会话照旧可见：收窄只发生在 WEB
            if (!name.startsWith("office_") && !name.startsWith("ref_") && !name.startsWith("sheet_")
                    && !name.startsWith("slide_")) {
                assertTrue(registry.resolve(name, LOWA).isPresent(), name + " 在 LOWA 会话应仍可见");
            }
        }
        for (String name : List.of("doc_replace_at_anchor", "doc_open_file", "write_docx", "law_search",
                "search_web", "ask_user", "list_tools", "use_skill", "memory_search")) {
            assertTrue(specs.contains(name) || registry.resolve(name, WEB).isPresent(), name + " 应对网页可见");
        }
    }

    // ---------------------------------------------------------------- 插件工具

    static class WebPluginFakeTools {
        @Tool("plugin probe")
        public String webprobe_lookup(@P("t") String t) {
            return "ok:" + t;
        }
    }

    private static ToolRegistry pluginRegistry(ClientCapabilityService caps, List<String> hosts) {
        PluginService plugins = mock(PluginService.class);
        when(plugins.getPluginTools()).thenReturn(Map.of("webprobe_lookup", new WebPluginFakeTools()));
        when(plugins.getPluginIdForTool("webprobe_lookup")).thenReturn("webprobe");
        when(plugins.isEnabled("webprobe")).thenReturn(true);
        when(plugins.supportsWebClient("webprobe")).thenReturn(hosts != null && hosts.contains("web"));
        ToolRegistry reg = new ToolRegistry(List.of(), plugins, caps);
        reg.init();
        return reg;
    }

    @Test
    @DisplayName("第三方插件工具在 WEB 会话缺省不可见（规格 / resolve / execute），桌面会话不受影响")
    void pluginToolsAreHiddenOnWebByDefault() {
        ClientCapabilityService caps = new ClientCapabilityService();
        caps.record(WEB, "web");
        caps.record(LOWA, "lowa");
        ToolRegistry reg = pluginRegistry(caps, null);
        assertTrue(reg.getAllSpecifications(WEB).stream().noneMatch(s -> s.name().equals("webprobe_lookup")));
        assertTrue(reg.resolve("webprobe_lookup", WEB).isEmpty());
        assertFalse(reg.execute("webprobe_lookup", "{\"t\":\"x\"}", new ToolContext(1L, WEB, 7L, "m")).found());
        assertTrue(reg.resolve("webprobe_lookup", LOWA).isPresent(), "桌面会话照旧放行插件工具");
    }

    @Test
    @DisplayName("manifest 声明 hosts:[\"web\"] 的插件，其工具在 WEB 会话可见可调")
    void pluginToolsDeclaringWebAreVisible() {
        ClientCapabilityService caps = new ClientCapabilityService();
        caps.record(WEB, "web");
        ToolRegistry reg = pluginRegistry(caps, List.of("web"));
        assertTrue(reg.resolve("webprobe_lookup", WEB).isPresent());
        var result = reg.execute("webprobe_lookup", "{\"t\":\"x\"}", new ToolContext(1L, WEB, 7L, "m"));
        assertTrue(result.found());
        assertEquals("ok:x", result.output());
    }

    @Test
    @DisplayName("PluginService.supportsWebClient 读 manifest 顶层 hosts（缺省 / 其它值都不算）")
    void manifestHostsFieldIsParsed(@org.junit.jupiter.api.io.TempDir java.nio.file.Path dir) throws Exception {
        for (String[] plugin : new String[][] {{"web-ok", ",\"hosts\":[\"web\"]"}, {"web-upper", ",\"hosts\":[\"WEB\"]"},
                {"no-hosts", ""}, {"other-host", ",\"hosts\":[\"desktop\"]"}}) {
            java.nio.file.Path pluginDir = java.nio.file.Files.createDirectories(dir.resolve(plugin[0]));
            java.nio.file.Files.writeString(pluginDir.resolve("manifest.json"),
                    "{\"id\":\"" + plugin[0] + "\",\"name\":\"p\",\"version\":\"1.0.0\"" + plugin[1] + "}");
        }
        SystemSettingService settings = mock(SystemSettingService.class);
        when(settings.get(org.mockito.ArgumentMatchers.anyString(), org.mockito.ArgumentMatchers.anyString()))
                .thenAnswer(inv -> inv.getArgument(1));
        PluginService service = new PluginService(settings, dir.toString());
        service.init();
        assertTrue(service.supportsWebClient("web-ok"));
        assertTrue(service.supportsWebClient("web-upper"));
        assertFalse(service.supportsWebClient("no-hosts"));
        assertFalse(service.supportsWebClient("other-host"));
        assertFalse(service.supportsWebClient("missing"));
    }
}
