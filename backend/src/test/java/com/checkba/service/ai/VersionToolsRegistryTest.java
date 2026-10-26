// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.ai;

import com.checkba.service.ai.tools.VersionTools;
import com.fasterxml.jackson.databind.ObjectMapper;
import dev.langchain4j.agent.tool.ToolSpecification;
import org.junit.jupiter.api.Test;
import java.util.List;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class VersionToolsRegistryTest {
    @Test void allSixToolsAreDiscoverableInDesktopWithoutAnActiveFileButHiddenInOtherHosts() {
        ClientCapabilityService capabilities = new ClientCapabilityService();
        ToolRegistry registry = new ToolRegistry(List.of(new VersionTools(mock(VersionToolActionService.class), new ObjectMapper())),
                new PluginService(), capabilities);
        registry.init();
        capabilities.record("desktop", "lowa"); capabilities.record("office", "office"); capabilities.record("none", "none");
        List<String> names = List.of("version_status", "version_history", "version_changes", "version_commit", "version_pull", "version_restore");
        assertEquals(names.stream().sorted().toList(), registry.getAllSpecifications("desktop").stream()
                .map(ToolSpecification::name).sorted().toList());
        ToolDisclosurePolicy policy = new ToolDisclosurePolicy(true);
        for (String tool : names) {
            assertEquals("version", policy.categoryOf(tool));
            assertTrue(registry.resolve(tool, "desktop").isPresent());
            assertTrue(registry.resolve(tool, "office").isEmpty());
            assertTrue(registry.resolve(tool, "none").isEmpty());
        }
        assertTrue(registry.getAllSpecifications("office").isEmpty());
        assertTrue(registry.getAllSpecifications("none").isEmpty());
        assertTrue(policy.categoryNames().contains("version"));
        for (String prompt : List.of("提交改动", "取回最新版本", "自动合并", "Git status", "restore history"))
            assertTrue(policy.categoriesHintedBy(prompt).contains("version"), prompt);
    }
}
