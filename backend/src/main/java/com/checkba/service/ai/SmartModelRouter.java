// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ai;

import com.checkba.controller.ai.AiAgentController;
import com.checkba.model.ai.AgentMode;
import com.checkba.service.ai.skill.SkillRouter;
import org.springframework.stereotype.Service;

import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * 智能模式（Auto）的零延迟确定性路由器。
 *
 * <p>设计目标：当用户在模型选择器中选择「智能模式（{@code auto}）」时，在每轮起跑、
 * {@link SkillRouter#activateForTurn} 完成之后且 {@link ContextAssemblerService#assemble}
 * 之前，根据本轮的任务复杂度（AgentMode、激活的 Skill、上下文文档数、多模态图片、输入长度与意图关键词）
 * 以及当前出网区域（{@link AllowedModels.Region}），以 0ms 本地规则决策出本轮实际使用的模型与思考强度
 * （{@code reasoning.effort}），不增加任何前置 LLM 网络往返。
 *
 * <p>三档路由策略：
 * <ul>
 *   <li><b>{@link Tier#FAST}（极速档）</b>：简单问答、寒暄、概念解释、短文本润色/翻译、单图轻量问答。
 *       纯文本走 {@link AllowedModels#DEEPSEEK_V4_FLASH}；带图走 {@link AllowedModels#QWEN_3_7_FLASH}
 *       （境内可达）或 {@link AllowedModels#GEMINI_3_6_FLASH}（境外网络），{@code reasoning.effort = "low"}。</li>
 *   <li><b>{@link Tier#BALANCED}（均衡主力档）</b>：常规文档编辑、条款起草、单文档阅读分析、带工具调用的日常任务。
 *       纯文本走 {@link AllowedModels#DEEPSEEK_V4_PRO}；带图走 {@link AllowedModels#KIMI_K2_6}，
 *       {@code reasoning.effort = "medium"}。</li>
 *   <li><b>{@link Tier#DEEP}（深度旗舰档）</b>：{@code PLAN} 模式、命中 {@code contract-review} /
 *       {@code legal-opinion-review} 技能、多文档交叉对比（&ge;2 份上下文文档）、超长输入（&gt;1200 字）
 *       或明确要求全面审查/尽调/法律意见书。境外网络走 {@link AllowedModels#CLAUDE_SONNET_5}；
 *       境内网络带图或合同审查/多文档走 {@link AllowedModels#QWEN_3_8_MAX}，意见书审查/规划推理走
 *       {@link AllowedModels#KIMI_K3}。</li>
 * </ul>
 */
@Service
public class SmartModelRouter {

    public static final String AUTO_MODEL_ID = "auto";

    /** 与 {@link ContextAssemblerService} 保持同口径的视觉图片后缀集合。 */
    private static final Set<String> VISION_IMAGE_EXTENSIONS = Set.of(
            "png", "jpg", "jpeg", "webp", "gif", "bmp");

    /** 触发深度档（DEEP）的高复杂度法律/分析任务关键词。 */
    private static final Pattern DEEP_TASK_PATTERN = Pattern.compile(
            "(?is).*(?:合同审查|审合同|审查合同|全面审查|深度审查|逐条审查|法律意见书|出具意见|尽职调查|尽调报告|风险评估"
                    + "|起草.{0,12}(?:合同|协议|意见书|章程|招股|备忘录)|对比.{0,12}(?:合同|协议|版本|差异|条款)"
                    + "|架构设计|整体方案|深入分析|深度分析|全面分析"
                    + "|contract\\s+review|legal\\s+opinion|due\\s+diligence|comprehensive\\s+review|in-depth\\s+analysis).*");

    /** 深度档内倾向于 Kimi K3 高强度逻辑推理的意见书/论证关键词。 */
    private static final Pattern OPINION_OR_DEEP_REASONING_PATTERN = Pattern.compile(
            "(?is).*(?:法律意见书|出具意见|尽职调查|尽调报告|合规论证|法律论证|逻辑漏洞|legal\\s+opinion|due\\s+diligence).*");

    /** 触发均衡档（BALANCED）、不宜落入极速档的实质性文档操作/业务动作关键词。 */
    private static final Pattern BALANCED_TASK_PATTERN = Pattern.compile(
            "(?is).*(?:修改|修订|改写|重写|起草|撰写|草拟|补充|插入|删除|替换|批注|表格|幻灯片|演示文稿"
                    + "|全文|整篇|章节|条款|审核|审查|对比|核对|汇总|整理|提取|计算|检索|搜索|法条|案例"
                    + "|edit|modify|rewrite|draft|revise|insert|delete|replace|table|slide|clause|review|compare|extract|search).*");

    public enum Tier {
        FAST,
        BALANCED,
        DEEP
    }

    /**
     * 单轮路由决策结果。
     *
     * @param requestedModel     前端原始传入的 model 字段（例如 {@code "auto"} 或具体模型 ID）
     * @param effectiveModelId   本轮实际执行的模型 ID（必为合法白名单模型或调用方原样模型）
     * @param effectiveModelName 本轮实际执行的模型展示名
     * @param tier               命中的复杂度档位（非智能模式时为 null）
     * @param reasoningEffort    本轮建议覆盖的思考强度（{@code "low"}/{@code "medium"}/{@code "high"}，非智能模式时为 null）
     * @param routed             是否经由智能模式动态路由
     */
    public record RouteDecision(
            String requestedModel,
            String effectiveModelId,
            String effectiveModelName,
            Tier tier,
            String reasoningEffort,
            boolean routed
    ) {}

    /**
     * 判断请求是否指定了「智能模式（{@code auto}）」。
     *
     * <p>刻意只认显式的 {@code "auto"}（不把 {@code null} 或空串当成智能模式）：
     * 既有单测、后台任务与老客户端未传 model 时走 {@link ChatModelFactory#resolveDefaultModel()}，
     * 只有前端明确选择 {@code "auto"} 时才启用按轮智能路由。
     */
    public static boolean isAutoModel(String modelId) {
        return modelId != null && AUTO_MODEL_ID.equalsIgnoreCase(modelId.trim());
    }

    /**
     * 为当前对话轮次解析目标模型与思考强度。
     */
    public RouteDecision route(
            String requestedModel,
            String message,
            AgentMode agentMode,
            List<AiAgentController.ContextItem> contextItems,
            AiAgentController.ContextItem activeContext,
            List<SkillRouter.ActiveSkill> activeSkills,
            AllowedModels.Region networkRegion) {

        if (!isAutoModel(requestedModel)) {
            AllowedModels fixed = AllowedModels.fromId(requestedModel);
            String displayName = fixed != null ? fixed.getDisplayName() : (requestedModel == null ? "" : requestedModel);
            return new RouteDecision(requestedModel, requestedModel, displayName, null, null, false);
        }

        String safeMessage = message == null ? "" : message.trim();
        int msgLen = safeMessage.length();
        boolean hasImage = hasImageInput(contextItems, activeContext);
        int nonDirContextCount = countNonDirContextItems(contextItems, activeContext);
        List<SkillRouter.ActiveSkill> skills = activeSkills == null ? List.of() : activeSkills;
        AllowedModels.Region region = networkRegion != null ? networkRegion : AllowedModels.Region.GLOBAL;

        Tier tier = classifyTier(safeMessage, msgLen, agentMode, nonDirContextCount, hasImage, skills);
        AllowedModels selected = selectModel(tier, hasImage, region, agentMode, skills, safeMessage);
        String effort = selectReasoningEffort(tier, selected, skills, safeMessage);

        return new RouteDecision(
                AUTO_MODEL_ID,
                selected.getModelId(),
                selected.getDisplayName(),
                tier,
                effort,
                true
        );
    }

    private Tier classifyTier(
            String message,
            int msgLen,
            AgentMode agentMode,
            int nonDirContextCount,
            boolean hasImage,
            List<SkillRouter.ActiveSkill> skills) {

        if (agentMode == AgentMode.PLAN) {
            return Tier.DEEP;
        }
        if (hasSkill(skills, "contract-review") || hasSkill(skills, "legal-opinion-review")) {
            return Tier.DEEP;
        }
        if (nonDirContextCount >= 2 || msgLen > 1200) {
            return Tier.DEEP;
        }
        if (!message.isEmpty() && DEEP_TASK_PATTERN.matcher(message).matches()) {
            return Tier.DEEP;
        }

        if (skills.isEmpty() && (message.isEmpty() || !BALANCED_TASK_PATTERN.matcher(message).matches())) {
            if (nonDirContextCount == 0 && msgLen <= 120) {
                return Tier.FAST;
            }
            if (agentMode == AgentMode.ASK && nonDirContextCount <= 1 && msgLen <= 80) {
                return Tier.FAST;
            }
            if (hasImage && nonDirContextCount == 1 && msgLen <= 60) {
                return Tier.FAST;
            }
        }

        return Tier.BALANCED;
    }

    private AllowedModels selectModel(
            Tier tier,
            boolean hasImage,
            AllowedModels.Region region,
            AgentMode agentMode,
            List<SkillRouter.ActiveSkill> skills,
            String message) {

        boolean international = region == AllowedModels.Region.INTERNATIONAL;
        return switch (tier) {
            case FAST -> {
                if (!hasImage) {
                    yield AllowedModels.DEEPSEEK_V4_FLASH;
                }
                yield international ? AllowedModels.GEMINI_3_6_FLASH : AllowedModels.QWEN_3_7_FLASH;
            }
            case BALANCED -> hasImage ? AllowedModels.KIMI_K2_6 : AllowedModels.DEEPSEEK_V4_PRO;
            case DEEP -> {
                if (international) {
                    yield AllowedModels.CLAUDE_SONNET_5;
                }
                if (hasImage) {
                    yield AllowedModels.QWEN_3_8_MAX;
                }
                if (hasSkill(skills, "legal-opinion-review")
                        || agentMode == AgentMode.PLAN
                        || (!message.isEmpty() && OPINION_OR_DEEP_REASONING_PATTERN.matcher(message).matches())) {
                    yield AllowedModels.KIMI_K3;
                }
                yield AllowedModels.QWEN_3_8_MAX;
            }
        };
    }

    private String selectReasoningEffort(
            Tier tier,
            AllowedModels selected,
            List<SkillRouter.ActiveSkill> skills,
            String message) {

        return switch (tier) {
            case FAST -> "low";
            case BALANCED -> "medium";
            case DEEP -> {
                if (selected == AllowedModels.KIMI_K3
                        && (hasSkill(skills, "legal-opinion-review")
                        || (!message.isEmpty() && OPINION_OR_DEEP_REASONING_PATTERN.matcher(message).matches()))) {
                    yield "high";
                }
                yield "medium";
            }
        };
    }

    private static boolean hasSkill(List<SkillRouter.ActiveSkill> skills, String skillId) {
        if (skills == null || skills.isEmpty() || skillId == null) {
            return false;
        }
        for (SkillRouter.ActiveSkill skill : skills) {
            if (skill != null && skill.definition() != null
                    && skillId.equalsIgnoreCase(skill.definition().getId())) {
                return true;
            }
        }
        return false;
    }

    static boolean hasImageInput(
            List<AiAgentController.ContextItem> contextItems,
            AiAgentController.ContextItem activeContext) {

        if (contextItems != null) {
            for (AiAgentController.ContextItem item : contextItems) {
                if (item != null && !item.isDir() && isVisionCandidate(item)) {
                    return true;
                }
            }
        }
        return activeContext != null
                && !activeContext.isDir()
                && isVisionCandidate(activeContext);
    }

    private static boolean isVisionCandidate(AiAgentController.ContextItem item) {
        if (item == null || item.getId() == null || item.getId().isBlank()) {
            return false;
        }
        String name = item.getName();
        if (name != null) {
            int dot = name.lastIndexOf('.');
            if (dot >= 0 && dot < name.length() - 1) {
                return VISION_IMAGE_EXTENSIONS.contains(
                        name.substring(dot + 1).toLowerCase(Locale.ROOT));
            }
        }
        return "image".equalsIgnoreCase(item.getFileType());
    }

    private static int countNonDirContextItems(
            List<AiAgentController.ContextItem> contextItems,
            AiAgentController.ContextItem activeContext) {

        Set<String> ids = new HashSet<>();
        int anonymousCount = 0;
        if (contextItems != null) {
            for (AiAgentController.ContextItem item : contextItems) {
                if (item == null || item.isDir()) {
                    continue;
                }
                if (item.getId() != null && !item.getId().isBlank()) {
                    ids.add(item.getId().trim());
                } else {
                    anonymousCount++;
                }
            }
        }
        if (activeContext != null
                && !activeContext.isDir()
                && activeContext.getId() != null
                && !activeContext.getId().isBlank()) {
            ids.add(activeContext.getId().trim());
        }
        return ids.size() + anonymousCount;
    }
}
