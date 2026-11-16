// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.version.merge;

import java.util.List;

/**
 * 一个冲突路径的结构化三方比对结果。
 *
 * @param mainChanges  主线侧改了几个单元
 * @param otherChanges 另一侧改了几个单元
 * @param mainOnly     只有主线侧改过的单元键（xlsx/pptx 拼合并文件用；docx 为空）
 * @param otherOnly    只有另一侧改过的单元键（同上）
 * @param baseUnits    基线单元序列，引擎核对对齐用
 * @param neighbors    docx：挨着另一侧改动、只一侧改过、已自动合入的单元，列出来请律师过目（不要裁决）
 */
public record Analysis(MergeKind kind, MergeDecision decision, MergeReason reason, int mainChanges, int otherChanges,
                       List<Overlap> overlaps, List<String> mainOnly, List<String> otherOnly, MergePlan plan,
                       List<Unit> baseUnits, List<Neighbor> neighbors) {

    /** 没有「相邻、已自动合入」单元的结果（xlsx/pptx/整份三选一）。 */
    public Analysis(MergeKind kind, MergeDecision decision, MergeReason reason, int mainChanges, int otherChanges,
                    List<Overlap> overlaps, List<String> mainOnly, List<String> otherOnly, MergePlan plan,
                    List<Unit> baseUnits) {
        this(kind, decision, reason, mainChanges, otherChanges, overlaps, mainOnly, otherOnly, plan, baseUnits, List.of());
    }
}
