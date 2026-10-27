// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ai;

import com.checkba.controller.ai.AiAgentController;
import com.checkba.model.ai.AgentMode;
import com.checkba.service.ai.skill.SkillDefinition;
import com.checkba.service.ai.skill.SkillRouter;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/**
 * {@link SmartModelRouter} 单元测试：验证三档（FAST / BALANCED / DEEP）、多模态视觉切换、
 * 境内外网络区域（GLOBAL / INTERNATIONAL）以及非 auto 直通契约。
 */
class SmartModelRouterTest {

    private final SmartModelRouter router = new SmartModelRouter();

    private static AiAgentController.ContextItem fileItem(String id, String name, String fileType) {
        AiAgentController.ContextItem item = new AiAgentController.ContextItem();
        item.setId(id);
        item.setName(name);
        item.setFileType(fileType);
        item.setIsDir(false);
        return item;
    }

    private static SkillRouter.ActiveSkill activeSkill(String id) {
        SkillDefinition def = new SkillDefinition();
        def.setId(id);
        def.setName(id);
        return new SkillRouter.ActiveSkill(def, id, SkillRouter.SOURCE_AUTO);
    }

    @Test
    @DisplayName("非 auto 模型原样直通：不触发路由、不覆盖 reasoningEffort")
    void explicitModelPassesThroughUnchanged() {
        SmartModelRouter.RouteDecision d = router.route(
                "moonshotai/kimi-k3",
                "帮我做一份全面合同审查",
                AgentMode.AGENT,
                List.of(),
                null,
                List.of(),
                AllowedModels.Region.GLOBAL);

        assertFalse(d.routed());
        assertEquals("moonshotai/kimi-k3", d.effectiveModelId());
        assertEquals("Kimi K3", d.effectiveModelName());
        assertNull(d.tier());
        assertNull(d.reasoningEffort());
    }

    @Test
    @DisplayName("FAST 极速档（纯文本）：无文档的轻量问答路由到 DeepSeek V4 Flash + low effort")
    void simpleTextQuestionRoutesToFastFlash() {
        SmartModelRouter.RouteDecision d = router.route(
                "auto",
                "什么是不可抗力？请用两句话解释。",
                AgentMode.AGENT,
                List.of(),
                null,
                List.of(),
                AllowedModels.Region.GLOBAL);

        assertTrue(d.routed());
        assertEquals(SmartModelRouter.Tier.FAST, d.tier());
        assertEquals(AllowedModels.DEEPSEEK_V4_FLASH.getModelId(), d.effectiveModelId());
        assertEquals("low", d.reasoningEffort());
    }

    @Test
    @DisplayName("FAST 极速档（带图）：单图短问在 GLOBAL 下路由到 Qwen 3.7 Flash，INTERNATIONAL 下路由到 Gemini 3.6 Flash")
    void simpleVisionQuestionRoutesToFastVisionModelByRegion() {
        AiAgentController.ContextItem img = fileItem("101", "seal.png", "image");

        SmartModelRouter.RouteDecision global = router.route(
                "auto",
                "这张图里的公章名称是什么？",
                AgentMode.ASK,
                List.of(img),
                null,
                List.of(),
                AllowedModels.Region.GLOBAL);
        assertTrue(global.routed());
        assertEquals(SmartModelRouter.Tier.FAST, global.tier());
        assertEquals(AllowedModels.QWEN_3_7_FLASH.getModelId(), global.effectiveModelId());
        assertEquals("low", global.reasoningEffort());

        SmartModelRouter.RouteDecision intl = router.route(
                "auto",
                "这张图里的公章名称是什么？",
                AgentMode.ASK,
                List.of(img),
                null,
                List.of(),
                AllowedModels.Region.INTERNATIONAL);
        assertTrue(intl.routed());
        assertEquals(SmartModelRouter.Tier.FAST, intl.tier());
        assertEquals(AllowedModels.GEMINI_3_6_FLASH.getModelId(), intl.effectiveModelId());
        assertEquals("low", intl.reasoningEffort());
    }

