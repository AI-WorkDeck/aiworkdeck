// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { getApiBaseUrl, getCloudAccountGeneration } from './api.js'
import { getAuthHeaders, getSessionId } from '@/utils/auth.js'
import { isClientPortalBuild } from '@/utils/clientPortal.js'

// Portal invitations stay inside this workspace. They never replace the full app account.
const portalConnections = new Map()
export const ddClientIdentity = () => `${getSessionId() || ''}:${getCloudAccountGeneration()}`
const base = () => getApiBaseUrl().replace(/\/$/, '')
const portalStorageKey = () => `awd:dd-portal:${base()}`
function restorePortalConnections() {
  if (!isClientPortalBuild()) return
  try {
    const rows = JSON.parse(sessionStorage.getItem(portalStorageKey()) || '[]')
    if (Array.isArray(rows)) for (const row of rows) {
      if (typeof row?.id === 'string' && row.id.startsWith('portal-') && Number.isSafeInteger(row.projectId)
          && typeof row.session === 'string' && typeof row.name === 'string') portalConnections.set(row.id, row)
    }
  } catch { /* Private browsing may deny storage; the current page still works. */ }
}
function savePortalConnections() {
  try { sessionStorage.setItem(portalStorageKey(), JSON.stringify([...portalConnections.values()])) } catch { /* Memory remains available. */ }
}
const unpack = data => data && (data.code === 0 || data.code === 200) && data.data !== undefined ? data.data : data
function check(data, status) {
  if (status < 200 || status >= 300 || (data && data.code !== undefined && ![0, 200].includes(data.code))) {
    throw new Error(data?.message || '暂时无法完成操作，请重试')
  }
  return unpack(data)
}
function headers(connectionId) {
  if (String(connectionId || '').startsWith('portal-')) {
    const connection = portalConnections.get(connectionId)
    if (!connection) throw new Error('请重新输入邀请码')
    return { 'X-Session-Id': connection.session }
  }
  const { 'Content-Type': contentType, ...auth } = getAuthHeaders()
  return auth
}
export async function ddClientJson(path, method = 'GET', data, connectionId) {
  const identity = ddClientIdentity()
  const response = await fetch(base() + path, {
    method, headers: { ...headers(connectionId), 'Content-Type': 'application/json' },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  })
  const result = await response.json()
  if (identity !== ddClientIdentity()) throw new Error('账户已切换，请重新打开清单')
  return check(result, response.status)
}
export async function listDdClientConnections() {
  if (isClientPortalBuild()) { restorePortalConnections(); return [...portalConnections.values()].map(({ session, ...view }) => view) }
  return ddClientJson('/api/dd-client/connections')
}
export async function connectDdClient(code, cloudConnectionId) {
  if (!isClientPortalBuild()) return ddClientJson('/api/dd-client/connections', 'POST', { code, cloudConnectionId })
  const data = await ddClientJson('/api/auth/client-login', 'POST', { accessCode: code })
  if (!data?.sessionId || !data?.projectId) throw new Error('邀请码返回的信息不完整')
  const id = `portal-${crypto.randomUUID()}`
  const row = { id, projectId: data.projectId, name: data.projectName || `受邀项目 ${data.projectId}`, session: data.sessionId }
  portalConnections.set(id, row)
  try { const project = await ddClientJson(`/api/projects/${row.projectId}`, 'GET', undefined, id); row.name = project.name || row.name } catch { /* A name lookup does not discard a valid invitation. */ }
  savePortalConnections()
  const { session, ...view } = row
  return view
}
export async function removeDdClientConnection(id) {
  if (id.startsWith('portal-')) { portalConnections.delete(id); savePortalConnections(); return }
  await ddClientJson(`/api/dd-client/connections/${encodeURIComponent(id)}`, 'DELETE')
}
export function ddClientPath(scope, path) {
  if (scope.connectionId && !String(scope.connectionId).startsWith('portal-')) {
    return `/api/dd-client/connections/${encodeURIComponent(scope.connectionId)}/dd${path}${scope.requestId ? `?requestId=${encodeURIComponent(scope.requestId)}` : ''}`
  }
  const remotePath = path === '/projects' ? `/projects/${scope.projectId}` : path
  return `/api/dd${remotePath}${scope.projectId ? `?projectId=${encodeURIComponent(scope.projectId)}` : ''}`
}
export const ddClientRead = (scope, path) => ddClientJson(ddClientPath(scope, path), 'GET', undefined, scope.connectionId)
export const ddClientWrite = (scope, path, data) => ddClientJson(ddClientPath(scope, path), 'POST', data, scope.connectionId)
export function ddClientUpload(scope, itemId, files, idempotencyKey, aiConsent, onProgress) {
  const form = new FormData()
  for (const file of files) form.append('files', file, file.name)
  form.append('idempotencyKey', idempotencyKey)
  form.append('aiConsent', String(aiConsent))
  const identity = ddClientIdentity()
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', base() + ddClientPath(scope, `/items/${itemId}/submissions`))
    xhr.timeout = 180000
    for (const [name, value] of Object.entries(headers(scope.connectionId))) xhr.setRequestHeader(name, value)
    xhr.upload.onprogress = event => { if (event.lengthComputable && identity === ddClientIdentity()) onProgress?.(Math.round(event.loaded / event.total * 100)) }
    xhr.onload = () => {
      if (identity !== ddClientIdentity()) { reject(new Error('账户已切换，请重新打开清单')); return }
      try { resolve(check(JSON.parse(xhr.responseText), xhr.status)) }
      catch (error) { reject(error instanceof SyntaxError ? new Error('上传结果暂时无法确认，请重试；相同材料不会重复提交') : error) }
    }
    xhr.onerror = () => reject(new Error('网络连接中断，已保留所选文件，请重试'))
    xhr.ontimeout = () => reject(new Error('上传超时，已保留所选文件，请重试；相同材料不会重复提交'))
    xhr.onabort = () => reject(new Error('上传已取消，已保留所选文件'))
    xhr.send(form)
  })
}
export async function ddClientDownload(scope, path, name = '文件') {
  const identity = ddClientIdentity()
  const response = await fetch(base() + ddClientPath(scope, path), { headers: headers(scope.connectionId) })
  if (!response.ok || (response.headers.get('content-type') || '').includes('application/json')) {
    check(await response.json(), response.status)
    throw new Error('文件暂时无法下载')
  }
  const blob = await response.blob()
  if (identity !== ddClientIdentity()) throw new Error('账户已切换，请重新打开清单')
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url; link.download = name; link.click()
  setTimeout(() => URL.revokeObjectURL(url), 30000)
}

