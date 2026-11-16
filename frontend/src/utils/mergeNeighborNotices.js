// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 「已自动合入的相邻段落，请过目」提示（2026-11-15，协调会话定的折中）：自动合并不挡采纳，但挨着
// 另一侧改动的那几段（只一侧改过、已自动合入）要请律师过目。提示存在本机，直到律师点开过一次——
// 不是一闪而过的 toast；版本入口挂一个小角标。按项目分开存，每个项目最多留 20 条。

const KEY = 'awd.mergeNeighbors'
const MAX = 20
export const MERGE_NEIGHBORS_EVENT = 'merge-neighbors-changed'

function storage() {
  try { return globalThis.localStorage || null } catch (e) { return null }
}
function readAll() {
  const st = storage()
  if (!st) return {}
  try { return JSON.parse(st.getItem(KEY) || '{}') || {} } catch (e) { return {} }
}
function writeAll(all) {
  const st = storage()
  if (!st) return
  try { st.setItem(KEY, JSON.stringify(all)) } catch (e) { /* 存不下就算了，不影响合并 */ }
  try { if (globalThis.uni && typeof uni.$emit === 'function') uni.$emit(MERGE_NEIGHBORS_EVENT) } catch (e) {}
}

/** 记一条：一份文件这一次自动合并里的相邻段落。 */
export function addMergeNeighborNotice(projectId, { path, neighbors, sides }) {
  if (projectId == null || !path || !Array.isArray(neighbors) || !neighbors.length) return null
  const all = readAll()
  const list = Array.isArray(all[projectId]) ? all[projectId] : []
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  list.unshift({
    id, path, at: new Date().toISOString(), seen: false,
    sides: { main: (sides && sides.main) || '', other: (sides && sides.other) || '' },
    neighbors: neighbors.map((n) => ({ key: n.key, side: n.side, baseText: n.baseText || '', mainText: n.mainText || '', otherText: n.otherText || '' })),
  })
  all[projectId] = list.slice(0, MAX)
  writeAll(all)
  return id
}

export function mergeNeighborNotices(projectId) {
  const list = readAll()[projectId]
  return Array.isArray(list) ? list : []
}

export function unseenMergeNeighborNotices(projectId) {
  return mergeNeighborNotices(projectId).filter((n) => !n.seen)
}

export function markMergeNeighborNoticeSeen(projectId, id) {
  const all = readAll()
  const list = Array.isArray(all[projectId]) ? all[projectId] : []
  const hit = list.find((n) => n.id === id)
  if (!hit || hit.seen) return
  hit.seen = true
  writeAll(all)
}
