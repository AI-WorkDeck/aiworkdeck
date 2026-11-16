// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ai.capability;

import com.checkba.service.ai.tools.AgentToolComponent;
import com.checkba.service.ai.tools.ToolMeta;
import com.checkba.service.mcpserver.LocalMcpServerTools;
import org.junit.jupiter.api.Test;
import org.springframework.context.annotation.ClassPathScanningCandidateComponentProvider;
import org.springframework.core.type.filter.AssignableTypeFilter;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

/**
 * 能力目录的分类规则与文档漂移护栏。
 *
 * <p>docs/capability-catalog.md 由本测试生成：改了工具或分类后执行
 * {@code AWD_WRITE_CAPABILITY_CATALOG=1 mvn test -Dtest=CapabilityCatalogDocTest} 重新生成并提交。
 */
class CapabilityCatalogDocTest {

    private static final Path DOC = Path.of("..", "docs", "capability-catalog.md");

    @Test
    void infersAccessFromVerbsWithWriteWinningOverRead() {
        assertEquals(ToolMeta.Access.READ, CapabilityCatalog.inferAccess("extract_file_text"));
        assertEquals(ToolMeta.Access.READ, CapabilityCatalog.inferAccess("doc_get_outline"));
        assertEquals(ToolMeta.Access.READ, CapabilityCatalog.inferAccess("sheet_read_range"));
        assertEquals(ToolMeta.Access.WRITE, CapabilityCatalog.inferAccess("doc_find_replace"));
        assertEquals(ToolMeta.Access.WRITE, CapabilityCatalog.inferAccess("write_docx"));
        assertEquals(ToolMeta.Access.DESTRUCTIVE, CapabilityCatalog.inferAccess("move_to_trash"));
        assertEquals(ToolMeta.Access.DESTRUCTIVE, CapabilityCatalog.inferAccess("version_restore"));
        assertEquals(ToolMeta.Access.DESTRUCTIVE, CapabilityCatalog.inferAccess("pdf_redact"));
        // 认不出的动词按写入处理
        assertEquals(ToolMeta.Access.WRITE, CapabilityCatalog.inferAccess("frobnicate_widget"));
    }

    @Test
    void realToolsAreClassifiedAsExpected() {
        Map<String, CapabilityCatalog.Capability> byId = catalog().stream()
                .collect(Collectors.toMap(CapabilityCatalog.Capability::id, Function.identity()));
        assertTrue(byId.size() > 280, "扫到的工具太少，扫描口径坏了：" + byId.size());
        assertEquals("awd:project.read", byId.get("search_project_content").scope());
        assertEquals("awd:editor.write", byId.get("doc_replace_selection").scope());
        assertEquals("awd:memory.write", byId.get("memory_delete").scope());
        assertEquals(ToolMeta.Access.DESTRUCTIVE, byId.get("memory_delete").access());
        assertEquals("awd:external.read", byId.get("search_web").scope());
        assertEquals("awd:system.write", byId.get("run_python").scope());
        assertEquals("read_file", byId.get("extract_file_text").mcpTool());
        // @ToolMeta(access=...) 显式声明覆盖推断
        assertEquals(ToolMeta.Access.READ, byId.get("qichacha_ipr").access());
        assertEquals(ToolMeta.Access.WRITE, byId.get("tag_remove_from_file").access());
        assertEquals(ToolMeta.Access.READ, byId.get("tag_list").access());
        assertEquals(ToolMeta.Access.READ, byId.get("pptx_inspect_format").access());
    }

    @Test
    void mcpServerExposesOnlyReadCapabilitiesPlusProposeRevisionBackedByRealAgentTools() {
        List<String> ids = catalog().stream().map(CapabilityCatalog.Capability::id).toList();
        for (LocalMcpServerTools.Definition def : LocalMcpServerTools.DEFINITIONS) {
            // 唯一允许的写工具：propose_revision 只落待审记录，不改文件（agent-app-control.md C7）
            if ("propose_revision".equals(def.name())) {
                assertEquals(ToolMeta.Access.WRITE, def.access());
                assertEquals("awd:project.propose", def.scope());
                continue;
            }
            assertEquals(ToolMeta.Access.READ, def.access(), def.name());
            assertTrue(def.scope().endsWith(".read"), def.name());
            for (String covered : def.coversAgentTools()) {
                assertTrue(ids.contains(covered), def.name() + " 声称覆盖不存在的 agent 工具 " + covered);
            }
        }
    }

