// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ai.harness;

import com.checkba.service.ai.PluginService;
import com.checkba.service.ai.ToolDisclosurePolicy;
import com.checkba.service.ai.skill.SkillProperties;
import com.checkba.service.ai.skill.SkillRegistry;
import com.checkba.service.ai.skill.SkillRouter;
import com.checkba.service.telemetry.TelemetryService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class HarnessDiagnosticServiceTest {

    private ToolDisclosurePolicy disclosurePolicy;
    private SkillRegistry skillRegistry;
    private SkillRouter skillRouter;
    private HarnessDiagnosticService diagnosticService;

    @BeforeEach
    void setUp() {
        disclosurePolicy = new ToolDisclosurePolicy(true, true);
        PluginService pluginService = new PluginService();
        SkillProperties props = new SkillProperties();
        props.setDir(resolveSkillsDir());
        props.setBaseTools(List.of("extract_file_text", "list_files", "query_memory"));
        skillRegistry = new SkillRegistry(props, null, pluginService, null);
        skillRegistry.init();
        skillRouter = new SkillRouter(skillRegistry, props, Mockito.mock(TelemetryService.class), null);
        diagnosticService = new HarnessDiagnosticService(disclosurePolicy, skillRegistry, skillRouter);
    }

    @Test
    void undisclosedToolFailureTriggersInvariantCategoryExpansion() {
        Set<String> expanded = new HashSet<>();
        Optional<HarnessDiagnosticService.HarnessAdaptation> adaptation = diagnosticService.diagnoseAndAdapt(
                "conv-1",
                "run-1",
                "请在第一行下面再加一行",
                "doc_table_add_row",
                "{\"tableIndex\":0}",
                "Error: Tool not found: doc_table_add_row",
                1,
                expanded,
                List.of());

        assertTrue(adaptation.isPresent());
        assertEquals(HarnessDiagnosticService.TIER_INVARIANT, adaptation.get().tier());
        assertEquals(HarnessDiagnosticService.ACTION_EXPAND_TOOL_CATEGORY, adaptation.get().actionType());
        assertTrue(adaptation.get().expandedCategories().contains("table"));
        assertTrue(expanded.contains("table"));
    }

    @Test
    void anchorDriftErrorTriggersInvariantAnchorProbeRecovery() {
        Set<String> expanded = new HashSet<>(Set.of("edit", "revision"));
        Optional<HarnessDiagnosticService.HarnessAdaptation> adaptation = diagnosticService.diagnoseAndAdapt(
                "conv-2",
                "run-2",
                "把违约金比例改成 15%",
                "doc_replace_at_anchor",
                "{\"anchorId\":\"p12_a3\"}",
                "{\"error\":\"Anchor not found: p12_a3\"}",
                1,
                expanded,
                List.of());

        assertTrue(adaptation.isPresent());
        assertEquals(HarnessDiagnosticService.TIER_INVARIANT, adaptation.get().tier());
        assertEquals(HarnessDiagnosticService.ACTION_ANCHOR_PROBE_RECOVERY, adaptation.get().actionType());
        assertEquals("doc_replace_at_anchor", adaptation.get().toolName());
    }

    @Test
    void unactivatedDomainSkillMatchesAndMountsMidRun() {
        Set<String> expanded = new HashSet<>(Set.of("edit", "revision", "files", "legal", "evidence"));
        Optional<HarnessDiagnosticService.HarnessAdaptation> adaptation = diagnosticService.diagnoseAndAdapt(
                "conv-3",
                "run-3",
                "请全面审查这份法律意见书的事实依据与结论限定",
                "search_project_files",
                "{\"query\":\"法律意见书\"}",
                "No matches: 未找到匹配文件",
                1,
                expanded,
                List.of());

        assertTrue(adaptation.isPresent());
        assertEquals(HarnessDiagnosticService.TIER_DOMAIN, adaptation.get().tier());
        assertEquals(HarnessDiagnosticService.ACTION_MOUNT_DOMAIN_SKILL, adaptation.get().actionType());
        assertEquals("legal-opinion-review", adaptation.get().activatedSkillId());
    }

    private static String resolveSkillsDir() {
        for (String candidate : List.of("skills", "backend/skills")) {
            if (Files.isDirectory(Path.of(candidate))) {
                return candidate;
            }
        }
        return "skills";
    }
}
