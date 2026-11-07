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
