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
 * 接受一条提案：后端校验基线并交出 edits → 本地编辑器执行器开修订模式后逐条 find_replace →
 * 全部成功才调 markApplied 删除提案；任一条失败提案保留（已落下的修订痕迹留在文档里，用户可撤销）。
 *
 * 依赖全部注入，便于测试：
 *   claim(id)        → { ok:true, edits } | { ok:false, stale?:true, message? }
 *   execute(a, p)    → { success, total? }（编辑器 executeCommand）
 *   markApplied(id)  → Promise
 */
export async function applyPendingRevision({ id, claim, execute, markApplied }) {
  const c = await claim(id)
  if (!c || !c.ok) return { ok: false, stale: !!(c && c.stale), message: c && c.message, applied: 0 }
  const edits = Array.isArray(c.edits) ? c.edits : []
  if (!edits.length) return { ok: false, message: 'no edits', applied: 0 }
  const track = await execute('set_track_changes', { on: true, __agent: true })
  if (!track || track.success === false) {
    return { ok: false, message: (track && (track.message || track.error)) || 'track changes unavailable', applied: 0 }
  }
  let applied = 0
  for (const e of edits) {
    const r = await execute('find_replace', { findText: e.find, replaceText: e.replace, replaceAll: false, __agent: true })
    if (!r || r.success === false || r.total === 0) {
      return { ok: false, message: (r && (r.message || r.error)) || 'find_replace failed', applied, failedIndex: applied }
    }
    applied++
  }
  await markApplied(id)
  return { ok: true, applied }
}
