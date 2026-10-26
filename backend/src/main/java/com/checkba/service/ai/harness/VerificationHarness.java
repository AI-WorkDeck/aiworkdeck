// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ai.harness;

import com.checkba.service.LangText;
import com.checkba.service.ai.skill.SkillDefinition;
import com.checkba.service.ai.skill.SkillRouter;
import com.checkba.service.ai.subagent.SubAgentResult;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.lang.Nullable;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 声明式收尾核验器（对齐 VeriHarness「生成者与核验者解耦」理念，dev-board#1481）。
 *
 * <p>将原先硬编码在 {@code legal-opinion-review} 单一 skill 上的收尾只读补检泛化为可由任意
 * {@link SkillDefinition.VerificationPolicy#SLOT_EVIDENCE_CHALLENGER} 声明驱动的通用核验 Harness，
 * 并将 Challenger 子任务的核验输出解析为结构化 {@link VerificationReport}，通过 SSE
 * {@code verification_report} 事件实时推送给前端 {@code VerificationReportCard.vue} 展示。
 */
@Service
public class VerificationHarness {

    public static final String POLICY_SLOT_EVIDENCE_CHALLENGER = "SLOT_EVIDENCE_CHALLENGER";

    public static final String STATUS_VERIFIED_CLEAN = "VERIFIED_CLEAN";
    public static final String STATUS_GAPS_FOUND = "GAPS_FOUND";
    public static final String STATUS_UNVERIFIED = "UNVERIFIED";

    /** 单条命题核验摘要（供前端展开查看）。 */
    public record SlotFinding(
            String proposition,
            String verdict,
            String detail
    ) {
    }

    /** 结构化收尾核验报告（SSE {@code verification_report} 载荷）。 */
    public record VerificationReport(
            String skillId,
            String skillName,
            Long targetFileId,
            String targetFileName,
            String policy,
            String status,
            int supportedCount,
            int unverifiedCount,
            int conflictCount,
            int totalChecked,
            List<SlotFinding> items,
            String summary,
            String rawFindings
    ) {
    }

    private static final Pattern SUPPORTED_PATTERN = Pattern.compile(
            "(?:整句判定|sentence\\s+verdict|总体判定|判定)[：:\\s]*[「\"'【]?\\s*(有依据|supported\\b)",
            Pattern.CASE_INSENSITIVE);
    private static final Pattern CONFLICT_PATTERN = Pattern.compile(
            "(?:整句判定|sentence\\s+verdict|总体判定|判定)[：:\\s]*[「\"'【]?\\s*(冲突|conflicting\\b|conflict\\b)",
            Pattern.CASE_INSENSITIVE);
    private static final Pattern UNVERIFIED_PATTERN = Pattern.compile(
            "(?:整句判定|sentence\\s+verdict|总体判定|判定)[：:\\s]*[「\"'【]?\\s*(待核实|未找到|未验证|unverified\\b|not\\s+found\\b)",
            Pattern.CASE_INSENSITIVE);

    private final SkillRouter skillRouter;

    public VerificationHarness() {
        this.skillRouter = null;
    }

    @Autowired
    public VerificationHarness(@Nullable SkillRouter skillRouter) {
        this.skillRouter = skillRouter;
    }

    /**
     * 判断当前轮次是否命中了声明 {@link SkillDefinition.VerificationPolicy#SLOT_EVIDENCE_CHALLENGER}
     * 的技能（兼容存量构造的 {@code legal-opinion-review}）。
     */
    public Optional<SkillDefinition> resolveChallengerSkill(SkillRouter router, String runId) {
        SkillRouter activeRouter = router != null ? router : this.skillRouter;
        if (activeRouter == null || runId == null) {
            return Optional.empty();
        }
        for (SkillRouter.ActiveSkill active : activeRouter.activeSkills(runId)) {
            SkillDefinition def = active.definition();
            if (requiresChallenger(def)) {
                return Optional.of(def);
            }
        }
        for (SkillDefinition def : activeRouter.invocableSkills()) {
            if (requiresChallenger(def) && activeRouter.isActiveInRun(runId, def.getId())) {
                return Optional.of(def);
            }
        }
        return Optional.empty();
    }

    public static boolean requiresChallenger(SkillDefinition def) {
        if (def == null) {
            return false;
        }
        if (def.getVerificationPolicy() == SkillDefinition.VerificationPolicy.SLOT_EVIDENCE_CHALLENGER) {
            return true;
        }
        return "legal-opinion-review".equals(def.getId());
    }

    /**
     * 将独立只读 Challenger 子任务的输出解析为结构化 {@link VerificationReport}。
     */
    public VerificationReport buildReport(
            String skillId,
            String skillName,
            Long targetFileId,
            String targetFileName,
            SubAgentResult subResult) {
        String effectiveSkillId = skillId != null && !skillId.isBlank() ? skillId : "legal-opinion-review";
        String effectiveSkillName = skillName != null && !skillName.isBlank()
                ? skillName
                : LangText.of("法律意见书审查", "Legal Opinion Review");

        if (subResult == null || !subResult.success() || subResult.result() == null || subResult.result().isBlank()) {
            String errSummary = LangText.of(
                    "独立只读核验未完成，主助手将在交付说明中标注待核实项",
                    "Independent read-only verification did not complete; unverified items will be noted in the delivery summary");
            return new VerificationReport(
                    effectiveSkillId,
                    effectiveSkillName,
                    targetFileId,
                    targetFileName,
                    POLICY_SLOT_EVIDENCE_CHALLENGER,
                    STATUS_UNVERIFIED,
                    0,
                    1,
                    0,
                    0,
                    List.of(),
                    errSummary,
                    subResult != null ? String.valueOf(subResult.result()) : "");
        }

        String raw = subResult.result().trim();
        int supported = countMatches(SUPPORTED_PATTERN, raw);
        int conflicts = countMatches(CONFLICT_PATTERN, raw);
        int unverified = countMatches(UNVERIFIED_PATTERN, raw);

        List<SlotFinding> findings = extractFindings(raw);
        if (supported == 0 && conflicts == 0 && unverified == 0) {
            for (SlotFinding finding : findings) {
                switch (finding.verdict()) {
                    case "SUPPORTED" -> supported++;
                    case "CONFLICT" -> conflicts++;
                    default -> unverified++;
                }
            }
        }

        boolean explicitNoConflict = raw.contains("未发现冲突")
                || raw.toLowerCase().contains("no conflicts found");
        if (supported == 0 && conflicts == 0 && unverified == 0 && explicitNoConflict) {
            supported = Math.max(1, findings.size());
        }

        int total = supported + conflicts + unverified;
        if (total == 0) {
            total = Math.max(1, findings.size());
            if (raw.contains("待核实") || raw.contains("未找到") || raw.toLowerCase().contains("unverified")) {
                unverified = total;
            } else {
                supported = total;
            }
        }

        String status;
        if (conflicts > 0 || unverified > 0) {
            status = STATUS_GAPS_FOUND;
        } else {
            status = STATUS_VERIFIED_CLEAN;
        }

        String summary;
        if (STATUS_VERIFIED_CLEAN.equals(status)) {
            summary = LangText.of(
                    String.format("独立只读核验已完成：共核对 %d 项核心事实与证据槽，未发现无据断言或冲突", total),
                    String.format("Independent read-only verification completed: %d proposition(s) checked across evidence slots, no conflicts found", total));
        } else {
            summary = LangText.of(
                    String.format("独立只读核验发现 %d 项待核实 / %d 项冲突（%d 项有依据），已交主助手限定正文表述",
                            unverified, conflicts, supported),
                    String.format("Independent read-only verification flagged %d unverified / %d conflicting item(s) (%d supported); handed back to qualify body text",
                            unverified, conflicts, supported));
        }

        String truncatedRaw = raw.length() > 3000 ? raw.substring(0, 3000) + "…" : raw;
        return new VerificationReport(
                effectiveSkillId,
                effectiveSkillName,
                targetFileId,
                targetFileName,
                POLICY_SLOT_EVIDENCE_CHALLENGER,
                status,
                supported,
                unverified,
                conflicts,
                total,
                findings,
                summary,
                truncatedRaw);
    }

    private static int countMatches(Pattern pattern, String text) {
        int count = 0;
        Matcher m = pattern.matcher(text);
        while (m.find()) {
            count++;
        }
        return count;
    }

    private static List<SlotFinding> extractFindings(String raw) {
        List<SlotFinding> items = new ArrayList<>();
        // 只按「编号条目 / 命题」切块：每条命题下的「- 证据槽」「- 整句判定」子弹行属于同一条，不单独成项
        String[] blocks = raw.split("\\n(?=\\s*(?:\\d+[.、)|]|【命题|命题\\s*\\d+|Item\\s+\\d+))");
        if (blocks.length <= 1) {
            blocks = raw.split("\\n(?=\\s*[-*•])");
        }
        for (String block : blocks) {
            String trimmed = block.trim();
            if (trimmed.length() < 10) {
                continue;
            }
            String firstLine = trimmed.lines().findFirst().orElse(trimmed).trim();
            firstLine = firstLine.replaceFirst("^(?:\\d+[.、)|]|[-*•])\\s*", "");
            if (firstLine.length() > 140) {
                firstLine = firstLine.substring(0, 140) + "…";
            }
            String verdict = classifyBlockVerdict(trimmed);
            String detail = trimmed.length() > 360 ? trimmed.substring(0, 360) + "…" : trimmed;
            items.add(new SlotFinding(firstLine, verdict, detail));
            if (items.size() >= 6) {
                break;
            }
        }
        return items;
    }

    private static String classifyBlockVerdict(String block) {
        String lower = block.toLowerCase();
        if (CONFLICT_PATTERN.matcher(block).find()
                || block.contains("冲突")
                || lower.contains("conflicting")) {
            return "CONFLICT";
        }
        if (UNVERIFIED_PATTERN.matcher(block).find()
                || block.contains("待核实")
                || block.contains("未找到")
                || lower.contains("unverified")
                || lower.contains("not found")) {
            return "UNVERIFIED";
        }
        if (SUPPORTED_PATTERN.matcher(block).find()
                || block.contains("有依据")
                || block.contains("未发现冲突")
                || lower.contains("supported")
                || lower.contains("no conflicts found")) {
            return "SUPPORTED";
        }
        return "UNVERIFIED";
    }
}
