// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ai;

import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;

/**
 * 坏轮次的上限（gap 分析 R5 / P4）：一轮 Agent 运行里的「工具轮数」软提醒 + 硬暂停，
 * 以及撤销/重做打转检测。纯状态机，编排器在每批工具执行完之后调 {@link #endRound}。
 *
 * <p><b>按轮计，不按调用计</b>：一次模型回复里批量发出的 N 个工具调用只算 1 轮，
 * 所以「一次加二十条批注」的合同审查不会因为调用多而被截断。
 *
 * <p><b>阈值依据</b>（matrix-out/r083/cn/2026-11-11T03-32-41，345 个有效运行）：
 * 轮数中位 2、P95 8、P99 14；通过的运行最多 14 轮；超过 14 轮的只有 g02 的 16/29/42 轮，全部失败。
 * 软提醒定在 15（比所有通过运行都多一轮，正常任务一次都碰不到），硬暂停定在 30
 * （约为通过运行最大值的两倍，与系统提示里写的「约 30 轮」一致）。
 * 撤销：通过的运行最多 3 次 doc_undo；失败的 g02 打转运行是 7 次和 12 次。
 * 第 3 次提醒一次，第 5 次（提醒后又撤销了两次）暂停。
 *
 * <p>{@code office_pass_step}（整篇分段过卷）所在的轮不计数：过卷有自己的块游标和终点，
 * 刻意是长任务（dev-board#422，见 AgentOrchestratorPassDepthTest）。
 *
 * <p>暂停可恢复：用户点「继续」开新一轮，新的 RunGuard 带新的预算。
 */
final class RunBudget {

    /** 第几轮工具调用结束后提醒一次「收尾或说明卡点」。 */
    static final int SOFT_NUDGE_ROUND = 15;
    /** 第几轮工具调用结束后暂停本轮（在整批工具执行完之后，不在批中间）。 */
    static final int HARD_STOP_ROUND = 30;
    /** 第几次撤销/重做时提醒一次。 */
    static final int UNDO_NUDGE_AT = 3;
    /** 第几次撤销/重做时暂停。 */
    static final int UNDO_STOP_AT = 5;

    static final Set<String> UNDO_TOOLS = Set.of("doc_undo", "doc_redo");
    /** 自带进度游标的长任务工具：所在的轮不计入轮数预算。 */
    static final Set<String> SELF_PACED_TOOLS = Set.of("office_pass_step");

    enum Action { CONTINUE, ROUND_NUDGE, UNDO_NUDGE, ROUND_STOP, UNDO_STOP }

    private int rounds;
    private int undos;
    private boolean roundNudged;
    private boolean undoNudged;
    /** 成功执行过的工具调用次数（按工具名，保持首次出现顺序），给暂停时的汇报用。 */
    private final Map<String, Integer> succeeded = new LinkedHashMap<>();

    /** 每个工具调用执行完记一次（含失败）。 */
    synchronized void noteCall(String toolName, boolean success) {
        if (toolName == null) return;
        if (UNDO_TOOLS.contains(toolName)) undos++;
        if (success) succeeded.merge(toolName, 1, Integer::sum);
    }

    /**
     * 一批工具全部执行完后调一次。优先级：暂停 > 提醒；同一种提醒每轮运行最多一次。
     */
    synchronized Action endRound(Collection<String> toolNamesInRound) {
        boolean selfPaced = toolNamesInRound != null
                && toolNamesInRound.stream().anyMatch(SELF_PACED_TOOLS::contains);
        if (!selfPaced) rounds++;
        if (undos >= UNDO_STOP_AT) return Action.UNDO_STOP;
        if (rounds >= HARD_STOP_ROUND) return Action.ROUND_STOP;
        if (undos >= UNDO_NUDGE_AT && !undoNudged) {
            undoNudged = true;
            return Action.UNDO_NUDGE;
        }
        if (rounds >= SOFT_NUDGE_ROUND && !roundNudged) {
            roundNudged = true;
            return Action.ROUND_NUDGE;
        }
        return Action.CONTINUE;
    }

    synchronized int rounds() { return rounds; }

    synchronized int undos() { return undos; }

    synchronized Map<String, Integer> succeeded() { return new LinkedHashMap<>(succeeded); }
}