    /** 对外 MCP = 精修工具 + ToolRegistry 投影（C7）：投影出来的内置工具必须全是 READ，写入类只有精修的 propose_revision。 */
    @Test
    void mcpProjectionOfRealRegistryIsReadOnlyBuiltins() {
        org.objenesis.ObjenesisStd objenesis = new org.objenesis.ObjenesisStd();
        List<com.checkba.service.ai.tools.AgentToolComponent> beans = new ArrayList<>();
        for (Class<?> type : toolClasses()) {
            if (!java.lang.reflect.Modifier.isAbstract(type.getModifiers())) {
                beans.add((com.checkba.service.ai.tools.AgentToolComponent) objenesis.newInstance(type));
            }
        }
        var registry = new com.checkba.service.ai.ToolRegistry(beans,
                org.mockito.Mockito.mock(com.checkba.service.ai.PluginService.class),
                new com.checkba.service.ai.ClientCapabilityService());
        registry.init();
        Map<String, CapabilityCatalog.Capability> byId = catalog().stream()
                .collect(Collectors.toMap(CapabilityCatalog.Capability::id, Function.identity()));
        List<String> projected = registry.mcpCandidates().stream().map(c -> c.spec().name()).toList();
        assertTrue(projected.contains("task_list"), projected.toString());
        // V8/P2-5：首批 write 白名单是唯一允许投影的内置写工具，且不是 destructive
        List<String> writeAllowed = List.of("task_create", "task_update", "tag_file", "create_folder");
        assertTrue(projected.containsAll(writeAllowed), projected.toString());
        for (var candidate : registry.mcpCandidates()) {
            String name = candidate.spec().name();
            var capability = byId.get(name);
            if (writeAllowed.contains(name)) {
                assertEquals(ToolMeta.Access.WRITE, candidate.access(), name);
                assertNotEquals(ToolMeta.Access.DESTRUCTIVE, capability.access(), name);
            } else {
                assertEquals(ToolMeta.Access.READ, candidate.access(), name);
                assertEquals(ToolMeta.Access.READ, capability.access(), name);
            }
            assertEquals("NONE", capability.host(), name);
            assertTrue(capability.offeredToModel(), name);
            assertTrue(Stream.of("doc_", "sheet_", "slide_", "office_", "ref_").noneMatch(name::startsWith), name);
        }
        for (String writer : List.of("write_docx", "doc_find_replace", "delete_file", "memory_delete", "ask_user", "list_tools", "todo_write", "use_skill", "dispatch_subtask", "create_skill",
                "search_web", "qichacha_ipr", "qichacha_query", "tushare_query", "law_search", "law_search_keyword",
                "law_recognition", "get_law_article", "case_search")) {
            assertTrue(!projected.contains(writer), writer);
        }
    }

    @Test
    void committedDocMatchesGeneratedCatalog() throws Exception {
        String generated = CapabilityCatalog.renderMarkdown(catalog());
        if ("1".equals(System.getenv("AWD_WRITE_CAPABILITY_CATALOG"))) {
            Files.writeString(DOC, generated, StandardCharsets.UTF_8);
        }
        assumeTrue(Files.isDirectory(DOC.getParent()), "单独跑 backend 模块（没有 docs/）时跳过");
        assertTrue(Files.isRegularFile(DOC), "缺少 docs/capability-catalog.md，按类注释重新生成");
        assertEquals(generated, Files.readString(DOC, StandardCharsets.UTF_8),
                "docs/capability-catalog.md 已过期：AWD_WRITE_CAPABILITY_CATALOG=1 mvn test "
                        + "-Dtest=CapabilityCatalogDocTest 重新生成后提交");
    }

    /** 口径同 ToolRegistry / ToolDisplayNameCoverageTest：扫 AgentToolComponent 的生产实现类。 */
    private static List<CapabilityCatalog.Capability> catalog() {
        return CapabilityCatalog.fromToolClasses(toolClasses());
    }

    private static List<Class<?>> toolClasses() {
        ClassPathScanningCandidateComponentProvider scanner = new ClassPathScanningCandidateComponentProvider(false);
        scanner.addIncludeFilter(new AssignableTypeFilter(AgentToolComponent.class));
        List<Class<?>> classes = new ArrayList<>();
        for (var candidate : scanner.findCandidateComponents("com.checkba")) {
            try {
                Class<?> type = Class.forName(candidate.getBeanClassName());
                var source = type.getProtectionDomain().getCodeSource();
                if (source != null && source.getLocation() != null
                        && source.getLocation().getPath().contains("test-classes")) continue;
                classes.add(type);
            } catch (ClassNotFoundException e) {
                throw new IllegalStateException(e);
            }
        }
        return classes;
    }
}
