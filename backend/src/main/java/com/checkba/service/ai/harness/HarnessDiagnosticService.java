// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ai.harness;

import com.checkba.service.LangText;
import com.checkba.service.ai.ToolDisclosurePolicy;
import com.checkba.service.ai.skill.SkillDefinition;
import com.checkba.service.ai.skill.SkillRegistry;
import com.checkba.service.ai.skill.SkillRouter;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.lang.Nullable;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

/**
 * Harness 运行期双层故障归因与自愈控制器（对齐 Google Harness² 的 Invariant vs. Domain 归因哲学
 * 与 Propose–Probe–Compose 闭环，dev-board#1481）。
 *
 * <p>与只做通用警告的 {@code StuckDetector} 不同，本服务在工具调用失败或连续空转时执行任务级分诊：
 * <ul>
 *   <li><b>INVARIANT（通用不变式层）</b>：
 *     <ol>
 *       <li>{@link #ACTION_EXPAND_TOOL_CATEGORY}：因渐进披露或活跃文档类型裁剪导致所需工具类目未展开时，
 *           自动放回对应类目并通知下一轮直接调用；</li>
 *       <li>{@link #ACTION_ANCHOR_PROBE_RECOVERY}：文档编辑/替换因锚点偏移或原文不匹配失败时，
 *           注入强制回读探针（Read-back Probe）处方，禁止盲目重试同一替换参数。</li>
 *     </ol>
 *   </li>
 *   <li><b>DOMAIN（领域知识层）</b>：
 *     <ol>
 *       <li>{@link #ACTION_MOUNT_DOMAIN_SKILL}：任务上下文命中某个尚未激活的领域 Skill 时，
 *           运行期动态挂载该 Skill 并展开其工具白名单类目；</li>
 *       <li>{@link #ACTION_CLARIFY_WITH_USER}：检索/读取连续未命中且缺关键事实依据时，
 *           处方立即通过 {@code ask_user} 向用户反问确认，阻断无依据脑补。</li>
 *     </ol>
 *   </li>
 * </ul>
 */
@Service
public class HarnessDiagnosticService {

    public static final String TIER_INVARIANT = "INVARIANT";
    public static final String TIER_DOMAIN = "DOMAIN";

    public static final String ACTION_EXPAND_TOOL_CATEGORY = "EXPAND_TOOL_CATEGORY";
    public static final String ACTION_ANCHOR_PROBE_RECOVERY = "ANCHOR_PROBE_RECOVERY";
    public static final String ACTION_MOUNT_DOMAIN_SKILL = "MOUNT_DOMAIN_SKILL";
    public static final String ACTION_CLARIFY_WITH_USER = "CLARIFY_WITH_USER";

    private static final Set<String> DOC_EDIT_TOOLS = Set.of(
            "doc_find_replace", "doc_replace_at_anchor", "doc_modify_paragraph",
            "doc_replace_selection", "doc_replace_nth_match", "doc_delete_match",
            "office_replace_text", "office_replace_batch", "sheet_find_replace",
            "slide_replace_text", "office_ppt_replace_text");

    private static final Set<String> SEARCH_LOOKUP_TOOLS = Set.of(
            "search_project_files", "search_project_content", "law_search",
            "law_search_keyword", "get_law_article", "extract_file_text", "ref_read");

    /**
     * 一次运行期自愈动作的结构化记录（同时作为 SSE {@code harness_adaptation} 的载荷）。
     */
    public record HarnessAdaptation(
            String id,
            String tier,
            String actionType,
            String toolName,
            String title,
            String diagnosis,
            String prescription,
            List<String> expandedCategories,
            String activatedSkillId,
            long timestamp
    ) {
    }

    private final ToolDisclosurePolicy toolDisclosurePolicy;
    private final SkillRegistry skillRegistry;
    private final SkillRouter skillRouter;

    public HarnessDiagnosticService() {
        this(new ToolDisclosurePolicy(true, true), null, null);
    }

    @Autowired
    public HarnessDiagnosticService(
            @Nullable ToolDisclosurePolicy toolDisclosurePolicy,
            @Nullable SkillRegistry skillRegistry,
            @Nullable SkillRouter skillRouter) {
        this.toolDisclosurePolicy = toolDisclosurePolicy != null
                ? toolDisclosurePolicy
                : new ToolDisclosurePolicy(true, true);
        this.skillRegistry = skillRegistry;
        this.skillRouter = skillRouter;
    }

