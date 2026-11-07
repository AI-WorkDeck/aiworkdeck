// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// 待审修订的模块级响应式缓存：文件树角标与编辑器顶栏共用一份，接受/拒绝后就地更新。
import { reactive } from 'vue'
import { listPendingRevisions, acceptPendingRevision, rejectPendingRevision } from '@/services/api.js'
import { STALE_CODE } from '@/utils/pendingRevision.js'

export const pendingRevisionStore = reactive({
  byProject: {}, // projectId -> [revision]
  conversationId: '', // 前端编辑器所在的 SSE 会话，由工作台同步
})

export function setRevisionConversation(id) {
  pendingRevisionStore.conversationId = id || ''
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

/** @returns {{ok:boolean, stale?:boolean, message?:string}} */
export async function acceptRevision(rev) {
  const res = await acceptPendingRevision(rev.id, pendingRevisionStore.conversationId)
  if (res && res.code === 0) { drop(rev.projectId, rev.id); return { ok: true } }
  if (res && res.code === STALE_CODE) { rev.status = 'STALE'; return { ok: false, stale: true, message: res.message } }
  return { ok: false, message: res && res.message }
}

export async function rejectRevision(rev) {
  const res = await rejectPendingRevision(rev.id)
  if (res && res.code === 0) { drop(rev.projectId, rev.id); return { ok: true } }
  return { ok: false, message: res && res.message }
}
