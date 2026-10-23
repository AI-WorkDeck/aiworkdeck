// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

const key = value => (typeof value === 'string' || typeof value === 'number') && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}$/.test(String(value)) ? String(value) : ''
const id = value => /^[1-9][0-9]{0,15}$/.test(String(value)) ? String(value) : ''
const uuid = value => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value || '')

// A target identifies a record to display, never an arbitrary URL or a command to execute.
export function normalizeMessageTarget(raw) {
  if (!raw || typeof raw !== 'object' || ['url', 'action', 'script', 'command'].some(field => Object.hasOwn(raw, field))) return null
  const project = raw.projectId == null ? '' : id(raw.projectId)
  if (raw.projectId != null && !project) return null
  const common = project ? { projectId: project } : {}
  if (raw.kind === 'plugin' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(raw.pluginId || '') && key(raw.view) && key(raw.recordId)) {
    if (raw.pluginId === 'lawfirm-management' && (raw.view !== 'conflicts' || !uuid(raw.recordId))) return null
    return { kind: 'plugin', pluginId: raw.pluginId, view: key(raw.view), recordId: key(raw.recordId), ...common }
  }
  if (raw.kind === 'im' && key(raw.conversationId)) return { kind: 'im', conversationId: key(raw.conversationId) }
  if (raw.kind === 'dd-client' && uuid(raw.connectionId) && id(raw.requestId) && (!raw.itemId || id(raw.itemId))) return { kind: 'dd-client', connectionId: raw.connectionId, requestId: id(raw.requestId), ...(raw.itemId ? { itemId: id(raw.itemId) } : {}), ...common }
  if (raw.kind === 'dd' && project && id(raw.requestId) && (!raw.itemId || id(raw.itemId))) return { kind: 'dd', requestId: id(raw.requestId), ...(raw.itemId ? { itemId: id(raw.itemId) } : {}), ...common }
  if (raw.kind === 'agent' && project && key(raw.conversationId)) return { kind: 'agent', conversationId: key(raw.conversationId), ...common }
  if (raw.kind === 'calendar' && key(raw.recordId)) return { kind: 'calendar', recordId: key(raw.recordId), ...common }
  return null
}
