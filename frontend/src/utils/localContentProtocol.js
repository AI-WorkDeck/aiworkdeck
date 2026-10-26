// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

const PROTOCOL = 'X-AWD-Content-Protocol'
const shaPattern = /^[0-9a-f]{64}$/
const capabilities = new Map()
let capabilityEpoch = 0, lastHealthEvent = null

// The desktop snapshot has no process identifier. Invalidate on a new unhealthy event;
// this cache is scoped to the observed backend lifetime, not an authentication proof.
export function observeLocalContentBackend(snapshot) {
  if (!snapshot || !['degraded', 'restarting', 'failed'].includes(snapshot.state)) return
  const event = String(snapshot.updatedAt) + ':' + snapshot.state
  if (event === lastHealthEvent) return
  lastHealthEvent = event
  capabilityEpoch++
  capabilities.clear()
}

export function localContentCapability(url, { headers, send = requestContent } = {}) {
  const origin = new URL(url).origin
  if (capabilities.has(origin)) return capabilities.get(origin)
  const epoch = capabilityEpoch
  const promise = (async () => {
    const response = await send({ url: origin + '/api/desktop/startup-health', headers })
    let supported = false
    if (response.status !== 404) {
      if (response.status !== 200) throw responseError(response)
      let body
      try { body = JSON.parse(new TextDecoder().decode(response.bytes)) } catch { /* Reject malformed health. */ }
      if (body?.status !== 'UP' || !['core', 'full'].includes(body?.phase)) throw error(502, 'CONTENT_CAPABILITY_INVALID')
      supported = body.coreContentProtocol === 1
    }
    // A recovery event can replace the backend while the probe is in flight.
    if (epoch !== capabilityEpoch) return localContentCapability(url, { headers, send })
    return supported
  })()
  capabilities.set(origin, promise)
  promise.catch(() => { if (capabilities.get(origin) === promise) capabilities.delete(origin) })
  return promise
}
const error = (status, reason) => Object.assign(new Error(reason || ('HTTP ' + status)), {
  status, reason, backendUnavailable: status === 0 || status >= 500,
})

export function localContentUrl(downloadUrl, projectId, fileId) {
  if (![projectId, fileId].every(id => Number.isSafeInteger(Number(id)) && Number(id) > 0)) return null
  let url
  try { url = new URL(downloadUrl) } catch { return null }
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname)) return null
  if (url.pathname !== `/api/files/${fileId}/download`) return null
  url.pathname = `/api/local-core/projects/${projectId}/files/${fileId}/content`
  url.search = ''; url.hash = ''
  return url.href
}

export async function contentSha256(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('')
}

/** XHR keeps the existing progress/abort behavior; Content-Length belongs to the browser. */
export function requestContent({ url, method = 'GET', headers = {}, bytes, onProgress, onXhr }) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open(method, url, true); xhr.responseType = 'arraybuffer'; xhr.timeout = 60000
    for (const [key, value] of Object.entries(headers)) {
      if (!['content-length', 'content-type'].includes(key.toLowerCase())) xhr.setRequestHeader(key, value)
    }
    if (bytes) xhr.setRequestHeader('Content-Type', 'application/octet-stream')
    if (onProgress) xhr.onprogress = event => onProgress(event.loaded || 0, event.lengthComputable ? event.total : 0)
    xhr.onload = () => resolve({ status: xhr.status, bytes: xhr.response || new ArrayBuffer(0), header: key => xhr.getResponseHeader(key) })
    xhr.onerror = () => reject(error(0, '网络错误 / network error'))
    xhr.ontimeout = () => reject(error(0, '请求超时 / request timed out'))
    xhr.onabort = () => reject(error(0, '请求已取消 / request cancelled'))
    xhr.onloadend = () => onXhr?.(null, xhr)
    onXhr?.(xhr)
    xhr.send(bytes || null)
  })
}

function responseError(response) {
  let body
  try { body = JSON.parse(new TextDecoder().decode(response.bytes)) } catch { /* Unknown remains unknown. */ }
  return error(response.status, body?.reason)
}

