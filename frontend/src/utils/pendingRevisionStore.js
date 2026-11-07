// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// 待审修订的模块级响应式缓存：文件树角标与编辑器顶栏共用一份，接受/拒绝后就地更新。
import { reactive } from 'vue'
import { listPendingRevisions, acceptPendingRevision, markPendingRevisionApplied, recordPendingRevisionProgress, rejectPendingRevision, getMcpServerStatus } from '@/services/api.js'
import { STALE_CODE, applyPendingRevision } from '@/utils/pendingRevision.js'

export const pendingRevisionStore = reactive({
  byProject: {}, // projectId -> [revision]
})

const POLL_MS = 60000
let mcpEnabledCache = { at: 0, value: false }

/** 本机 MCP 服务器是否开启（非单机模式该接口 404 → false）。60s 缓存。 */
export async function isMcpServerEnabled() {
  const now = Date.now()
  if (now - mcpEnabledCache.at < POLL_MS) return mcpEnabledCache.value
  let value = false
  try {
    const res = await getMcpServerStatus()
    value = !!(res && res.enabled === true)
  } catch (e) { value = false }
  mcpEnabledCache = { at: now, value }
  return value
}

/**
 * 打开文件/挂载时立即拉一次；之后只有 MCP 服务器开启才在窗口聚焦与每 60s 刷新。返回停止函数。
 */
export function startRevisionRefresh(projectId) {
  if (!projectId) return () => {}
  loadPendingRevisions(projectId)
  const tick = async () => { if (await isMcpServerEnabled()) loadPendingRevisions(projectId) }
  const timer = setInterval(tick, POLL_MS)
  const onFocus = () => { tick() }
  if (typeof window !== 'undefined') window.addEventListener('focus', onFocus)
  return () => {
    clearInterval(timer)
    if (typeof window !== 'undefined') window.removeEventListener('focus', onFocus)
  }
}

export async function loadPendingRevisions(projectId) {
  if (!projectId) return []
  try {
    const res = await listPendingRevisions({ projectId })
    const list = res && res.code === 0 && res.data && Array.isArray(res.data.revisions) ? res.data.revisions : []
    pendingRevisionStore.byProject[String(projectId)] = list
    return list
  } catch (e) {
    return pendingRevisionStore.byProject[String(projectId)] || []
  }
}

export function pendingRevisionsOf(projectId) {
  return pendingRevisionStore.byProject[String(projectId)] || []
}

function drop(projectId, id) {
  const key = String(projectId)
  pendingRevisionStore.byProject[key] = (pendingRevisionStore.byProject[key] || []).filter((r) => r.id !== id)
}

/**
 * 在当前打开的编辑器里套用（修订模式）。executor = 编辑器的 executeCommand。
 * @returns {{ok:boolean, stale?:boolean, message?:string, applied:number}}
 */
export async function acceptRevision(rev, executor) {
  const result = await applyPendingRevision({
    id: rev.id,
    claim: async (id) => {
      const res = await acceptPendingRevision(id)
      if (res && res.code === 0) return { ok: true, edits: (res.data && res.data.edits) || [], appliedCount: (res.data && res.data.appliedCount) || 0 }
      if (res && res.code === STALE_CODE) { rev.status = 'STALE'; return { ok: false, stale: true, message: res.message } }
      return { ok: false, message: res && res.message }
    },
    execute: (action, params) => executor(action, params),
    progress: async (id, n) => {
      try { await recordPendingRevisionProgress(id, n); rev.appliedCount = n } catch (e) { /* 上报失败不阻断套用 */ }
    },
    markApplied: async (id) => {
      await markPendingRevisionApplied(id)
      drop(rev.projectId, rev.id)
    },
  })
  rev.mismatchIndex = result.mismatch ? result.mismatchIndex : null
  if (result.applied != null) rev.appliedCount = result.applied
  return result
}

export async function rejectRevision(rev) {
  const res = await rejectPendingRevision(rev.id)
  if (res && res.code === 0) { drop(rev.projectId, rev.id); return { ok: true } }
  return { ok: false, message: res && res.message }
}
