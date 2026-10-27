// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFileSync } from 'node:fs'
import { webcrypto } from 'node:crypto'
const source = readFileSync(new URL('../../src/services/ddWorkflow.js', import.meta.url), 'utf8')
export function memoryStorage() {
  const values = new Map()
  return { values, getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }
}
export function service({ request = async () => {}, reply = { id: 4, status: 'QUEUED' }, storage = memoryStorage(), session = () => 'synthetic-session' } = {}) {
  const uploads = []
  class Xhr {
    constructor() { this.upload = {}; this.headers = {}; uploads.push(this) }
    open(method, url) { this.method = method; this.url = url }
    setRequestHeader(key, value) { this.headers[key] = value }
    send(body) { this.body = body; this.status = 200; this.responseText = JSON.stringify(reply); this.upload.onprogress?.({ lengthComputable: true, loaded: 12, total: 24 }); queueMicrotask(() => this.onload()) }
  }
  const body = source.replace(/^import .*$/gm, '').replace(/^export /gm, '') + '\nreturn {importDdChecklist,reviewDdSubmission,getDdJob,getDdMaterialJob,importDdMaterials,draftDdReport,getDdStartAttempt,finishDdStartAttempt}'
  const api = new Function('api','getApiBaseUrl','ddUrl','getAuthHeaders','getSessionId','XMLHttpRequest','globalThis',body)({ request }, () => 'http://localhost', (path, id) => id == null ? path : path + (path.includes('?') ? '&' : '?') + 'projectId=' + id, () => ({ 'Content-Type': 'application/json', 'X-Session-Id': session() }), session, Xhr, { crypto: webcrypto, sessionStorage: storage })
  return { ...api, uploads }
}
