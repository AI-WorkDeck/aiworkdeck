// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import api, { getApiBaseUrl, ddUrl } from '@/services/api'
import { getAuthHeaders, getSessionId } from '@/utils/auth'

const unwrap = result => result && typeof result.code !== 'undefined' ? result.data : result
function call(path, method, data, projectId) {
  return api.request({ url: ddUrl(path, projectId), method, data, logBody: false,
    timeout: 120000, header: { 'Content-Type': 'application/json' } }).then(unwrap)
}
function fileUrl(path, projectId) {
  return `${getApiBaseUrl()}${ddUrl(`${path}?token=${encodeURIComponent(getSessionId() || '')}`, projectId)}`
}

async function selectedBlob(entry) {
  const file = entry.file?.file || entry.file || entry
  if (file instanceof Blob) return file
  const path = entry.path || file.path
  if (!path || !/^(blob:|data:)/.test(path)) throw new Error('Unable to read the selected file. Please select it again.')
  return fetch(path).then(response => response.blob())
}

const startAttempts = new Map()
async function fingerprint(value) {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value
  return Array.from(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('')
}
function storedAttempt(scope) {
  try { return JSON.parse(globalThis.sessionStorage?.getItem(scope) || 'null') || startAttempts.get(scope) } catch { return startAttempts.get(scope) }
}

/** Retain an uncertain start across remounts; storage contains only random keys and hashes. */
export async function getDdStartAttempt(kind, projectId, input) {
  const { file, ...fields } = input
  if (fields.requestId != null) fields.requestId = String(fields.requestId)
  const payload = file ? { ...fields, file: { name: file.name || '', sha256: await fingerprint(await (await selectedBlob(file)).arrayBuffer()) } } : fields
  const hash = await fingerprint(JSON.stringify(payload))
  const scope = 'awd-dd-start:' + await fingerprint(JSON.stringify([getApiBaseUrl(), getSessionId(), String(projectId), kind, fields.requestId || null]))
  let attempt = storedAttempt(scope)
  if (!attempt?.key || attempt.fingerprint !== hash) attempt = { key: Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join(''), fingerprint: hash }
  startAttempts.set(scope, attempt)
  try { globalThis.sessionStorage?.setItem(scope, JSON.stringify(attempt)) } catch { /* Memory still protects retries in this window. */ }
  return { ...attempt, scope }
}
export function finishDdStartAttempt(attempt) {
  if (!attempt?.scope || storedAttempt(attempt.scope)?.key !== attempt.key) return
  startAttempts.delete(attempt.scope)
  try { globalThis.sessionStorage?.removeItem(attempt.scope) } catch { /* Storage may be unavailable. */ }
}

/** Browser and desktop uni.chooseFile both supply a File or a File inside tempFiles. */
async function multipart(path, fields, files, { projectId, onProgress } = {}) {
  const form = new FormData()
  for (const [name, value] of Object.entries(fields)) if (value != null) form.append(name, String(value))
  for (const entry of files) {
    const blob = await selectedBlob(entry)
    form.append(entry.field || 'files', blob, entry.name || entry.file?.name || blob.name || 'document')
  }
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${getApiBaseUrl()}${ddUrl(path, projectId)}`)
    xhr.timeout = 120000
    for (const [key, value] of Object.entries(getAuthHeaders())) {
      // The browser supplies the multipart boundary; JSON Content-Type breaks file parsing.
      if (key.toLowerCase() !== 'content-type') xhr.setRequestHeader(key, value)
    }
    xhr.upload.onprogress = e => { if (e.lengthComputable && onProgress) onProgress({ loaded: e.loaded, total: e.total, percent: Math.round(e.loaded * 100 / e.total) }) }
    xhr.onerror = () => reject(new Error('Network error. Please retry.'))
    xhr.ontimeout = () => reject(new Error('The upload timed out. Please retry.'))
    xhr.onabort = () => reject(new Error('Upload canceled.'))
    xhr.onload = () => {
      let result
      try { result = JSON.parse(xhr.responseText) } catch { reject(new Error('The server returned an unreadable response.')); return }
      if (xhr.status < 200 || xhr.status >= 300 || (result.code != null && ![0, 200].includes(result.code))) {
        reject(new Error(result.message || result.error || `Request failed (${xhr.status})`)); return
      }
      resolve(unwrap(result))
    }
    xhr.send(form)
  })
}

export const archiveDdRequest = (id, projectId) => call(`/api/dd/requests/${id}/archive`, 'POST', {}, projectId)
export const publishDdRequest = (id, options, projectId) => call(`/api/dd/requests/${id}/publish`, 'POST', options, projectId)
export const getDdSubmissionHistory = (id, projectId) => call(`/api/dd/items/${id}/submissions`, 'GET', undefined, projectId)
export const getDdNotifications = projectId => call('/api/dd/notifications', 'GET', undefined, projectId)
export const readDdNotification = (id, projectId) => call(`/api/dd/notifications/${id}/read`, 'POST', {}, projectId)
export const ddSubmissionFileUrl = (itemId, submissionId, fileId, projectId) => fileUrl(`/api/dd/items/${itemId}/submissions/${submissionId}/files/${fileId}`, projectId)
export const ddExampleFileUrl = (id, projectId) => fileUrl(`/api/dd/items/${id}/example/file`, projectId)
export const retryDdVerification = (id, submissionId, projectId) => call(`/api/dd/items/${id}/verify`, 'POST', { submissionId }, projectId)
export const reviewDdSubmission = (id, body, projectId) => call(`/api/dd/items/${id}/status`, 'PUT', body, projectId)
export const generateDdExample = (id, projectId) => call(`/api/dd/items/${id}/example`, 'POST', {}, projectId)
export const getDdJob = (id, projectId) => call(`/api/dd/jobs/${id}`, 'GET', undefined, projectId)
export const importDdChecklist = (projectId, { file, content, name, onProgress, idempotencyKey }) => multipart(`/api/dd/projects/${projectId}/import`, { content, name, idempotencyKey }, file ? [{ file, name: file.name, field: 'file' }] : [], { onProgress })
export const importDdMaterials = (projectId, requestId, submissionIds, idempotencyKey) => call(`/api/projects/${projectId}/dd-materials/import`, 'POST', { requestId, ...(idempotencyKey ? { idempotencyKey } : {}), ...(submissionIds ? { submissionIds } : {}) })
export const draftDdReport = (projectId, requestId, idempotencyKey) => call(`/api/projects/${projectId}/dd-materials/report`, 'POST', { requestId, ...(idempotencyKey ? { idempotencyKey } : {}) })

export const getDdMaterialJob = (projectId, id) => call(`/api/projects/${projectId}/dd-materials/jobs/${id}`, 'GET')
