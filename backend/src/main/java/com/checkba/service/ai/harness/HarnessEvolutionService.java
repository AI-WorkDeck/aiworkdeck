// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ai.harness;

import com.checkba.model.entity.HarnessEvolutionEntry;
import com.checkba.repository.HarnessEvolutionEntryRepository;
import com.checkba.service.LangText;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.checkba.service.ai.memory.document.MemoryDocumentService;
import com.checkba.service.ai.memory.document.MemoryFileView;
import com.checkba.service.ai.memory.document.MemorySpaceView;
import com.checkba.service.ai.skill.SkillDefinition;
import com.checkba.service.ai.skill.SkillProperties;
import com.checkba.service.ai.skill.SkillRegistry;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.lang.Nullable;
import org.springframework.stereotype.Service;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.LinkedHashMap;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 用户中心自进化引擎（对齐 Google Harness² 的「对比轨迹提炼 + 分层规则沉淀 + 技能晋升」理念，dev-board#1481）。
 *
 * <p>核心闭环：
 * <ol>
 *   <li><b>捕获三类真实纠正信号（Signal Capture）</b>：
 *     <ul>
 *       <li>{@link #SIGNAL_ROLLBACK_CORRECTION}：用户回退重发（Rollback &amp; Retry）时，对比被撤回轮次的
 *           用户原话/助手尝试与重发的新指令，提炼出「刚才错在哪、以后遇到同类场景必须遵守什么规则」；</li>
 *       <li>{@link #SIGNAL_STEER_INTERJECTION}：用户在执行中途发送实时插话（Steer）纠偏，且本轮成功收敛；</li>
 *       <li>{@link #SIGNAL_SELF_HEALING_RECOVERY}：编排器在运行期触发了 {@link HarnessDiagnosticService}
 *           自愈动作并最终成功完成任务，将该成功恢复轨迹沉淀为可复用先验。</li>
 *     </ul>
 *   </li>
 *   <li><b>双层归因与受控记忆落盘（Scoped Memory Write-Back）</b>：
 *     区分 {@code INVARIANT}（工具/格式/范围不变式）与 {@code DOMAIN}（法律/业务领域规则），自动写入
 *     {@link MemoryDocumentService} 的 {@code topics/harness-evo-<id>.md}，通过 frontmatter
 *     {@code description:} 挂接至 {@code remember.md} 索引钩子，下一轮起自动注入上下文尾部。</li>
 *   <li><b>用户可感知、可掌控（Interactive UI Control）</b>：
 *     通过 SSE {@code harness_evolution} 事件向前端推送 {@link HarnessEvolutionRecord}，支持用户在聊天气泡内：
 *     <ul>
 *       <li>切换规则生效范围（当前项目 {@code project} ⇄ 跨项目个人全局 {@code user}）；</li>
 *       <li>一键晋升为专属 Skill（自动生成 {@code skill.yml} + {@code prompt.md} 并触发 {@link SkillRegistry#rescan()}）；</li>
 *       <li>一键撤销本次进化（同步清理记忆文件与已生成的 Skill）。</li>
 *     </ul>
 *   </li>
 * </ol>
 */
@Service
@Slf4j
public class HarnessEvolutionService {

    public static final String SIGNAL_ROLLBACK_CORRECTION = "ROLLBACK_CORRECTION";
    public static final String SIGNAL_STEER_INTERJECTION = "STEER_INTERJECTION";
    public static final String SIGNAL_SELF_HEALING_RECOVERY = "SELF_HEALING_RECOVERY";

    public static final String CATEGORY_INVARIANT = "INVARIANT";
    public static final String CATEGORY_DOMAIN = "DOMAIN";

    public static final String SCOPE_PROJECT = "project";
    public static final String SCOPE_USER = "user";

    public static final String STATUS_APPLIED_MEMORY = "APPLIED_MEMORY";
    public static final String STATUS_PROMOTED_SKILL = "PROMOTED_SKILL";
    public static final String STATUS_REVERTED = "REVERTED";

    private static final Pattern QUOTED_TERM = Pattern.compile(
            "(?:「([^」]{2,24})」|“([^”]{2,24})”|\"([^\"]{2,24})\"|《([^》]{2,24})》)");

    /**
     * 待配对的回退信号：用户在某个会话点击「回退重发」时登记，下一条新消息到达时配对消费。
     */
    public record PendingRollbackSignal(
            String conversationId,
            Long userId,
            Long projectId,
            String rolledBackUserPrompt,
            String rolledBackAssistantSummary,
            long timestamp
    ) {
    }

    /**
     * 一条完整的系统自进化记录（SSE {@code harness_evolution} 载荷与 REST API 视图）。
     */
    public record HarnessEvolutionRecord(
            String id,
            String conversationId,
            Long projectId,
            Long userId,
            String signalType,
            String category,
            String scope,
            String title,
            String beforeSummary,
            String afterSummary,
            String actionableRule,
            String memorySpaceId,
            String memoryPath,
            long memoryRevision,
            String suggestedSkillId,
            String suggestedSkillName,
            List<String> suggestedSkillTriggers,
            String promotedSkillId,
            String verificationPolicy,
            String status,
            String createdAt,
            /** 这条进化归属的助手消息（历史回放时据此把卡片挂回对应气泡）；旧记录/无落库轮次为 null */
            Long assistantMessageId
    ) {
    }

    /** evaluateTurnEvolution 调用期内的助手消息 id（只在同一线程的同步调用链里传递，免得层层加参数）。 */
    private static final ThreadLocal<Long> CURRENT_ASSISTANT_MESSAGE = new ThreadLocal<>();

    private static final ObjectMapper RECORD_MAPPER = new ObjectMapper()
            .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

    /** 只有本服务生成的技能目录才允许被撤销时删除，绝不碰内置/广场/插件技能。 */
    static final String PROMOTED_SKILL_PREFIX = "user-evo-";

    private final MemoryDocumentService memoryDocumentService;
    private final SkillRegistry skillRegistry;
    private final SkillProperties skillProperties;
    private final HarnessEvolutionEntryRepository repository;

    /**
     * conversationId -> 最近一次回退待配对信号。刻意只放内存：它在「回退」与「下一条重发」之间
     * 存活几秒到几分钟，重启丢失只是少学一次，不影响任何已落盘的规则或卡片入口。
     */
    private final Map<String, PendingRollbackSignal> pendingRollbacks = new ConcurrentHashMap<>();

    /**
     * evolutionId -> 自进化记录的读缓存。权威存储是 {@link HarnessEvolutionEntryRepository}
     * （进程重启后卡片上的切换作用域 / 升格 / 撤销必须仍然可用）；无仓库（单测）时退化为纯内存。
     */
    private final Map<String, HarnessEvolutionRecord> evolutions = new ConcurrentHashMap<>();

    public HarnessEvolutionService() {
        this(null, null, null, null);
    }

    public HarnessEvolutionService(
            @Nullable MemoryDocumentService memoryDocumentService,
            @Nullable SkillRegistry skillRegistry,
            @Nullable SkillProperties skillProperties) {
        this(memoryDocumentService, skillRegistry, skillProperties, null);
    }

    @Autowired
    public HarnessEvolutionService(
            @Nullable MemoryDocumentService memoryDocumentService,
            @Nullable SkillRegistry skillRegistry,
            @Nullable SkillProperties skillProperties,
            @Nullable HarnessEvolutionEntryRepository repository) {
        this.memoryDocumentService = memoryDocumentService;
        this.skillRegistry = skillRegistry;
        this.skillProperties = skillProperties;
        this.repository = repository;
    }

    // ---------------------------------------------------------------- 持久化

    private void store(HarnessEvolutionRecord record) {
        evolutions.put(record.id(), record);
        if (repository == null) {
            return;
        }
        try {
            HarnessEvolutionEntry entry = repository.findById(record.id()).orElseGet(HarnessEvolutionEntry::new);
            entry.setId(record.id());
            entry.setUserId(record.userId());
            entry.setProjectId(record.projectId());
            entry.setConversationId(record.conversationId());
            entry.setScope(record.scope());
            entry.setStatus(record.status());
            entry.setPayloadJson(RECORD_MAPPER.writeValueAsString(record));
            if (entry.getCreatedAt() == null) {
                entry.setCreatedAt(LocalDateTime.now());
            }
            entry.setUpdatedAt(LocalDateTime.now());
            repository.save(entry);
        } catch (Exception e) {
            // 落表失败不阻断本轮：规则正文已进记忆文档；只是重启后卡片入口找不回这一条
            log.warn("Failed to persist harness evolution {}: {}", record.id(), e.getMessage());
        }
    }

    private Optional<HarnessEvolutionRecord> load(String evolutionId) {
        if (evolutionId == null || evolutionId.isBlank()) {
            return Optional.empty();
        }
        HarnessEvolutionRecord cached = evolutions.get(evolutionId);
        if (cached != null) {
            return Optional.of(cached);
        }
        if (repository == null) {
            return Optional.empty();
        }
        try {
            return repository.findById(evolutionId).map(HarnessEvolutionService::decode).map(r -> {
                evolutions.put(r.id(), r);
                return r;
            });
        } catch (Exception e) {
            log.warn("Failed to load harness evolution {}: {}", evolutionId, e.getMessage());
            return Optional.empty();
        }
    }

    private static HarnessEvolutionRecord decode(HarnessEvolutionEntry entry) {
        try {
            return RECORD_MAPPER.readValue(entry.getPayloadJson(), HarnessEvolutionRecord.class);
        } catch (Exception e) {
            throw new IllegalStateException("Corrupt harness evolution payload: " + entry.getId(), e);
        }
    }

    /**
     * 取记录并校验归属：不是本人的记录一律按「不存在」处理（不泄露他人记录是否存在）。
     */
    private HarnessEvolutionRecord requireOwned(Long userId, String evolutionId) {
        HarnessEvolutionRecord existing = load(evolutionId).orElse(null);
        if (existing == null
                || (userId != null && existing.userId() != null && !userId.equals(existing.userId()))) {
            throw new IllegalArgumentException("Evolution record not found: " + evolutionId);
        }
        return existing;
    }

    /**
     * 在用户执行「回退历史 / 重发」时登记被撤回轮次的上下文，供下一轮新指令到达时做对比归因。
     */
    public void recordRollbackSignal(
            String conversationId,
            Long userId,
            Long projectId,
            String rolledBackUserPrompt,
            String rolledBackAssistantSummary) {
        if (conversationId == null || conversationId.isBlank()) {
            return;
        }
        String safeUser = rolledBackUserPrompt == null ? "" : rolledBackUserPrompt.trim();
        String safeAssistant = rolledBackAssistantSummary == null ? "" : rolledBackAssistantSummary.trim();
        if (safeUser.isEmpty() && safeAssistant.isEmpty()) {
            return;
        }
        pendingRollbacks.put(conversationId, new PendingRollbackSignal(
                conversationId,
                userId,
                projectId,
                truncate(safeUser, 400),
                truncate(safeAssistant, 400),
                System.currentTimeMillis()));
    }

    /**
     * 查看并消费某会话挂起的回退信号。
     */
    public Optional<PendingRollbackSignal> consumePendingRollback(String conversationId) {
        if (conversationId == null) {
            return Optional.empty();
        }
        return Optional.ofNullable(pendingRollbacks.remove(conversationId));
    }

    /**
     * 在轮次正常收尾（FINISHED）时，根据本轮捕获的回退重发对比、中途插话纠偏或运行期自愈恢复，
     * 合成一条可感知的自进化记录并写入分层记忆。
     */
    public Optional<HarnessEvolutionRecord> evaluateTurnEvolution(
            String conversationId,
            Long userId,
            Long projectId,
            String initialUserInstruction,
            PendingRollbackSignal rollbackSignal,
            List<String> steeredInstructions,
            List<HarnessDiagnosticService.HarnessAdaptation> adaptations) {
        return evaluateTurnEvolution(conversationId, userId, projectId, initialUserInstruction,
                rollbackSignal, steeredInstructions, adaptations, null);
    }

    /** 同上，并把记录挂到本轮已落库的助手消息上（历史回放据此把卡片放回原气泡）。 */
    public Optional<HarnessEvolutionRecord> evaluateTurnEvolution(
            String conversationId,
            Long userId,
            Long projectId,
            String initialUserInstruction,
            PendingRollbackSignal rollbackSignal,
            List<String> steeredInstructions,
            List<HarnessDiagnosticService.HarnessAdaptation> adaptations,
            @Nullable Long assistantMessageId) {
        CURRENT_ASSISTANT_MESSAGE.set(assistantMessageId);
        try {
            return evaluateTurnEvolutionInternal(conversationId, userId, projectId, initialUserInstruction,
                    rollbackSignal, steeredInstructions, adaptations);
        } finally {
            CURRENT_ASSISTANT_MESSAGE.remove();
        }
    }

    private Optional<HarnessEvolutionRecord> evaluateTurnEvolutionInternal(
            String conversationId,
            Long userId,
            Long projectId,
            String initialUserInstruction,
            PendingRollbackSignal rollbackSignal,
            List<String> steeredInstructions,
            List<HarnessDiagnosticService.HarnessAdaptation> adaptations) {

        if (conversationId == null) {
            return Optional.empty();
        }

        // 优先级 1：回退重发对比信号（用户最明确的显式纠偏）
        if (rollbackSignal != null && initialUserInstruction != null && !initialUserInstruction.isBlank()) {
            return Optional.of(createFromRollback(
                    conversationId, userId, projectId, rollbackSignal, initialUserInstruction.trim()));
        }

        // 优先级 2：运行中途实时插话（Steer）纠偏信号
        if (steeredInstructions != null && !steeredInstructions.isEmpty()) {
            List<String> nonBlank = steeredInstructions.stream()
                    .filter(s -> s != null && !s.isBlank())
                    .map(String::trim)
                    .toList();
            if (!nonBlank.isEmpty()) {
                return Optional.of(createFromSteer(
                        conversationId, userId, projectId, initialUserInstruction, nonBlank));
            }
        }

        // 优先级 3：运行期 Harness 自愈恢复信号（Propose-Probe-Compose 成功闭环）
        if (adaptations != null && !adaptations.isEmpty()) {
            return Optional.of(createFromSelfHealing(
                    conversationId, userId, projectId, initialUserInstruction, adaptations));
        }

        return Optional.empty();
    }

    private HarnessEvolutionRecord createFromRollback(
            String conversationId,
            Long userId,
            Long projectId,
            PendingRollbackSignal rollback,
            String correctiveInstruction) {
        String id = shortEvoId();
        String category = classifyCategory(correctiveInstruction + " " + rollback.rolledBackUserPrompt());
        String rule = synthesizeContrastiveRule(
                rollback.rolledBackUserPrompt(),
                rollback.rolledBackAssistantSummary(),
                correctiveInstruction,
                SIGNAL_ROLLBACK_CORRECTION,
                category);
        String title = LangText.of(
                "回退纠偏自进化：" + summarizeTitle(correctiveInstruction, category),
                "Rollback Adaptation: " + summarizeTitle(correctiveInstruction, category));
        String beforeSummary = rollback.rolledBackUserPrompt().isEmpty()
                ? truncate(rollback.rolledBackAssistantSummary(), 140)
                : truncate(rollback.rolledBackUserPrompt(), 140);
        String afterSummary = truncate(correctiveInstruction, 160);
        List<String> triggers = extractCandidateTriggers(correctiveInstruction + " " + rollback.rolledBackUserPrompt());
        String suggestedSkillName = suggestSkillName(correctiveInstruction, category);

        return persistEvolution(
                id,
                conversationId,
                projectId,
                userId,
                SIGNAL_ROLLBACK_CORRECTION,
                category,
                defaultScope(projectId),
                title,
                beforeSummary,
                afterSummary,
                rule,
                "user-evo-" + id.substring(4),
                suggestedSkillName,
                triggers,
                suggestVerificationPolicy(correctiveInstruction, category));
    }

    private HarnessEvolutionRecord createFromSteer(
            String conversationId,
            Long userId,
            Long projectId,
            String initialInstruction,
            List<String> steeredInstructions) {
        String id = shortEvoId();
        String combinedSteer = String.join("；", steeredInstructions);
        String category = classifyCategory(combinedSteer);
        String rule = synthesizeContrastiveRule(
                initialInstruction,
                "",
                combinedSteer,
                SIGNAL_STEER_INTERJECTION,
                category);
        String title = LangText.of(
                "插话引导自进化：" + summarizeTitle(combinedSteer, category),
                "Steer Adaptation: " + summarizeTitle(combinedSteer, category));
        String beforeSummary = truncate(initialInstruction == null ? "" : initialInstruction, 140);
        String afterSummary = truncate(combinedSteer, 160);
        List<String> triggers = extractCandidateTriggers(combinedSteer + " " + (initialInstruction == null ? "" : initialInstruction));
        String suggestedSkillName = suggestSkillName(combinedSteer, category);

        return persistEvolution(
                id,
                conversationId,
                projectId,
                userId,
                SIGNAL_STEER_INTERJECTION,
                category,
                defaultScope(projectId),
                title,
                beforeSummary,
                afterSummary,
                rule,
                "user-evo-" + id.substring(4),
                suggestedSkillName,
                triggers,
                suggestVerificationPolicy(combinedSteer, category));
    }

    private HarnessEvolutionRecord createFromSelfHealing(
            String conversationId,
            Long userId,
            Long projectId,
            String initialInstruction,
            List<HarnessDiagnosticService.HarnessAdaptation> adaptations) {
        String id = shortEvoId();
        HarnessDiagnosticService.HarnessAdaptation primary = adaptations.get(adaptations.size() - 1);
        String category = primary.tier() != null ? primary.tier() : CATEGORY_INVARIANT;
        String rule = synthesizeSelfHealingRule(initialInstruction, primary);
        String title = LangText.of(
                "轨迹自愈沉淀：" + primary.title(),
                "Self-Healing Rule: " + primary.title());
        String beforeSummary = primary.diagnosis();
        String afterSummary = primary.prescription();
        List<String> triggers = extractCandidateTriggers(
                (initialInstruction == null ? "" : initialInstruction) + " " + primary.title());
        String suggestedSkillName = suggestSkillName(
                initialInstruction != null && !initialInstruction.isBlank() ? initialInstruction : primary.title(),
                category);

        return persistEvolution(
                id,
                conversationId,
                projectId,
                userId,
                SIGNAL_SELF_HEALING_RECOVERY,
                category,
                defaultScope(projectId),
                title,
                beforeSummary,
                afterSummary,
                rule,
                "user-evo-" + id.substring(4),
                suggestedSkillName,
                triggers,
                suggestVerificationPolicy(initialInstruction, category));
    }

    private HarnessEvolutionRecord persistEvolution(
            String id,
            String conversationId,
            Long projectId,
            Long userId,
            String signalType,
            String category,
            String scope,
            String title,
            String beforeSummary,
            String afterSummary,
            String actionableRule,
            String suggestedSkillId,
            String suggestedSkillName,
            List<String> suggestedSkillTriggers,
            String verificationPolicy) {

        String path = "topics/harness-evo-" + id.substring(4) + ".md";
        String markdown = buildMemoryMarkdown(title, signalType, category, beforeSummary, afterSummary, actionableRule);
        MemoryWriteOutcome writeOutcome = writeToMemorySpace(userId, projectId, scope, path, markdown, 0L);

        HarnessEvolutionRecord record = new HarnessEvolutionRecord(
                id,
                conversationId,
                projectId,
                userId,
                signalType,
                category,
                writeOutcome.effectiveScope(),
                title,
                beforeSummary,
                afterSummary,
                actionableRule,
                writeOutcome.spaceId(),
                path,
                writeOutcome.revision(),
                suggestedSkillId,
                suggestedSkillName,
                suggestedSkillTriggers,
                null,
                verificationPolicy,
                STATUS_APPLIED_MEMORY,
                Instant.now().toString(),
                CURRENT_ASSISTANT_MESSAGE.get());
        store(record);
        return record;
    }

    /**
     * 查询当前用户/项目/会话下的自进化记录（按时间倒序）。
     */
    public List<HarnessEvolutionRecord> listEvolutions(
            @Nullable Long userId,
            @Nullable Long projectId,
            @Nullable String conversationId) {
        Map<String, HarnessEvolutionRecord> merged = new LinkedHashMap<>();
        if (repository != null) {
            try {
                List<HarnessEvolutionEntry> rows = conversationId != null && !conversationId.isBlank()
                        ? repository.findByConversationIdOrderByCreatedAtDesc(conversationId)
                        : (userId != null ? repository.findTop200ByUserIdOrderByCreatedAtDesc(userId) : List.of());
                for (HarnessEvolutionEntry row : rows) {
                    try {
                        HarnessEvolutionRecord r = decode(row);
                        merged.put(r.id(), r);
                    } catch (Exception e) {
                        log.warn("Skipping unreadable harness evolution row {}: {}", row.getId(), e.getMessage());
                    }
                }
            } catch (Exception e) {
                log.warn("Failed to query harness evolutions: {}", e.getMessage());
            }
        }
        evolutions.values().forEach(r -> merged.put(r.id(), r));
        return merged.values().stream()
                .filter(r -> conversationId == null || conversationId.isBlank() || conversationId.equals(r.conversationId()))
                .filter(r -> projectId == null || projectId.equals(r.projectId()) || SCOPE_USER.equals(r.scope()))
                .filter(r -> userId == null || r.userId() == null || userId.equals(r.userId()))
                .sorted(Comparator.comparing(HarnessEvolutionRecord::createdAt).reversed())
                .toList();
    }

    public Optional<HarnessEvolutionRecord> getEvolution(String evolutionId) {
        return load(evolutionId);
    }

    /**
     * 切换进化规则的记忆作用域（{@code project} ⇄ {@code user}）。
     */
    public HarnessEvolutionRecord switchScope(Long userId, String evolutionId, String targetScope) {
        HarnessEvolutionRecord existing = requireOwned(userId, evolutionId);
        String normalizedScope = SCOPE_USER.equalsIgnoreCase(targetScope) ? SCOPE_USER : SCOPE_PROJECT;
        if (normalizedScope.equals(existing.scope()) && !STATUS_REVERTED.equals(existing.status())) {
            return existing;
        }
        Long effectiveUser = userId != null ? userId : existing.userId();
        // 先删除旧空间里的记忆文件
        deleteFromMemorySpace(effectiveUser, existing.memorySpaceId(), existing.memoryPath(), existing.memoryRevision());

        String markdown = buildMemoryMarkdown(
                existing.title(),
                existing.signalType(),
                existing.category(),
                existing.beforeSummary(),
                existing.afterSummary(),
                existing.actionableRule());
        MemoryWriteOutcome writeOutcome = writeToMemorySpace(
                effectiveUser, existing.projectId(), normalizedScope, existing.memoryPath(), markdown, 0L);

        HarnessEvolutionRecord updated = new HarnessEvolutionRecord(
                existing.id(),
                existing.conversationId(),
                existing.projectId(),
                effectiveUser,
                existing.signalType(),
                existing.category(),
                writeOutcome.effectiveScope(),
                existing.title(),
                existing.beforeSummary(),
                existing.afterSummary(),
                existing.actionableRule(),
                writeOutcome.spaceId(),
                existing.memoryPath(),
                writeOutcome.revision(),
                existing.suggestedSkillId(),
                existing.suggestedSkillName(),
                existing.suggestedSkillTriggers(),
                existing.promotedSkillId(),
                existing.verificationPolicy(),
                STATUS_REVERTED.equals(existing.status()) ? STATUS_APPLIED_MEMORY : existing.status(),
                existing.createdAt(),
                existing.assistantMessageId());
        store(updated);
        return updated;
    }

    /**
     * 将一条自进化规则一键晋升为标准 Skill（写入 {@code skills/<id>/{skill.yml, prompt.md, prompt.en.md}} 并触发 {@link SkillRegistry#rescan()}）。
     */
    public HarnessEvolutionRecord promoteToSkill(
            Long userId,
            String evolutionId,
            @Nullable String customSkillName,
            @Nullable List<String> customTriggers,
            @Nullable String customActionableRule,
            @Nullable String verificationPolicy) {

        HarnessEvolutionRecord existing = requireOwned(userId, evolutionId);
        String skillId = sanitizeKebabId(existing.suggestedSkillId());
        String skillName = (customSkillName != null && !customSkillName.isBlank())
                ? customSkillName.trim()
                : existing.suggestedSkillName();
        List<String> triggers = (customTriggers != null && !customTriggers.isEmpty())
                ? customTriggers.stream().filter(t -> t != null && !t.isBlank()).map(String::trim).toList()
                : existing.suggestedSkillTriggers();
        if (triggers.isEmpty()) {
            triggers = List.of(skillName);
        }
        String finalRule = (customActionableRule != null && !customActionableRule.isBlank())
                ? customActionableRule.trim()
                : existing.actionableRule();
        String finalPolicy = (verificationPolicy != null && !verificationPolicy.isBlank())
                ? verificationPolicy.trim().toLowerCase(Locale.ROOT)
                : (existing.verificationPolicy() != null ? existing.verificationPolicy().toLowerCase(Locale.ROOT) : "none");

        File baseSkillsDir = resolveWritableSkillsDir();
        File skillDir = new File(baseSkillsDir, skillId);
        try {
            Files.createDirectories(skillDir.toPath());
            String skillYml = buildSkillYaml(skillId, skillName, finalRule, triggers, finalPolicy);
            String promptMd = buildSkillPromptMd(skillName, existing, finalRule, false);
            String promptEnMd = buildSkillPromptMd(skillName, existing, finalRule, true);

            Files.writeString(new File(skillDir, "skill.yml").toPath(), skillYml, StandardCharsets.UTF_8);
            Files.writeString(new File(skillDir, "prompt.md").toPath(), promptMd, StandardCharsets.UTF_8);
            Files.writeString(new File(skillDir, "prompt.en.md").toPath(), promptEnMd, StandardCharsets.UTF_8);

            if (skillRegistry != null) {
                skillRegistry.rescan();
            }
            log.info("Promoted harness evolution '{}' to skill '{}' at {}", evolutionId, skillId, skillDir.getPath());
        } catch (Exception e) {
            throw new IllegalStateException("Failed to write promoted skill files: " + e.getMessage(), e);
        }

        HarnessEvolutionRecord updated = new HarnessEvolutionRecord(
                existing.id(),
                existing.conversationId(),
                existing.projectId(),
                userId != null ? userId : existing.userId(),
                existing.signalType(),
                existing.category(),
                existing.scope(),
                existing.title(),
                existing.beforeSummary(),
                existing.afterSummary(),
                finalRule,
                existing.memorySpaceId(),
                existing.memoryPath(),
                existing.memoryRevision(),
                skillId,
                skillName,
                triggers,
                skillId,
                finalPolicy.toUpperCase(Locale.ROOT),
                STATUS_PROMOTED_SKILL,
                existing.createdAt(),
                existing.assistantMessageId());
        store(updated);
        return updated;
    }

    /**
     * 一键撤销自进化规则：删除对应的记忆文档及已晋升的 Skill 目录。
     */
    public HarnessEvolutionRecord revertEvolution(Long userId, String evolutionId) {
        HarnessEvolutionRecord existing = requireOwned(userId, evolutionId);
        Long effectiveUser = userId != null ? userId : existing.userId();
        deleteFromMemorySpace(effectiveUser, existing.memorySpaceId(), existing.memoryPath(), existing.memoryRevision());

        if (existing.promotedSkillId() != null
                && existing.promotedSkillId().startsWith(PROMOTED_SKILL_PREFIX)) {
            File skillDir = new File(resolveWritableSkillsDir(), existing.promotedSkillId());
            deleteDirectoryQuietly(skillDir);
            if (skillRegistry != null) {
                skillRegistry.rescan();
            }
        }

        HarnessEvolutionRecord reverted = new HarnessEvolutionRecord(
                existing.id(),
                existing.conversationId(),
                existing.projectId(),
                effectiveUser,
                existing.signalType(),
                existing.category(),
                existing.scope(),
                existing.title(),
                existing.beforeSummary(),
                existing.afterSummary(),
                existing.actionableRule(),
                existing.memorySpaceId(),
                existing.memoryPath(),
                existing.memoryRevision(),
                existing.suggestedSkillId(),
                existing.suggestedSkillName(),
                existing.suggestedSkillTriggers(),
                null,
                existing.verificationPolicy(),
                STATUS_REVERTED,
                existing.createdAt(),
                existing.assistantMessageId());
        store(reverted);
        return reverted;
    }

    private record MemoryWriteOutcome(String spaceId, String effectiveScope, long revision) {
    }

    private MemoryWriteOutcome writeToMemorySpace(
            Long userId,
            Long projectId,
            String preferredScope,
            String path,
            String content,
            long expectedRevision) {
        String effectiveScope = (SCOPE_PROJECT.equalsIgnoreCase(preferredScope) && projectId != null)
                ? SCOPE_PROJECT
                : SCOPE_USER;
        if (memoryDocumentService == null || userId == null) {
            return new MemoryWriteOutcome("local-" + effectiveScope, effectiveScope, 1L);
        }
        try {
            List<MemorySpaceView> spaces = memoryDocumentService.listSpaces(userId, projectId);
            Optional<MemorySpaceView> target = spaces.stream()
                    .filter(s -> effectiveScope.equalsIgnoreCase(s.scope()) && s.available() && s.writable() && s.id() != null)
                    .findFirst();
            if (target.isEmpty()) {
                target = spaces.stream()
                        .filter(s -> SCOPE_USER.equalsIgnoreCase(s.scope()) && s.available() && s.writable() && s.id() != null)
                        .findFirst();
            }
            if (target.isPresent()) {
                MemorySpaceView space = target.get();
                long revToUse = expectedRevision;
                try {
                    MemoryFileView current = memoryDocumentService.read(userId, space.id(), path);
                    revToUse = current.revision();
                } catch (Exception ignored) {
                    revToUse = 0L;
                }
                MemoryFileView written = memoryDocumentService.write(userId, space.id(), path, content, revToUse);
                return new MemoryWriteOutcome(space.id(), space.scope(), written.revision());
            }
        } catch (Exception e) {
            log.warn("HarnessEvolutionService fallback to in-memory record (memory space write skipped: {})", e.getMessage());
        }
        return new MemoryWriteOutcome("local-" + effectiveScope, effectiveScope, 1L);
    }

    private void deleteFromMemorySpace(Long userId, String spaceId, String path, long revision) {
        if (memoryDocumentService == null || userId == null || spaceId == null || spaceId.startsWith("local-")) {
            return;
        }
        try {
            long revToUse = revision;
            try {
                MemoryFileView current = memoryDocumentService.read(userId, spaceId, path);
                revToUse = current.revision();
            } catch (Exception ignored) {
                // use recorded revision
            }
            memoryDocumentService.delete(userId, spaceId, path, revToUse);
        } catch (Exception e) {
            log.debug("Memory file already removed or inaccessible ({}/{}): {}", spaceId, path, e.getMessage());
        }
    }

    private File resolveWritableSkillsDir() {
        if (skillProperties != null && skillProperties.getDir() != null && !skillProperties.getDir().isBlank()) {
            return new File(skillProperties.getDir());
        }
        return new File("skills");
    }

    private static void deleteDirectoryQuietly(File dir) {
        if (dir == null || !dir.exists()) {
            return;
        }
        File[] children = dir.listFiles();
        if (children != null) {
            for (File child : children) {
                if (child.isDirectory()) {
                    deleteDirectoryQuietly(child);
                } else {
                    child.delete();
                }
            }
        }
        dir.delete();
    }

    private static String defaultScope(Long projectId) {
        return projectId != null ? SCOPE_PROJECT : SCOPE_USER;
    }

    static String classifyCategory(String text) {
        if (text == null || text.isBlank()) {
            return CATEGORY_INVARIANT;
        }
        String lower = text.toLowerCase(Locale.ROOT);
        List<String> domainKeywords = List.of(
                "条款", "法条", "法律", "意见书", "合同", "违约", "诉讼", "仲裁", "股东",
                "证据", "章程", "合规", "尽调", "担保", "主体", "事实时点", "标的",
                "clause", "contract", "legal", "opinion", "liability", "evidence", "statute");
        for (String kw : domainKeywords) {
            if (lower.contains(kw)) {
                return CATEGORY_DOMAIN;
            }
        }
        return CATEGORY_INVARIANT;
    }

    private static String synthesizeContrastiveRule(
            String beforePrompt,
            String beforeAssistant,
            String afterInstruction,
            String signalType,
            String category) {
        String cleanAfter = afterInstruction == null ? "" : afterInstruction.replaceAll("\\s+", " ").trim();
        String cleanBefore = beforePrompt == null ? "" : beforePrompt.replaceAll("\\s+", " ").trim();
        String prefix = CATEGORY_DOMAIN.equals(category)
                ? LangText.of("【领域演进规则】", "[Domain Rule] ")
                : LangText.of("【执行不变式规则】", "[Execution Invariant] ");

        if (SIGNAL_ROLLBACK_CORRECTION.equals(signalType) && !cleanBefore.isEmpty() && !cleanBefore.equals(cleanAfter)) {
            return prefix + LangText.of(
                    "处理同类请求时，优先遵循用户重发修正后的约束：「" + truncate(cleanAfter, 95)
                            + "」（避免原尝试中未被采纳的做法：「" + truncate(cleanBefore, 45) + "」）。",
                    "Follow the user's corrective constraint: \"" + truncate(cleanAfter, 95)
                            + "\" instead of the rolled-back approach (\"" + truncate(cleanBefore, 45) + "\").");
        }
        return prefix + LangText.of(
                "执行同类任务时必须严格遵守用户追加约束：「" + truncate(cleanAfter, 110) + "」。",
                "Strictly enforce the user's steering constraint on similar tasks: \"" + truncate(cleanAfter, 110) + "\".");
    }

    private static String synthesizeSelfHealingRule(
            String initialInstruction,
            HarnessDiagnosticService.HarnessAdaptation adaptation) {
        String prefix = CATEGORY_DOMAIN.equals(adaptation.tier())
                ? LangText.of("【领域自愈沉淀】", "[Domain Self-Healing Rule] ")
                : LangText.of("【工具链自愈沉淀】", "[Toolchain Self-Healing Rule] ");
        String contextHint = (initialInstruction != null && !initialInstruction.isBlank())
                ? "（场景：「" + truncate(initialInstruction.replaceAll("\\s+", " ").trim(), 40) + "」）"
                : "";
        return prefix + truncate(adaptation.prescription().replaceAll("\\s+", " ").trim(), 110) + contextHint;
    }

    private static String summarizeTitle(String instruction, String category) {
        String cleaned = instruction == null ? "" : instruction.replaceAll("\\s+", " ").trim();
        if (cleaned.isEmpty()) {
            return CATEGORY_DOMAIN.equals(category)
                    ? LangText.of("领域审查与表述规范", "Domain Review Rule")
                    : LangText.of("工具与范围执行规范", "Execution Scope Rule");
        }
        return truncate(cleaned, 32);
    }

    private static String suggestSkillName(String text, String category) {
        String cleaned = text == null ? "" : text.replaceAll("[\\r\\n]+", " ").trim();
        Matcher m = QUOTED_TERM.matcher(cleaned);
        for (int g = 1; m.find() && g <= m.groupCount(); g++) {
            for (int i = 1; i <= m.groupCount(); i++) {
                String match = m.group(i);
                if (match != null && !match.isBlank()) {
                    return truncate(match.trim(), 18) + LangText.of("专项规范", " Workflow");
                }
            }
        }
        if (CATEGORY_DOMAIN.equals(category)) {
            return LangText.of("自定义法律审查规范", "Custom Legal Review Skill");
        }
        return LangText.of("自定义文档与执行规范", "Custom Execution Workflow");
    }

    private static List<String> extractCandidateTriggers(String text) {
        Set<String> triggers = new LinkedHashSet<>();
        if (text != null) {
            Matcher m = QUOTED_TERM.matcher(text);
            while (m.find()) {
                for (int i = 1; i <= m.groupCount(); i++) {
                    String candidate = m.group(i);
                    if (candidate != null && candidate.trim().length() >= 2 && candidate.trim().length() <= 16) {
                        triggers.add(candidate.trim());
                    }
                }
            }
            List<String> commonTerms = List.of(
                    "法律意见书", "合同审查", "批注", "修订", "违约责任", "股东会", "证据清单",
                    "尽职调查", "保密条款", "争议解决", "表格排版", "格式统一");
            for (String term : commonTerms) {
                if (text.contains(term)) {
                    triggers.add(term);
                }
            }
        }
        if (triggers.isEmpty() && text != null && !text.isBlank()) {
            String compact = text.replaceAll("[\\p{Punct}\\s，。；！？、：“”「」『』（）()]+", " ").trim();
            for (String token : compact.split("\\s+")) {
                if (token.length() >= 2 && token.length() <= 10) {
                    triggers.add(token);
                    if (triggers.size() >= 3) {
                        break;
                    }
                }
            }
        }
        if (triggers.isEmpty()) {
            triggers.add("专项规范");
        }
        return new ArrayList<>(triggers).subList(0, Math.min(4, triggers.size()));
    }

    private static String suggestVerificationPolicy(String text, String category) {
        if (CATEGORY_DOMAIN.equals(category) && text != null) {
            if (text.contains("意见书") || text.contains("核验") || text.contains("证据")
                    || text.contains("有依据") || text.contains("待核实") || text.toLowerCase(Locale.ROOT).contains("verify")) {
                return VerificationHarness.POLICY_SLOT_EVIDENCE_CHALLENGER;
            }
        }
        return SkillDefinition.VerificationPolicy.NONE.name();
    }

    private static String buildMemoryMarkdown(
            String title,
            String signalType,
            String category,
            String beforeSummary,
            String afterSummary,
            String actionableRule) {
        String singleLineHook = actionableRule == null ? "" : actionableRule.replaceAll("[\\r\\n\"']+", " ").trim();
        if (singleLineHook.length() > 110) {
            singleLineHook = singleLineHook.substring(0, 110) + "…";
        }
        StringBuilder sb = new StringBuilder();
        sb.append("---\n");
        sb.append("source: harness-evolution\n");
        sb.append("signal: ").append(signalType).append("\n");
        sb.append("category: ").append(category).append("\n");
        sb.append("description: \"").append(singleLineHook).append("\"\n");
        sb.append("---\n\n");
        sb.append("# ").append(title).append("\n\n");
        sb.append(actionableRule).append("\n\n");
        if (beforeSummary != null && !beforeSummary.isBlank()) {
            sb.append("- **演进前上下文 / 病灶**：").append(beforeSummary.replaceAll("[\\r\\n]+", " ")).append("\n");
        }
        if (afterSummary != null && !afterSummary.isBlank()) {
            sb.append("- **用户修正 / 自愈处方**：").append(afterSummary.replaceAll("[\\r\\n]+", " ")).append("\n");
        }
        return sb.toString();
    }

    private static String buildSkillYaml(
            String skillId,
            String skillName,
            String description,
            List<String> triggers,
            String verificationPolicy) {
        StringBuilder sb = new StringBuilder();
        sb.append("# SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors\n");
        sb.append("# SPDX-License-Identifier: AGPL-3.0-or-later\n");
        sb.append("id: ").append(skillId).append("\n");
        sb.append("name: \"").append(escapeYaml(skillName)).append("\"\n");
        sb.append("name_en: \"").append(escapeYaml(skillName)).append("\"\n");
        sb.append("description: \"").append(escapeYaml(truncate(description, 120))).append("\"\n");
        sb.append("description_en: \"").append(escapeYaml(truncate(description, 120))).append("\"\n");
        sb.append("languages: [zh-CN, en-US]\n");
        sb.append("triggers:\n");
        for (String trigger : triggers) {
            sb.append("  - \"").append(escapeYaml(trigger)).append("\"\n");
        }
        sb.append("triggers_en:\n");
        for (String trigger : triggers) {
            sb.append("  - \"").append(escapeYaml(trigger)).append("\"\n");
        }
        sb.append("prompt: prompt.md\n");
        sb.append("tool_policy: passthrough\n");
        if (verificationPolicy != null && !"none".equalsIgnoreCase(verificationPolicy)) {
            sb.append("verification_policy: ").append(verificationPolicy.toLowerCase(Locale.ROOT)).append("\n");
        }
        sb.append("author: \"User Self-Evolved Harness\"\n");
        sb.append("version: \"1.0.0\"\n");
        return sb.toString();
    }

    private static String buildSkillPromptMd(
            String skillName,
            HarnessEvolutionRecord record,
            String finalRule,
            boolean english) {
        StringBuilder sb = new StringBuilder();
        if (english) {
            sb.append("# ").append(skillName).append("\n\n");
            sb.append("## Core Evolved Constraint\n\n");
            sb.append(finalRule).append("\n\n");
            if (record.afterSummary() != null && !record.afterSummary().isBlank()) {
                sb.append("## Execution Guidance\n\n");
                sb.append("- User preference / prescription: ").append(record.afterSummary()).append("\n");
            }
            if (record.beforeSummary() != null && !record.beforeSummary().isBlank()) {
                sb.append("- Anti-pattern to avoid: ").append(record.beforeSummary()).append("\n");
            }
        } else {
            sb.append("# ").append(skillName).append("\n\n");
            sb.append("## 核心自进化规范\n\n");
            sb.append(finalRule).append("\n\n");
            if (record.afterSummary() != null && !record.afterSummary().isBlank()) {
                sb.append("## 执行要求\n\n");
                sb.append("- 必须遵循的修正约束：").append(record.afterSummary()).append("\n");
            }
            if (record.beforeSummary() != null && !record.beforeSummary().isBlank()) {
                sb.append("- 严禁重蹈的反例做法：").append(record.beforeSummary()).append("\n");
            }
        }
        return sb.toString();
    }

    private static String sanitizeKebabId(String raw) {
        if (raw == null || raw.isBlank()) {
            return "user-evo-" + UUID.randomUUID().toString().substring(0, 8);
        }
        String cleaned = raw.trim().toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9-]+", "-").replaceAll("^-+|-+$", "");
        if (cleaned.isEmpty()) {
            return PROMOTED_SKILL_PREFIX + UUID.randomUUID().toString().substring(0, 8);
        }
        // 升格出的技能一律落在 user-evo-* 命名空间：既不会覆盖内置/广场技能目录，撤销时也只删这一类
        return cleaned.startsWith(PROMOTED_SKILL_PREFIX) ? cleaned : PROMOTED_SKILL_PREFIX + cleaned;
    }

    private static String escapeYaml(String s) {
        if (s == null) {
            return "";
        }
        return s.replace("\\", "\\\\").replace("\"", "\\\"").replace("\r", " ").replace("\n", " ").trim();
    }

    private static String truncate(String s, int maxLen) {
        if (s == null) {
            return "";
        }
        String trimmed = s.trim();
        return trimmed.length() <= maxLen ? trimmed : trimmed.substring(0, maxLen) + "…";
    }

    private static String shortEvoId() {
        return "evo-" + UUID.randomUUID().toString().substring(0, 8);
    }
}
