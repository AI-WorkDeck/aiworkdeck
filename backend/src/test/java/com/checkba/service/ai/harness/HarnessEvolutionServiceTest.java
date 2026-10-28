// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ai.harness;

import com.checkba.service.ai.PluginService;
import com.checkba.service.ai.memory.document.MemoryDocumentService;
import com.checkba.service.ai.memory.document.MemoryFileView;
import com.checkba.service.ai.memory.document.MemorySpaceView;
import com.checkba.service.ai.skill.SkillDefinition;
import com.checkba.service.ai.skill.SkillProperties;
import com.checkba.service.ai.skill.SkillRegistry;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class HarnessEvolutionServiceTest {

    @TempDir
    Path tempSkillsDir;

    private MemoryDocumentService memoryDocumentService;
    private SkillRegistry skillRegistry;
    private SkillProperties skillProperties;
    private HarnessEvolutionService evolutionService;

    @BeforeEach
    void setUp() {
        memoryDocumentService = mock(MemoryDocumentService.class);
        MemorySpaceView projectSpace = new MemorySpaceView(
                "project:10", "project", "当前项目记忆", true, true, true, null);
        MemorySpaceView userSpace = new MemorySpaceView(
                "user:7", "user", "个人记忆", true, true, true, null);

        when(memoryDocumentService.listSpaces(eq(7L), eq(10L))).thenReturn(List.of(projectSpace, userSpace));
        when(memoryDocumentService.write(eq(7L), anyString(), anyString(), anyString(), anyLong()))
                .thenAnswer(inv -> new MemoryFileView(
                        inv.getArgument(2),
                        "title",
                        inv.getArgument(3),
                        1L,
                        LocalDateTime.now(),
                        true));

        skillProperties = new SkillProperties();
        skillProperties.setDir(tempSkillsDir.toString());
        skillProperties.setBaseTools(List.of("extract_file_text", "list_files", "query_memory"));
        skillRegistry = new SkillRegistry(skillProperties, null, new PluginService(), null);
        skillRegistry.init();

        evolutionService = new HarnessEvolutionService(memoryDocumentService, skillRegistry, skillProperties);
    }

    @Test
    void rollbackContrastSynthesizesEvolutionRecordAndWritesMemoryTopic() {
        evolutionService.recordRollbackSignal(
                "conv-evo-1",
                7L,
                10L,
                "审查这份股权转让协议",
                "以下是初步审查结论：无重大风险。");

        Optional<HarnessEvolutionService.PendingRollbackSignal> pending =
                evolutionService.consumePendingRollback("conv-evo-1");
        assertTrue(pending.isPresent());

        Optional<HarnessEvolutionService.HarnessEvolutionRecord> recordOpt =
                evolutionService.evaluateTurnEvolution(
                        "conv-evo-1",
                        7L,
                        10L,
                        "审查这份股权转让协议，注意违约金条款必须结合补充协议二核对，不要直接下无风险结论",
                        pending.get(),
                        List.of(),
                        List.of());

        assertTrue(recordOpt.isPresent());
        HarnessEvolutionService.HarnessEvolutionRecord record = recordOpt.get();
        assertEquals(HarnessEvolutionService.SIGNAL_ROLLBACK_CORRECTION, record.signalType());
        assertEquals(HarnessEvolutionService.CATEGORY_DOMAIN, record.category());
        assertEquals("project", record.scope());
        assertEquals("project:10", record.memorySpaceId());
        assertTrue(record.memoryPath().startsWith("topics/harness-evo-"));
        verify(memoryDocumentService).write(
                eq(7L),
                eq("project:10"),
                eq(record.memoryPath()),
                anyString(),
                eq(0L));
    }

    @Test
    void switchScopeAndPromoteToSkillUpdatesRegistryAndDeletesOnRevert() {
        Optional<HarnessEvolutionService.HarnessEvolutionRecord> recordOpt =
                evolutionService.evaluateTurnEvolution(
                        "conv-evo-2",
                        7L,
                        10L,
                        "起草保密协议",
                        null,
                        List.of("以后所有「保密协议」的管辖条款一律写北京仲裁委员会，不要写法院诉讼"),
                        List.of());

        assertTrue(recordOpt.isPresent());
        String id = recordOpt.get().id();

        HarnessEvolutionService.HarnessEvolutionRecord switched =
                evolutionService.switchScope(7L, id, "user");
        assertEquals("user", switched.scope());
        assertEquals("user:7", switched.memorySpaceId());

        HarnessEvolutionService.HarnessEvolutionRecord promoted =
                evolutionService.promoteToSkill(
                        7L,
                        id,
                        "保密协议北仲管辖规范",
                        List.of("保密协议", "NDA"),
                        null,
                        "slot_evidence_challenger");
        assertNotNull(promoted.promotedSkillId());
        assertEquals(HarnessEvolutionService.STATUS_PROMOTED_SKILL, promoted.status());

        Optional<SkillDefinition> registeredSkill = skillRegistry.getSkill(promoted.promotedSkillId());
        assertTrue(registeredSkill.isPresent());
        assertEquals(SkillDefinition.VerificationPolicy.SLOT_EVIDENCE_CHALLENGER,
                registeredSkill.get().getVerificationPolicy());

        HarnessEvolutionService.HarnessEvolutionRecord reverted = evolutionService.revertEvolution(7L, id);
        assertEquals(HarnessEvolutionService.STATUS_REVERTED, reverted.status());
        assertTrue(skillRegistry.getSkill(promoted.promotedSkillId()).isEmpty());
    }

    @Test
    void invariantToolAdaptationIsIgnoredAndNeverPollutesMemory() {
        HarnessDiagnosticService.HarnessAdaptation expandFiles = new HarnessDiagnosticService.HarnessAdaptation(
                "ha-expand-files",
                HarnessDiagnosticService.TIER_INVARIANT,
                HarnessDiagnosticService.ACTION_EXPAND_TOOL_CATEGORY,
                "list_files",
                "Harness 自愈：自动展开工具类目 [files]",
                "归因 [INVARIANT / 工具可见性]：当前步骤涉及尚未展开的专项工具类目（files）。",
                "[Harness 运行期自愈] 已为你动态展开工具类目 [files]。",
                List.of("files"),
                null,
                System.currentTimeMillis());

        Optional<HarnessEvolutionService.HarnessEvolutionRecord> recordOpt =
                evolutionService.evaluateTurnEvolution(
                        "conv-ppt-1",
                        7L,
                        10L,
                        "帮我做一个解释这个案子进展的PPT",
                        null,
                        List.of(),
                        List.of(expandFiles));

        assertTrue(recordOpt.isEmpty(), "底层工具类目展开属于单轮内部自愈，绝不应沉淀为用户记忆或弹窗打扰用户");
        verify(memoryDocumentService, never()).write(anyLong(), anyString(), anyString(), anyString(), anyLong());
    }

    @Test
    void autonomousJudgmentInfersUserScopeAndAutoPromotesDomainSkill() {
        Optional<HarnessEvolutionService.HarnessEvolutionRecord> recordOpt =
                evolutionService.evaluateTurnEvolution(
                        "conv-auto-skill",
                        7L,
                        10L,
                        "审查担保条款",
                        null,
                        List.of("以后所有「对外担保条款」审查规范一律先核验股东会决议证据，缺失必须标为待核实"),
                        List.of());

        assertTrue(recordOpt.isPresent());
        HarnessEvolutionService.HarnessEvolutionRecord record = recordOpt.get();
        assertEquals("user", record.scope(), "跨项目通用规范应自动判定为 user 全局作用域");
        assertEquals("user:7", record.memorySpaceId());
        assertEquals(HarnessEvolutionService.STATUS_PROMOTED_SKILL, record.status(), "跨项目领域规范应自动升格为专属技能");
        assertNotNull(record.promotedSkillId());
        assertTrue(skillRegistry.getSkill(record.promotedSkillId()).isPresent());
    }
}
