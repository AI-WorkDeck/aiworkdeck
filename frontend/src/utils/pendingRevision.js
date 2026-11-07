// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// 待审修订的纯函数（无依赖，node 测试直接 import）。
export const STALE_CODE = 4090

/** 按文件聚合待审条数：{ [fileId]: count }（STALE 也算，用户仍需处理）。 */
export function countsByFile(list) {
  const out = {}
  for (const r of Array.isArray(list) ? list : []) {
    if (!r || r.fileId == null) continue
    out[r.fileId] = (out[r.fileId] || 0) + 1
  }
  return out
}

export function forFile(list, fileId) {
  return (Array.isArray(list) ? list : []).filter((r) => r && String(r.fileId) === String(fileId))
}

/** 列表里每条 edit 的预览：长文本截断，换行折成空格。 */
export function previewText(text, max = 60) {
  const s = String(text == null ? '' : text).replace(/\s+/g, ' ').trim()
  return s.length > max ? s.slice(0, max) + '…' : s
}

export function isStale(r) {
  return !!r && r.status === 'STALE'
}

/** 条数文案：一条提案可含多处 edit，徽标按提案数计，列表里逐处展示。 */
export function totalEdits(rev) {
  return Array.isArray(rev && rev.edits) ? rev.edits.length : 0
}

/**
 * 接受一条提案（可续做）：
 *   1. 后端校验权限/基线，交出 edits 与 appliedCount（已落入文档的条数）；
 *   2. 预检：对剩余每条 edit 用编辑器的 find_text_locations 确认 find 仍能命中——任何一条零命中
 *      则一条都不套用，返回 mismatch 与条目序号（用户可据此拒绝）；
 *   3. 开修订模式后从第一条未套用的开始逐条 find_replace，每成功一条上报 progress；
 *   4. 全部成功才调 markApplied 删除提案；中途失败提案保留，下次接受从断点继续。
 *
 * 依赖全部注入便于测试：
 *   claim(id) → { ok:true, edits, appliedCount } | { ok:false, stale?, message? }
 *   execute(action, params) → 编辑器 executeCommand 的结果
 *   progress(id, n) / markApplied(id)
 */
export async function applyPendingRevision({ id, claim, execute, progress = async () => {}, markApplied }) {
  const c = await claim(id)
  if (!c || !c.ok) return { ok: false, stale: !!(c && c.stale), message: c && c.message, applied: 0 }
  const edits = Array.isArray(c.edits) ? c.edits : []
  const start = Math.min(Math.max(Number(c.appliedCount) || 0, 0), edits.length)
  if (!edits.length) return { ok: false, message: 'no edits', applied: 0 }
  // 预检（只读；find_text_locations 会留下书签锚点，事后 clear_anchors 清掉）
  for (let i = start; i < edits.length; i++) {
    const r = await execute('find_text_locations', { keyword: edits[i].find, __agent: true })
    const n = r && r.success !== false ? (Number(r.count) || (Array.isArray(r.matches) ? r.matches.length : 0)) : 0
    if (n === 0) {
      try { await execute('clear_anchors', { __agent: true }) } catch (e) { /* 清理失败不影响结论 */ }
      return { ok: false, mismatch: true, mismatchIndex: i, applied: start, total: edits.length }
    }
  }
  try { await execute('clear_anchors', { __agent: true }) } catch (e) { /* 同上 */ }
  const track = await execute('set_track_changes', { on: true, __agent: true })
  if (!track || track.success === false) {
    return { ok: false, message: (track && (track.message || track.error)) || 'track changes unavailable', applied: start, total: edits.length }
  }
  let applied = start
  for (let i = start; i < edits.length; i++) {
    const e = edits[i]
    const r = await execute('find_replace', { findText: e.find, replaceText: e.replace, replaceAll: false, __agent: true })
    if (!r || r.success === false || r.total === 0) {
      return { ok: false, message: (r && (r.message || r.error)) || 'find_replace failed', applied, failedIndex: i, total: edits.length }
    }
    applied = i + 1
    await progress(id, applied)
  }
  await markApplied(id)
  return { ok: true, applied, total: edits.length }
}
