// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
'use strict'
const { createHash, randomUUID } = require('node:crypto')
const { SQLiteCache } = require('./sqlite-cache.cjs')
const hash = data => createHash('sha256').update(data).digest('hex')
const id = value => {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error('Expected a positive numeric ID')
  return value
}
const problem = (code, message, extra = {}) => Object.assign(new Error(message), { code, ...extra })
const unwrap = value => {
  if (value && Object.hasOwn(value, 'code')) {
    if (value.code !== 0 && value.code !== 200) throw problem('BACKEND_ERROR', value.message || 'Backend operation failed')
    if (Object.hasOwn(value, 'data')) return value.data
  }
  return value
}

class JavaAuthority {
  constructor(options) {
    const url = new URL(options.baseUrl)
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
      throw new Error('An explicit loopback backend origin is required')
    }
    this.baseUrl = url.origin
    this.options = options
    this.cache = new SQLiteCache(options.cacheDirectory, options.profileId)
    this.session = randomUUID()
    this.scope = null
    this.scopeKey = null
    this.epoch = 0
    this.sequence = 0
    this.publishedSequence = 0
    this.fileGenerations = new Map()
    this.actions = new Set()
    this.frozen = new Set()
    this.saves = new Set()
    this.reloads = new Map()
    this.closed = false
    this.refreshTimer = null
    this.refreshPromise = null
  }
  async request(route, { method = 'GET', body, binary = false, timeoutMs = 15000 } = {}) {
    if (this.closed) throw problem('CLOSED', 'Adapter is closed')
    const headers = { ...(this.options.headers || {}) }
    if (body !== undefined) headers['Content-Type'] = Buffer.isBuffer(body) ? 'application/octet-stream' : 'application/json'
    const response = await fetch(this.baseUrl + route, {
      method, headers, redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
      body: body === undefined ? undefined : Buffer.isBuffer(body) ? body : JSON.stringify(body)
    })
    if (!response.ok) throw problem('HTTP_ERROR', `Backend returned HTTP ${response.status}`, { status: response.status })
    return binary ? Buffer.from(await response.arrayBuffer()) : unwrap(await response.json())
  }
  async ready({ timeoutMs = 15000 } = {}) {
    const deadline = Date.now() + timeoutMs
    let health
    for (;;) {
      try {
        health = await this.request('/api/desktop/health', { timeoutMs: Math.min(2000, Math.max(1, deadline - Date.now())) })
        if (health.status === 'UP') break
      } catch (error) { if (Date.now() >= deadline || this.closed) throw error }
      if (Date.now() >= deadline) throw problem('AUTHORITY_UNAVAILABLE', 'Backend is not ready')
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    if (this.options.expectedBuild !== undefined && health.build !== this.options.expectedBuild) {
      await this.cache.clear()
      throw problem('BUILD_CHANGED', 'Backend build does not match the owned launch')
    }
    const identity = await this.request('/api/local-identity/status')
    if (!identity.localMode || identity.needsSelection || !Number.isSafeInteger(identity.userId)) {
      await this.cache.clear()
      throw problem('IDENTITY_REQUIRED', 'The local workspace identity must be selected by the original application')
    }
    const storage = await this.request('/api/storage/location')
    const scope = { cacheSchema: 1, profileId: this.options.profileId, backendBuild: health.build,
      identityId: identity.userId, storageRoot: storage.path }
    const key = JSON.stringify(scope)
    const previous = this.scopeKey
    if (previous !== key) {
      this.epoch++
      this.fileGenerations.clear()
      const cached = await this.cache.read().catch(() => null)
      if (cached && JSON.stringify(cached.scope) !== key) await this.cache.clear()
      this.scope = scope
      this.scopeKey = key
      if (previous) throw problem('SOURCE_CHANGED', 'Workspace identity, build or storage root changed; reopen the project')
    }
    if (!storage.available) throw problem('STORAGE_UNAVAILABLE', 'The original storage root is unavailable')
    return { scope, identity, storage }
  }
  async listProjects() { await this.ready(); const value = await this.request('/api/projects/my'); if (!Array.isArray(value)) throw problem('INVALID_RESPONSE', 'Expected project list'); return value }
  async listFiles(projectId) { await this.ready(); const value = await this.request(`/api/projects/${id(projectId)}/files?tree=true`); if (!Array.isArray(value)) throw problem('INVALID_RESPONSE', 'Expected file tree'); return value }
  async snapshot() {
    await this.ready()
    const epoch = this.epoch
    const sequence = ++this.sequence
    const scope = this.scope
    const projects = await this.request('/api/projects/my')
    if (!Array.isArray(projects)) throw problem('INVALID_RESPONSE', 'Expected project list')
    const result = []
    for (const project of projects) {
      const files = await this.request(`/api/projects/${id(project.id)}/files?tree=true`)
      if (!Array.isArray(files)) throw problem('INVALID_RESPONSE', 'Expected file tree')
      result.push({ ...project, files })
    }
    await this.ready()
    if (epoch !== this.epoch) throw problem('SOURCE_CHANGED', 'Source changed during snapshot')
    const snapshot = { source: 'authority', authoritative: true, consistency: 'last-observed-http-collection', scope,
      generation: `${this.session}:${sequence}:${hash(JSON.stringify(result))}`, capturedAt: new Date().toISOString(), projects: result }
    if (sequence > this.publishedSequence) {
      this.publishedSequence = sequence
      try { await this.cache.write(snapshot); snapshot.cacheStored = true }
      catch { snapshot.cacheStored = false }
    }
    return snapshot
  }
  async cachedSnapshot() {
    try {
      const snapshot = await this.cache.read()
      if (!snapshot || snapshot.scope?.profileId !== this.options.profileId || snapshot.scope.cacheSchema !== 1 ||
          (this.options.expectedBuild !== undefined && snapshot.scope.backendBuild !== this.options.expectedBuild) ||
          (this.scopeKey && JSON.stringify(snapshot.scope) !== this.scopeKey)) return null
      return { ...snapshot, source: 'cache', authoritative: false, needsAuthorityValidation: !this.scopeKey }
    } catch { return null }
  }
  async fileMetadata(projectId, fileId) {
    id(projectId); id(fileId)
    const files = await this.request(`/api/projects/${projectId}/files?ids=${fileId}`)
    const file = Array.isArray(files) ? files.find(f => f.id === fileId && f.projectId === projectId && !f.isFolder && !f.isDeleted) : null
    if (!file) throw problem('NOT_FOUND', 'File does not belong to this project')
    return file
  }
  async readFile(projectId, fileId) {
    await this.ready()
    const guard = (await this.cache.guards()).find(g => g.projectId === projectId)
    if (guard && this.reloads.get(projectId) !== guard.operationId) throw problem('OUTCOME_UNKNOWN', 'A previous write may still change these bytes; reopening is blocked')
    const epoch = this.epoch
    const file = await this.fileMetadata(projectId, fileId)
    const bytes = await this.request(`/api/files/${fileId}/download`, { binary: true })
    if (epoch !== this.epoch) throw problem('SOURCE_CHANGED', 'Source changed during file read')
    const generation = hash(bytes)
    this.fileGenerations.set(`${projectId}/${fileId}`, generation)
    return { bytes, projectId, fileId, generation, file }
  }
  async assertWritable(projectId) {
    id(projectId)
    const guards = await this.cache.guards()
    if (this.frozen.has(projectId)) throw problem('PROJECT_BUSY', 'Project writes are paused for a version operation')
    if (guards.some(g => g.projectId === projectId)) throw problem('OUTCOME_UNKNOWN', 'A previous write is unresolved; automatic retry is blocked')
  }
  async intent(projectId, kind, operationId) {
    await this.cache.clear()
    await this.cache.guard(projectId, { projectId, kind, operationId, scope: this.scope, startedAt: new Date().toISOString() })
  }
  refreshLater() {
    clearTimeout(this.refreshTimer)
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null
      this.refreshPromise = this.snapshot().catch(() => null).finally(() => { this.refreshPromise = null })
    }, 250)
  }
  async saveFile(projectId, fileId, bytes) {
    await this.ready(); await this.assertWritable(projectId)
    if (this.frozen.has(projectId)) throw problem('PROJECT_BUSY', 'Project writes are paused for a version operation')
    if (!Buffer.isBuffer(bytes)) bytes = Buffer.from(bytes)
    if (this.saves.has(projectId)) throw problem('PROJECT_BUSY', 'A file upload is already in progress')
    const key = `${id(projectId)}/${id(fileId)}`
    const generation = this.fileGenerations.get(key)
    if (!generation) throw problem('READ_REQUIRED', 'Read the authoritative file before saving')
    this.saves.add(projectId)
    const operationId = randomUUID()
    let sent = false
    let uploadAccepted = false
    try {
      await this.fileMetadata(projectId, fileId)
      const current = await this.request(`/api/files/${fileId}/download`, { binary: true })
      if (hash(current) !== generation) throw problem('CONFLICT', 'File changed after it was opened')
      await this.intent(projectId, 'upload', operationId)
      sent = true
      await this.request(`/api/files/${fileId}/upload?mustExist=1`, { method: 'POST', body: bytes, timeoutMs: 60000 })
      uploadAccepted = true
      const stored = await this.request(`/api/files/${fileId}/download`, { binary: true })
      if (hash(stored) !== hash(bytes)) throw problem('VERIFY_FAILED', 'Saved bytes do not match the exported document')
      await this.cache.clearGuard(projectId)
      const newGeneration = hash(stored)
      this.fileGenerations.set(key, newGeneration)
      this.refreshLater()
      return { projectId, fileId, generation: newGeneration, bytes: stored.length }
    } catch (error) {
      if (sent && !uploadAccepted && [403, 404, 409].includes(error.status)) await this.cache.clearGuard(projectId)
      else if (sent) throw problem('OUTCOME_UNKNOWN', 'Upload may have completed; project remains blocked', { cause: error, operationId })
      throw error
    } finally { this.saves.delete(projectId) }
  }
  async history(projectId, fileId) {
    await this.ready(); id(projectId)
    if (fileId !== undefined && fileId !== null) await this.fileMetadata(projectId, id(fileId))
    const value = await this.request(`/api/projects/${projectId}/version/timeline${fileId ? `?fileId=${fileId}` : ''}`)
    if (!Array.isArray(value.versions)) throw problem('INVALID_RESPONSE', 'Expected real version entries')
    return { entries: value.versions }
  }
  async action(projectId, kind, body) {
    await this.ready(); await this.assertWritable(projectId)
    if (this.actions.has(projectId)) throw problem('PROJECT_BUSY', 'A version operation is in progress')
    this.actions.add(projectId)
    const operationId = randomUUID()
    const context = { projectId, operationId }
    let sent = false
    let prepared = false
    try {
      if (typeof this.options.editor?.flush !== 'function' || await this.options.editor.flush(context) !== true) throw problem('FLUSH_REQUIRED', 'Editor flush did not acknowledge completion')
      // flush may call saveFile on this adapter. Freeze only after its awaited completion.
      await this.assertWritable(projectId)
      if (this.saves.has(projectId)) throw problem('PROJECT_BUSY', 'Upload has not drained')
      this.frozen.add(projectId)
      if (kind === 'restore') {
        const ack = await this.options.editor.close?.(context)
        if (!ack?.ok || ack.operationId !== operationId || ack.closed !== true) throw problem('CLOSE_REQUIRED', 'Editor close did not acknowledge this operation')
        prepared = true
      }
      await this.intent(projectId, kind, operationId)
      sent = true
      const route = kind === 'restore' ? 'revert' : 'session/end'
      const result = await this.request(`/api/projects/${projectId}/version/${route}`, { method: 'POST', body, timeoutMs: 180000 })
      if (kind === 'restore') {
        const affectedFileIds = result.affectedFileIds
        if (!Array.isArray(affectedFileIds)) throw problem('INVALID_RESPONSE', 'Restore did not return affected files')
        this.fileGenerations.clear()
        this.reloads.set(projectId, operationId)
        const ack = await this.options.editor.reload?.({ ...context, affectedFileIds })
        if (!ack?.ok || ack.operationId !== operationId) throw problem('RELOAD_REQUIRED', 'Restored model did not acknowledge reload')
      }
      await this.cache.clearGuard(projectId)
      this.refreshLater()
      return { ...result, operationId }
    } catch (error) {
      if (sent) throw problem('OUTCOME_UNKNOWN', 'Version operation or reload is unresolved; project remains blocked', { cause: error, operationId })
      if (prepared) await this.options.editor.abort?.(context)
      throw error
    } finally { this.actions.delete(projectId); this.frozen.delete(projectId); this.reloads.delete(projectId) }
  }
  createVersion(projectId, { title = '' } = {}) { return this.action(projectId, 'version', { title }) }
  restore(projectId, { ref } = {}) {
    if (typeof ref !== 'string' || !ref || ref.includes('\0')) return Promise.reject(problem('INVALID_ARGUMENT', 'A real version ref is required'))
    return this.action(projectId, 'restore', { ref })
  }
  blockedOperations() { return this.cache.guards() }
  clearCache() { return this.cache.clear() } // Never removes unresolved write guards.
  async close() {
    if (this.actions.size || this.saves.size) throw problem('PROJECT_BUSY', 'Wait for in-flight editor operations before closing the adapter')
    clearTimeout(this.refreshTimer)
    if (this.refreshPromise) await this.refreshPromise
    this.closed = true
    await this.cache.queue
  }
}
module.exports = { createJavaAuthority: options => new JavaAuthority(options) }
