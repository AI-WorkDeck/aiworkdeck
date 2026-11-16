// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ai;

import java.util.Collection;
import java.util.List;
import java.util.Set;

/**
 * 坏轮次的隐形自纠（gap 分析 R5 / P4）：一轮 Agent 运行里的「工具轮数」提醒与撤销/重做打转提醒。
 * 纯状态机，编排器在每批工具执行完之后调 {@link #endRound}，按返回值往消息末位挂一条提醒。
 *
 * <p><b>只提醒，从不暂停</b>（所有者决定，2026-11-11）：律师要的是结果，停止、挂起、改方向
 * 由用户自己随时做；按数字自动暂停、让用户点「继续」只会打扰。不要在这里加硬上限。
 *
 * <p><b>按轮计，不按调用计</b>：一次模型回复里批量发出的 N 个工具调用只算 1 轮。
 *
 * <p><b>阈值依据</b>（matrix-out/r083/cn/2026-11-11T03-32-41，345 个有效运行）：
 * 轮数中位 2、P95 8、P99 14；通过的运行最多 14 轮；超过 14 轮的只有 g02 的 16/29/42 轮，全部失败。
 * 轮数提醒定在 15（比所有通过运行都多一轮，正常任务碰不到）。
 * 撤销：通过的运行最多 3 次 doc_undo；失败的 g02 打转运行是 7 次和 12 次。第 3 次、第 6 次各提醒一次。
 *
 * <p>{@code office_pass_step}（整篇分段过卷）所在的轮不计数：过卷有自己的块游标，刻意是长任务。
 */
final class RunBudget {

    /** 第几轮工具调用结束后提醒一次「批量推进，或收尾说明卡点」。 */
    static final int SOFT_NUDGE_ROUND = 15;
    /** 撤销/重做累计到这些次数时各提醒一次。 */
    static final List<Integer> UNDO_NUDGES_AT = List.of(3, 6);

    static final Set<String> UNDO_TOOLS = Set.of("doc_undo", "doc_redo");
    /** 自带进度游标的长任务工具：所在的轮不计入轮数。 */
    static final Set<String> SELF_PACED_TOOLS = Set.of("office_pass_step");

    enum Action { CONTINUE, ROUND_NUDGE, UNDO_NUDGE }

    private int rounds;
    private int undos;
    private boolean roundNudged;
    private int undoNudgesSent;

    /** 每个工具调用执行完记一次（含失败）。 */
    synchronized void noteCall(String toolName) {
        if (toolName != null && UNDO_TOOLS.contains(toolName)) undos++;
    }

    /** 一批工具全部执行完后调一次。撤销提醒优先；每种提醒按上面的次数发，之后不再重复。 */
    synchronized Action endRound(Collection<String> toolNamesInRound) {
        boolean selfPaced = toolNamesInRound != null
                && toolNamesInRound.stream().anyMatch(SELF_PACED_TOOLS::contains);
        if (!selfPaced) rounds++;
        if (undoNudgesSent < UNDO_NUDGES_AT.size() && undos >= UNDO_NUDGES_AT.get(undoNudgesSent)) {
            while (undoNudgesSent < UNDO_NUDGES_AT.size() && undos >= UNDO_NUDGES_AT.get(undoNudgesSent)) {
                undoNudgesSent++;
            }
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
}
