// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ai.harness;

import com.checkba.service.ai.PluginService;
import com.checkba.service.ai.skill.SkillDefinition;
import com.checkba.service.ai.skill.SkillProperties;
import com.checkba.service.ai.skill.SkillRegistry;
import com.checkba.service.ai.skill.SkillRouter;
import com.checkba.service.ai.subagent.SubAgentResult;
import com.checkba.service.telemetry.TelemetryService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class VerificationHarnessTest {

    private SkillRegistry skillRegistry;
    private SkillRouter skillRouter;
    private VerificationHarness verificationHarness;

    @BeforeEach
    void setUp() {
        PluginService pluginService = new PluginService();
        SkillProperties props = new SkillProperties();
        props.setDir(resolveSkillsDir());
        props.setBaseTools(List.of("extract_file_text", "list_files", "query_memory"));
        skillRegistry = new SkillRegistry(props, null, pluginService, null);
        skillRegistry.init();
        skillRouter = new SkillRouter(skillRegistry, props, Mockito.mock(TelemetryService.class), null);
        verificationHarness = new VerificationHarness(skillRouter);
    }

    @Test
    void builtinLegalOpinionReviewSkillDeclaresSlotEvidenceChallengerPolicy() {
        Optional<SkillDefinition> skill = skillRegistry.getSkill("legal-opinion-review");
        assertTrue(skill.isPresent());
        assertEquals(SkillDefinition.VerificationPolicy.SLOT_EVIDENCE_CHALLENGER, skill.get().getVerificationPolicy());
    }

    @Test
    void activeSkillWithPolicyResolvesThroughVerificationHarness() {
        skillRouter.activateForTurn("conv-verify-1", "run-verify-1", "请审查这份法律意见书的事实依据");
        Optional<SkillDefinition> activeSkill = verificationHarness.resolveChallengerSkill(skillRouter, "run-verify-1");
        assertTrue(activeSkill.isPresent());
        assertEquals("legal-opinion-review", activeSkill.get().getId());
    }

    @Test
    void buildReportExtractsStructuredCountsAndItems() {
        String findings = """
                1. 【命题 1】目标公司已取得全部环保批复
                - 证据槽：环保批复取得状态 -> 未找到
                - 整句判定：待核实

                2. 【命题 2】转让价款为 5000 万元
                - 证据槽：《股权转让协议》第 3 条记载为 3500 万元
                - 整句判定：冲突

                3. 【命题 3】目标公司成立于 2018 年
                - 证据槽：营业执照副本「成立日期：2018年05月12日」
                - 整句判定：有依据
                """;
        SubAgentResult result = SubAgentResult.success("sub-1", findings, List.of(), 3);

        VerificationHarness.VerificationReport report = verificationHarness.buildReport(
                "legal-opinion-review", "法律意见书审查", 99L, "法律意见书.docx", result);

        assertEquals(VerificationHarness.STATUS_GAPS_FOUND, report.status());
        assertEquals(1, report.supportedCount());
        assertEquals(1, report.unverifiedCount());
        assertEquals(1, report.conflictCount());
        assertEquals(3, report.totalChecked());
        assertEquals(3, report.items().size());
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