    /**
     * 在工具调用失败或连续受阻时执行 Invariant vs. Domain 归因并直接施加运行期修正（Probe + Compose）。
     *
     * @param conversationId         会话 ID
     * @param runId                  当前轮次 ID
     * @param userInstruction        本轮用户指令
     * @param failedToolName         失败的工具名
     * @param toolArgsSummary        工具参数摘要
     * @param resultText             失败/报错的工具返回文本
     * @param consecutiveFailures    当前连续失败次数
     * @param expandedToolCategories 当前已展开的工具类目集合（可就地扩充）
     * @param existingAdaptations    本轮已执行过的自愈记录（避免同一处方重复触发）
     * @return 若触发了具体自愈动作则返回 {@link HarnessAdaptation}，否则返回 empty
     */
    public Optional<HarnessAdaptation> diagnoseAndAdapt(
            String conversationId,
            String runId,
            String userInstruction,
            String failedToolName,
            String toolArgsSummary,
            String resultText,
            int consecutiveFailures,
            Set<String> expandedToolCategories,
            List<HarnessAdaptation> existingAdaptations) {

        if (failedToolName == null && (resultText == null || resultText.isBlank())) {
            return Optional.empty();
        }
        String safeTool = failedToolName == null ? "" : failedToolName.trim();
        String safeResult = resultText == null ? "" : resultText;
        String combinedContext = (userInstruction == null ? "" : userInstruction)
                + " " + (toolArgsSummary == null ? "" : toolArgsSummary)
                + " " + safeResult;

        // 1. INVARIANT 层：文档锚点/原文替换未命中时，优先注入回读探针（Anchor Probe Recovery）
        if (DOC_EDIT_TOOLS.contains(safeTool) && isAnchorOrMatchMiss(safeResult)
                && !alreadyTriggered(existingAdaptations, ACTION_ANCHOR_PROBE_RECOVERY, safeTool)) {
            if (expandedToolCategories != null) {
                expandedToolCategories.add("edit");
            }
            boolean officeTool = safeTool.startsWith("office_");
            String probeTools = officeTool
                    ? "office_get_text / office_search"
                    : "doc_get_document_text / doc_find_text / doc_get_paragraph";
            String title = LangText.of(
                    "Harness 自愈：触发文档回读探针（" + safeTool + "）",
                    "Harness Self-Healing: Triggered document read-back probe (" + safeTool + ")");
            String diagnosis = LangText.of(
                    "归因 [INVARIANT / 锚点偏移]：" + safeTool + " 未能命中目标文本或段落锚点（文档可能已被前序步骤修改或包含隐藏格式）。",
                    "Triage [INVARIANT / Anchor Drift]: " + safeTool + " missed the target text or paragraph anchor.");
            String prescription = LangText.of(
                    "[Harness 探针处方] 严禁使用相同参数再次调用 " + safeTool + "。请先调用只读探针（" + probeTools
                            + "）定位目标段落的最新原文与精确锚点，再基于回读到的真实字面值执行替换。",
                    "[Harness Probe Prescription] Do NOT retry " + safeTool + " with identical arguments. First run a read-back probe ("
                            + probeTools + ") to fetch the exact current text/anchor, then compose the edit.");
            return Optional.of(new HarnessAdaptation(
                    shortId(),
                    TIER_INVARIANT,
                    ACTION_ANCHOR_PROBE_RECOVERY,
                    safeTool,
                    title,
                    diagnosis,
                    prescription,
                    List.of("edit"),
                    null,
                    System.currentTimeMillis()));
        }

        // 2. INVARIANT 层：检查是否需要展开尚未披露的工具类目
        Set<String> candidateCategories = new LinkedHashSet<>();
        if (!safeTool.isEmpty()) {
            String toolCategory = toolDisclosurePolicy.categoryOf(safeTool);
            if (!"core".equals(toolCategory) && !ToolDisclosurePolicy.FALLBACK_CATEGORY.equals(toolCategory)) {
                candidateCategories.add(toolCategory);
            }
        }
        candidateCategories.addAll(toolDisclosurePolicy.categoriesHintedBy(combinedContext));
        if (DOC_EDIT_TOOLS.contains(safeTool)) {
            candidateCategories.add("edit");
        }
        if (expandedToolCategories != null) {
            candidateCategories.removeAll(expandedToolCategories);
        }
        if (!candidateCategories.isEmpty() && !alreadyTriggered(existingAdaptations, ACTION_EXPAND_TOOL_CATEGORY, safeTool)) {
            List<String> newlyExpanded = new ArrayList<>(candidateCategories);
            if (expandedToolCategories != null) {
                expandedToolCategories.addAll(newlyExpanded);
            }
            String catsJoined = String.join(", ", newlyExpanded);
            String title = LangText.of(
                    "Harness 自愈：自动展开工具类目 [" + catsJoined + "]",
                    "Harness Self-Healing: Expanded tool category [" + catsJoined + "]");
            String diagnosis = LangText.of(
                    "归因 [INVARIANT / 工具可见性]：当前步骤涉及尚未展开的专项工具类目（" + catsJoined + "）。",
                    "Triage [INVARIANT / Tool Visibility]: Current step requires unexpanded tool category (" + catsJoined + ").");
            String prescription = LangText.of(
                    "[Harness 运行期自愈] 已为你动态展开工具类目 [" + catsJoined + "]。下一轮可直接调用该类目下的专项工具，无需再调 list_tools 查询。",
                    "[Harness Runtime Adaptation] Tool category [" + catsJoined + "] has been automatically expanded for the next turn; invoke the specialized tools directly without calling list_tools.");
            return Optional.of(new HarnessAdaptation(
                    shortId(),
                    TIER_INVARIANT,
                    ACTION_EXPAND_TOOL_CATEGORY,
                    safeTool,
                    title,
                    diagnosis,
                    prescription,
                    newlyExpanded,
                    null,
                    System.currentTimeMillis()));
        }

        // 3. DOMAIN 层：检查任务上下文是否命中尚未激活的领域 Skill，动态挂载其领域指引与白名单类目
        Optional<SkillDefinition> matchedDomainSkill = findUnactivatedDomainSkill(runId, combinedContext);
        if (matchedDomainSkill.isPresent()
                && !alreadyTriggered(existingAdaptations, ACTION_MOUNT_DOMAIN_SKILL, matchedDomainSkill.get().getId())) {
            SkillDefinition skill = matchedDomainSkill.get();
            if (skillRouter != null && runId != null) {
                skillRouter.activateMidRun(conversationId, runId, skill.getId());
            }
            Set<String> skillCategories = toolDisclosurePolicy.categoriesCoveredBy(skill.getAllowedTools());
            List<String> newlyExpanded = new ArrayList<>();
            if (expandedToolCategories != null && !skillCategories.isEmpty()) {
                for (String cat : skillCategories) {
                    if (expandedToolCategories.add(cat)) {
                        newlyExpanded.add(cat);
                    }
                }
            }
            String displayName = skillRouter != null ? skillRouter.displayName(skill)
                    : (skill.getName() != null ? skill.getName() : skill.getId());
            String title = LangText.of(
                    "Harness 自愈：动态挂载领域技能「" + displayName + "」",
                    "Harness Self-Healing: Dynamically mounted domain skill \"" + displayName + "\"");
            String diagnosis = LangText.of(
                    "归因 [DOMAIN / 领域流程缺失]：当前任务涉及「" + displayName + "」领域规范，已自动切入对应工作流。",
                    "Triage [DOMAIN / Missing Domain Workflow]: Task matches domain skill \"" + displayName + "\"; mounted mid-run.");
            String snippet = skillRouter != null
                    ? truncate(skillRouter.skillInstructionsFor(skill), 600)
                    : truncate(skill.getPromptTemplate(), 600);
            String prescription = LangText.of(
                    "[Harness 领域挂载] 已自动为你启用技能「" + displayName + "」（" + skill.getId() + "），请遵循以下领域核心约束继续：\n" + snippet,
                    "[Harness Domain Mount] Activated domain skill \"" + displayName + "\" (" + skill.getId() + "). Follow its core domain guidance:\n" + snippet);
            return Optional.of(new HarnessAdaptation(
                    shortId(),
                    TIER_DOMAIN,
                    ACTION_MOUNT_DOMAIN_SKILL,
                    safeTool,
                    title,
                    diagnosis,
                    prescription,
                    newlyExpanded,
                    skill.getId(),
                    System.currentTimeMillis()));
        }

        // 4. DOMAIN 层：连续检索/查找无结果或累计失败 >= 2 次时，处方立即向用户澄清而非盲猜
        if ((SEARCH_LOOKUP_TOOLS.contains(safeTool) || consecutiveFailures >= 2)
                && !alreadyTriggered(existingAdaptations, ACTION_CLARIFY_WITH_USER, safeTool)) {
            String title = LangText.of(
                    "Harness 自愈：阻断盲目重试，切换为证据缺口澄清",
                    "Harness Self-Healing: Halted blind retries, switched to evidence-gap clarification");
            String diagnosis = LangText.of(
                    "归因 [DOMAIN / 事实依据缺失]：工具 " + safeTool + " 连续未能取得预期材料或返回错误（连续失败 " + consecutiveFailures + " 次）。",
                    "Triage [DOMAIN / Evidence Gap]: Tool " + safeTool + " repeatedly failed or returned no matching material (" + consecutiveFailures + " consecutive failures).");
            String prescription = LangText.of(
                    "[Harness 领域护栏] 不要继续盲目猜测关键词重试，也严禁在缺少依据的情况下编造事实。请立即调用 ask_user 向用户确认目标文件位置或补充事实依据，或在交付中明确将该事项标为「待核实」。",
                    "[Harness Domain Guardrail] Stop blind retries and never fabricate unsupported facts. Call ask_user to clarify the target file/fact with the user, or explicitly mark the item as unverified.");
            return Optional.of(new HarnessAdaptation(
                    shortId(),
                    TIER_DOMAIN,
                    ACTION_CLARIFY_WITH_USER,
                    safeTool,
                    title,
                    diagnosis,
                    prescription,
                    List.of(),
                    null,
                    System.currentTimeMillis()));
        }

        return Optional.empty();
    }