export async function downloadLocalContent({ url, headers, onProgress, send = requestContent }) {
  const response = await send({ url, headers: { ...headers, [PROTOCOL]: '1' }, onProgress })
  // Called only after capability advertisement. No failed content response may downgrade writes.
  if (response.status !== 200) throw responseError(response)
  const uid = response.header('X-AWD-File-Uid'), actorId = response.header('X-AWD-Actor-Id')
  const sha256 = response.header('X-AWD-SHA256'), size = Number(response.header('Content-Length'))
  if (response.header(PROTOCOL) !== '1' || !uid || uid.length > 128 || !/^[1-9][0-9]*$/.test(actorId || '') ||
      !shaPattern.test(sha256 || '') || size !== response.bytes.byteLength || await contentSha256(response.bytes) !== sha256) {
    throw error(502, 'CONTENT_SNAPSHOT_INVALID')
  }
  return { bytes: response.bytes, metadata: { url, uid, actorId, sha256, size } }
}

/** Freeze the stamped bytes once. A retry cannot export again or mint a new operation identifier. */
export async function createLocalContentSave(metadata, bytes, editRevision) {
  const owned = Uint8Array.from(bytes)
  return { metadata: { ...metadata }, bytes: owned, editRevision, operationId: crypto.randomUUID(),
    sha256: await contentSha256(owned), attempted: false }
}

function receipt(response, pending) {
  if (response.status !== 200) throw responseError(response)
  let data
  try { data = JSON.parse(new TextDecoder().decode(response.bytes)); } catch { throw error(502, 'CONTENT_RECEIPT_INVALID') }
  const value = data?.data
  if (response.header(PROTOCOL) !== '1' || data?.code !== 0 || value?.operationId !== pending.operationId ||
      value?.uid !== pending.metadata.uid || String(value?.actorId) !== pending.metadata.actorId) throw error(502, 'CONTENT_RECEIPT_INVALID')
  if (value.state === 'cancelled') return value
  if (value.state != null || value.sha256 !== pending.sha256 || value.size !== pending.bytes.length) throw error(502, 'CONTENT_RECEIPT_INVALID')
  return value
}

function saveHeaders(pending, headers) {
  return { ...headers, [PROTOCOL]: '1', 'X-AWD-Operation-Id': pending.operationId,
    'X-AWD-File-Uid': pending.metadata.uid, 'X-AWD-Actor-Id': pending.metadata.actorId,
    'X-AWD-Expected-SHA256': pending.metadata.sha256, 'X-AWD-Content-Length': String(pending.bytes.length) }
}
function cancelled(pending) {
  return Object.assign(error(409, 'OPERATION_CANCELLED'), { operationFinished: true, requiresReload: true, operationId: pending.operationId })
}
function savedReceipt(response, pending) {
  const result = receipt(response, pending)
  if (result.state === 'cancelled') { pending.cancelled = true; throw cancelled(pending) }
  return result
}
export async function cancelLocalContent(pending, { headers, onXhr, send = requestContent } = {}) {
  if (pending.cancelled) return { state: 'cancelled', operationId: pending.operationId }
  const result = receipt(await send({ url: pending.metadata.url + '/receipts/' + pending.operationId,
    method: 'DELETE', headers: saveHeaders(pending, headers), onXhr }), pending)
  if (result.state === 'cancelled') pending.cancelled = true
  return result
}
export async function saveLocalContent(pending, { headers, onXhr, send = requestContent } = {}) {
  if (pending.cancelled) throw cancelled(pending)
  const requestHeaders = saveHeaders(pending, headers)
  if (pending.attempted) {
    const found = await send({ url: pending.metadata.url + '/receipts/' + pending.operationId, headers: requestHeaders, onXhr })
    if (found.status !== 404 || found.header(PROTOCOL) !== '1' || responseError(found).reason !== 'RECEIPT_NOT_FOUND') return savedReceipt(found, pending)
  }
  pending.attempted = true
  return savedReceipt(await send({ url: pending.metadata.url, method: 'PUT', headers: requestHeaders, bytes: pending.bytes, onXhr }), pending)
}
