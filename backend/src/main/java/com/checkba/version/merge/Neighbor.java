// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.version.merge;

/**
 * 挨着另一侧改动、但只有一侧改过的单元（2026-11-15，协调会话定的折中）：JGit 把挨着的改动并成一个
 * 冲突区，逐单元判后这一类不再要律师裁决、照常自动合入，但相邻条款常相互牵连（一边改了第二条的
 * 价款、另一边改了第三条的付款安排），合出来的组合两边都没看过——所以列出来请律师过目，不挡采纳。
 *
 * @param key       基线单元键（{@code p3}、{@code t0.1.2}）
 * @param side      改了它的那一侧：{@code M} 主线 / {@code T} 另一侧
 * @param baseText  共同的上一版
 * @param mainText  主线侧
 * @param otherText 另一侧
 */
public record Neighbor(String key, String side, String baseText, String mainText, String otherText) {
}
