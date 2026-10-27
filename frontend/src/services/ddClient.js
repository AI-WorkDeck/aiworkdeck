// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { getApiBaseUrl, getCloudAccountGeneration } from './api.js'
import { getAuthHeaders, getSessionId } from '@/utils/auth.js'
import { isClientPortalBuild } from '@/utils/clientPortal.js'
import { getAppLanguage } from '@/utils/appLanguage.js'
import { t } from '@/i18n'
import zhDdWorkflow from '@/locales/zh-CN/ddWorkflow.js'

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
// Only exact system messages are translated; unfamiliar server and business text is retained.
const serverErrorKeys = new Map(Object.entries(zhDdWorkflow.client.serverErrors).map(([key, message]) => [message, key]))
export function ddClientErrorMessage(message) {
  const key = serverErrorKeys.get(message)
  return key ? t(`ddWorkflow.client.serverErrors.${key}`) : message || t('ddWorkflow.client.errors.operationFailed')
}
function check(data, status) {
  if (status < 200 || status >= 300 || (data && data.code !== undefined && ![0, 200].includes(data.code))) {
    throw new Error(ddClientErrorMessage(data?.message))
  }
  return unpack(data)
}
function headers(connectionId) {
  if (String(connectionId || '').startsWith('portal-')) {
    const connection = portalConnections.get(connectionId)
    if (!connection) throw new Error(t('ddWorkflow.client.errors.reenterCode'))
    return { 'X-Session-Id': connection.session, 'X-App-Language': getAppLanguage() }
  }
  const { 'Content-Type': contentType, ...auth } = getAuthHeaders()
  return { ...auth, 'X-App-Language': getAppLanguage() }
}
export async function ddClientJson(path, method = 'GET', data, connectionId) {
  const identity = ddClientIdentity()
  const response = await fetch(base() + path, {
    method, headers: { ...headers(connectionId), 'Content-Type': 'application/json' },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  })
  const result = await response.json()
  if (identity !== ddClientIdentity()) throw new Error(t('ddWorkflow.client.errors.accountChanged'))
  return check(result, response.status)
}
export async function listDdClientConnections() {
  if (isClientPortalBuild()) { restorePortalConnections(); return [...portalConnections.values()].map(({ session, ...view }) => view) }
  return ddClientJson('/api/dd-client/connections')
}
export async function connectDdClient(code, cloudConnectionId) {
  if (!isClientPortalBuild()) return ddClientJson('/api/dd-client/connections', 'POST', { code, cloudConnectionId })
  const data = await ddClientJson('/api/auth/client-login', 'POST', { accessCode: code })
  if (!data?.sessionId || !data?.projectId) throw new Error(t('ddWorkflow.client.errors.incompleteInvitation'))
  const id = `portal-${crypto.randomUUID()}`
  const row = { id, projectId: data.projectId, name: data.projectName || t('ddWorkflow.client.fallbackProject', { id: data.projectId }), session: data.sessionId }
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
      if (identity !== ddClientIdentity()) { reject(new Error(t('ddWorkflow.client.errors.accountChanged'))); return }
      try { resolve(check(JSON.parse(xhr.responseText), xhr.status)) }
      catch (error) { reject(error instanceof SyntaxError ? new Error(t('ddWorkflow.client.errors.uploadUnknown')) : error) }
    }
    xhr.onerror = () => reject(new Error(t('ddWorkflow.client.errors.networkInterrupted')))
    xhr.ontimeout = () => reject(new Error(t('ddWorkflow.client.errors.uploadTimeout')))
    xhr.onabort = () => reject(new Error(t('ddWorkflow.client.errors.uploadCanceled')))
    xhr.send(form)
  })
}
export async function ddClientDownload(scope, path, name = t('ddWorkflow.client.fallbackFile')) {
  const identity = ddClientIdentity()
  const response = await fetch(base() + ddClientPath(scope, path), { headers: headers(scope.connectionId) })
  if (!response.ok || (response.headers.get('content-type') || '').includes('application/json')) {
    check(await response.json(), response.status)
    throw new Error(t('ddWorkflow.client.errors.downloadFailed'))
  }
  const blob = await response.blob()
  if (identity !== ddClientIdentity()) throw new Error(t('ddWorkflow.client.errors.accountChanged'))
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url; link.download = name; link.click()
  setTimeout(() => URL.revokeObjectURL(url), 30000)
}

// Translate only server-owned notification prefixes; document and checklist names stay verbatim.
export function ddClientNotificationText(row) {
  const prefixes = row.kind === 'PUBLISHED' ? [['律师已发送尽调清单：', 'published']]
    : row.kind === 'REVIEW' ? [['律师已确认：', 'approved'], ['律师已退回：', 'rejected'], ['律师已撤回审核：', 'withdrawn']] : []
  const title = row.title || ''
  const match = prefixes.find(([prefix]) => title.startsWith(prefix))
  return match ? t(`ddWorkflow.client.notifications.${match[1]}`, { name: title.slice(match[0].length) }) : title
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
          const title = ddClientNotificationText(row)
          notifications.push({ ...row, title, connectionId: connection.id })
          const key = `${connection.id}:${row.id}`
          if (!notified.has(key) && ddNotificationPermission() === 'granted') {
            notified.add(key)
            try {
              const notification = new window.Notification(t('ddWorkflow.client.notificationTitle'), { body: title, tag: `dd-${key}` })
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