    private Optional<SkillDefinition> findUnactivatedDomainSkill(String runId, String contextText) {
        if (skillRegistry == null || contextText == null || contextText.isBlank()) {
            return Optional.empty();
        }
        String normalized = contextText.toLowerCase(Locale.ROOT);
        // 与 SkillRouter.match 同一口径：多命中取最长触发词（并列取先注册），意见书技能沿用实质审查门控
        SkillDefinition best = null;
        int bestLen = 0;
        for (SkillDefinition skill : skillRegistry.getSkills()) {
            if (!skillRegistry.isAvailable(skill) || skillRegistry.isManual(skill.getId())) {
                continue;
            }
            if (skillRouter != null && runId != null && skillRouter.isActiveInRun(runId, skill.getId())) {
                continue;
            }
            if ("legal-opinion-review".equals(skill.getId()) && !SkillRouter.requestsOpinionReview(normalized)) {
                continue;
            }
            for (String trigger : skill.getTriggers()) {
                if (trigger != null && !trigger.isBlank()
                        && SkillRouter.containsTrigger(normalized, trigger.toLowerCase(Locale.ROOT))
                        && trigger.length() > bestLen) {
                    best = skill;
                    bestLen = trigger.length();
                }
            }
        }
        return Optional.ofNullable(best);
    }

