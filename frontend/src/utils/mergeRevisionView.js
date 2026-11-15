// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 三方合并与待处理修订（台账 B13）的两个小工具，面板与宿主共用。

/** 合并自己产生的修订的署名末尾带这个不可见字符（与 office_thread.js 的 MERGE_MECH_MARK 同值）。 */
export const MERGE_MECH_MARK = '\u2060'

/**
 * 一段在「接受全部待处理修订」之后读起来的样子：普通字 + 待处理插入；待处理删除、
 * 「删掉了别人的插入」都不算。segs 来自 build_merge_draft 的 conflictSides[].side / mainSide。
 * 没有结构时返回 null（调用方退回后端的文字）。
 */
export function acceptedViewText(side) {
  if (!side || !Array.isArray(side.segs)) return null
  return side.segs.filter((s) => s.kind === 'P' || s.kind === 'I').map((s) => s.text).join('')
}