    @Test
    @DisplayName("BALANCED 均衡档：常规文档修改与条款起草路由到 DeepSeek V4 Pro（带图路由到 Kimi K2.6）")
    void standardDocumentEditingRoutesToBalancedProOrKimiVision() {
        AiAgentController.ContextItem doc = fileItem("201", "采购协议.docx", "word");

        SmartModelRouter.RouteDecision textEdit = router.route(
                "auto",
                "把第三条违约金比例修改为合同总额的 10%",
                AgentMode.AGENT,
                List.of(),
                doc,
                List.of(),
                AllowedModels.Region.GLOBAL);
        assertTrue(textEdit.routed());
        assertEquals(SmartModelRouter.Tier.BALANCED, textEdit.tier());
        assertEquals(AllowedModels.DEEPSEEK_V4_PRO.getModelId(), textEdit.effectiveModelId());
        assertEquals("medium", textEdit.reasoningEffort());

        AiAgentController.ContextItem scanImg = fileItem("202", "营业执照.jpg", "image");
        SmartModelRouter.RouteDecision visionEdit = router.route(
                "auto",
                "提取图片里的公司名称和统一社会信用代码，整理成表格",
                AgentMode.AGENT,
                List.of(scanImg),
                null,
                List.of(),
                AllowedModels.Region.GLOBAL);
        assertTrue(visionEdit.routed());
        assertEquals(SmartModelRouter.Tier.BALANCED, visionEdit.tier());
        assertEquals(AllowedModels.KIMI_K2_6.getModelId(), visionEdit.effectiveModelId());
        assertEquals("medium", visionEdit.reasoningEffort());
    }

    @Test
    @DisplayName("DEEP 深度档（GLOBAL）：合同审查与多文档对比路由到 Qwen 3.8 Max；意见书审查与 PLAN 模式路由到 Kimi K3")
    void deepTasksRouteBetweenQwenMaxAndKimiK3InGlobalRegion() {
        AiAgentController.ContextItem doc = fileItem("301", "技术服务合同.docx", "word");

        SmartModelRouter.RouteDecision contractReview = router.route(
                "auto",
                "帮我审查这份合同的风险",
                AgentMode.AGENT,
                List.of(),
                doc,
                List.of(activeSkill("contract-review")),
                AllowedModels.Region.GLOBAL);
        assertTrue(contractReview.routed());
        assertEquals(SmartModelRouter.Tier.DEEP, contractReview.tier());
        assertEquals(AllowedModels.QWEN_3_8_MAX.getModelId(), contractReview.effectiveModelId());
        assertEquals("medium", contractReview.reasoningEffort());

        SmartModelRouter.RouteDecision opinionReview = router.route(
                "auto",
                "对这份法律意见书做实质审查",
                AgentMode.AGENT,
                List.of(),
                doc,
                List.of(activeSkill("legal-opinion-review")),
                AllowedModels.Region.GLOBAL);
        assertTrue(opinionReview.routed());
        assertEquals(SmartModelRouter.Tier.DEEP, opinionReview.tier());
        assertEquals(AllowedModels.KIMI_K3.getModelId(), opinionReview.effectiveModelId());
        assertEquals("high", opinionReview.reasoningEffort());

        SmartModelRouter.RouteDecision planMode = router.route(
                "auto",
                "帮我规划整套交易文件的修订步骤",
                AgentMode.PLAN,
                List.of(),
                doc,
                List.of(),
                AllowedModels.Region.GLOBAL);
        assertTrue(planMode.routed());
        assertEquals(SmartModelRouter.Tier.DEEP, planMode.tier());
        assertEquals(AllowedModels.KIMI_K3.getModelId(), planMode.effectiveModelId());
        assertEquals("medium", planMode.reasoningEffort());
    }

    @Test
    @DisplayName("DEEP 深度档（INTERNATIONAL）：境外网络下深度任务路由到 Claude Sonnet 5")
    void deepTaskInInternationalRegionRoutesToClaudeSonnet5() {
        AiAgentController.ContextItem doc1 = fileItem("401", "协议A.docx", "word");
        AiAgentController.ContextItem doc2 = fileItem("402", "协议B.docx", "word");

        SmartModelRouter.RouteDecision decision = router.route(
                "auto",
                "对比这两份协议的违约责任条款差异",
                AgentMode.AGENT,
                List.of(doc1, doc2),
                null,
                List.of(),
                AllowedModels.Region.INTERNATIONAL);

        assertTrue(decision.routed());
        assertEquals(SmartModelRouter.Tier.DEEP, decision.tier());
        assertEquals(AllowedModels.CLAUDE_SONNET_5.getModelId(), decision.effectiveModelId());
        assertEquals("medium", decision.reasoningEffort());
    }
}