    private static boolean isAnchorOrMatchMiss(String resultText) {
        if (resultText == null || resultText.isBlank()) {
            return false;
        }
        String lower = resultText.toLowerCase(Locale.ROOT);
        return resultText.contains("未找到")
                || resultText.contains("找不到")
                || resultText.contains("不匹配")
                || resultText.contains("锚点")
                || resultText.contains("0 处")
                || lower.contains("not found")
                || lower.contains("no match")
                || lower.contains("anchor")
                || lower.contains("\"success\":false")
                || lower.contains("\"replaced\":0");
    }

    private static boolean alreadyTriggered(List<HarnessAdaptation> existing, String actionType, String targetKey) {
        if (existing == null || existing.isEmpty()) {
            return false;
        }
        for (HarnessAdaptation item : existing) {
            if (actionType.equals(item.actionType())) {
                if (ACTION_MOUNT_DOMAIN_SKILL.equals(actionType) && targetKey.equals(item.activatedSkillId())) {
                    return true;
                }
                if (!ACTION_MOUNT_DOMAIN_SKILL.equals(actionType) && targetKey.equals(item.toolName())) {
                    return true;
                }
            }
        }
        return false;
    }

    private static String truncate(String s, int maxLen) {
        if (s == null) {
            return "";
        }
        String trimmed = s.trim();
        return trimmed.length() <= maxLen ? trimmed : trimmed.substring(0, maxLen) + "…";
    }

    private static String shortId() {
        return "adapt-" + UUID.randomUUID().toString().substring(0, 8);
    }
}