// Shared by the always-mounted shell and the portal. A poll never asks for permission.
let notificationScope = ''
const notified = new Set()
let polling = null
export function ddNotificationPermission() {
  return typeof window !== 'undefined' && window.Notification ? window.Notification.permission : 'unavailable'
}
export async function enableDdNotifications() {
  if (ddNotificationPermission() === 'default') await window.Notification.requestPermission()
  return ddNotificationPermission()
}
export function pollDdClientNotifications({ onOpen } = {}) {
  if (polling) return polling
  polling = (async () => {
    const identity = ddClientIdentity()
    if (notificationScope !== identity) { notificationScope = identity; notified.clear() }
    const connections = await listDdClientConnections()
    const notifications = []
    for (const connection of connections) {
      try {
        const rows = await ddClientRead({ connectionId: connection.id, projectId: connection.projectId }, '/notifications')
        if (identity !== ddClientIdentity()) return { unread: 0, notifications: [] }
        for (const row of rows) {
          if (row.readAt) continue
          notifications.push({ ...row, connectionId: connection.id })
          const key = `${connection.id}:${row.id}`
          if (!notified.has(key) && ddNotificationPermission() === 'granted') {
            notified.add(key)
            try {
              const notification = new window.Notification('AI WorkDeck · 尽调协作', { body: row.title, tag: `dd-${key}` })
              notification.onclick = () => { window.focus(); onOpen?.({ ...row, connectionId: connection.id }); notification.close() }
            } catch { /* The unread inbox remains available when the OS blocks notifications. */ }
          }
        }
      } catch { /* An expired invitation must not stop notifications from other projects. */ }
    }
    return { unread: notifications.length, notifications }
  })().finally(() => { polling = null })
  return polling
}
