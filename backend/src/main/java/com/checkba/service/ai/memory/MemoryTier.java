// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ai.memory;

import com.checkba.model.entity.MemoryEntry;

import java.util.Locale;

/**
 * AI WorkDeck 三级记忆架构（Three-Tier Memory Architecture）。
 *
 * <p>对齐认知架构（CoALA Working / Episodic / Semantic、Letta Core / Recall / Archival、
 * Zep/Graphiti 时序证据账本）与本机 Agent「开卡 → 工作 → 回写」闭环规范：
 * <ul>
 *   <li><b>L1 工作与会话记忆（Working &amp; Session Memory）</b>：
 *       当前任务规划清单（{@code todo_write}）、活跃文档与附件上下文、对话滚动历史与
 *       {@code ConversationSummary} 情景摘要、以及 {@code scope=conversation} 的会话内临时记忆。</li>
 *   <li><b>L2 项目情景与证据账本记忆（Project Episodic &amp; Evidence Ledger Memory）</b>：
 *       项目核心信息卡（{@code ProjectMemory}）、项目级与文件级结构化证据账本
 *       （{@code scope=project / file}，含版本演进 {@code superseded} 信号与 {@code isProtected} 闪光灯保护）、
 *       以及项目空间 Markdown 记忆（{@code project/remember.md} 与专题文件）。</li>
 *   <li><b>L3 跨项目个人画像与组织方法记忆（Cross-Project User Profile &amp; Shared Semantic Memory）</b>：
 *       用户跨项目偏好与行文习惯（{@code UserMemory} + {@code scope=user}）、通用领域知识（{@code scope=global}）、
 *       以及个人/团队/律所 Markdown 记忆空间（{@code user / team / firm} 的 {@code remember.md} 索引与按需渐进披露专题文件）。</li>
 * </ul>
 */
public enum MemoryTier {

    /**
     * L1：工作与会话记忆（当前会话与任务执行周期内生效）
     */
    L1_WORKING_SESSION("L1", "工作与会话记忆", "Working & Session Memory"),

    /**
     * L2：项目情景与证据账本记忆（当前项目周期内跨会话沉淀与核查溯源）
     */
    L2_PROJECT_EPISODIC("L2", "项目情景与证据账本记忆", "Project Episodic & Evidence Ledger Memory"),

    /**
     * L3：跨项目个人画像与组织方法记忆（跨项目长期复用的个人偏好、方法论与团队/律所规范）
     */
    L3_SEMANTIC_SHARED("L3", "跨项目个人画像与组织方法记忆", "Cross-Project User Profile & Shared Semantic Memory");

    private final String code;
    private final String labelZh;
    private final String labelEn;

    MemoryTier(String code, String labelZh, String labelEn) {
        this.code = code;
        this.labelZh = labelZh;
        this.labelEn = labelEn;
    }

    public String code() {
        return code;
    }

    public String labelZh() {
        return labelZh;
    }

    public String labelEn() {
        return labelEn;
    }

    /**
     * 根据 {@code save_memory} 的请求参数解析归一化作用域（修复 {@code type=preference} 未传 {@code scope}
     * 时误落入 {@code project} 导致跨项目个人偏好无法被 {@code retrieveUserMemories} 召回的问题）。
     *
     * <ul>
     *   <li>调用方显式传入非空 {@code requestedScope} 时：若合法则转小写返回，若为非法字符串则回落 {@code project}；</li>
     *   <li>调用方未传 {@code requestedScope}（null 或空白）时：若 {@code memoryType=preference} 且当前存在登录用户
     *       （{@code userId != null}），自动归入 {@code user}（L3 个人长期记忆）；其余默认归入 {@code project}（L2 项目记忆）。</li>
     * </ul>
     */
    public static String resolveDefaultScope(String requestedScope, String memoryType, Long userId) {
        if (requestedScope != null && !requestedScope.isBlank()) {
            String trimmed = requestedScope.trim().toLowerCase(Locale.ROOT);
            return MemoryEntry.MemoryScope.isValid(trimmed) ? trimmed : MemoryEntry.MemoryScope.PROJECT;
        }
        if (MemoryEntry.MemoryType.PREFERENCE.equalsIgnoreCase(memoryType) && userId != null) {
            return MemoryEntry.MemoryScope.USER;
        }
        return MemoryEntry.MemoryScope.PROJECT;
    }

    /**
     * 根据记忆作用域与类型判定所属记忆层级（L1 / L2 / L3）。
     */
    public static MemoryTier fromScopeAndType(String scope, String memoryType) {
        if (scope != null && !scope.isBlank()) {
            String normalized = scope.trim().toLowerCase(Locale.ROOT);
            return switch (normalized) {
                case MemoryEntry.MemoryScope.CONVERSATION -> L1_WORKING_SESSION;
                case MemoryEntry.MemoryScope.USER,
                     MemoryEntry.MemoryScope.GLOBAL,
                     "team",
                     "firm" -> L3_SEMANTIC_SHARED;
                default -> L2_PROJECT_EPISODIC;
            };
        }
        if (MemoryEntry.MemoryType.PREFERENCE.equalsIgnoreCase(memoryType)) {
            return L3_SEMANTIC_SHARED;
        }
        return L2_PROJECT_EPISODIC;
    }

    /**
     * 根据 Markdown 记忆空间 scope（{@code user / project / team / firm}）判定所属记忆层级。
     */
    public static MemoryTier fromDocumentSpace(String spaceScope) {
        if (spaceScope == null) {
            return L2_PROJECT_EPISODIC;
        }
        return switch (spaceScope.trim().toLowerCase(Locale.ROOT)) {
            case "user", "team", "firm" -> L3_SEMANTIC_SHARED;
            default -> L2_PROJECT_EPISODIC;
        };
    }
}
