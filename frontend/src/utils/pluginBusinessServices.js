// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// Public, named operations only. A plugin never supplies an HTTP path, credentials,
// or the project whose data it wants: the mounted host context owns that scope.
export function createPluginBusinessServices({ api, projectId, permissions, isCurrent, listFiles, openFile, actions = {}, delegates = {} }) {
  const requests = new Map()
  let disposed = false
  const fail = (code, message) => { throw Object.assign(new Error(message), { code }) }
  return {
    cancel(id) {
      const pending = requests.get(id)
      pending?.controller.abort()
      return { cancelled: !!pending }
    },
    dispose() {
      disposed = true
      for (const request of requests.values()) request.controller.abort()
      requests.clear()
    },
    async request(service, operation, params = {}) {
      if (disposed || !isCurrent()) fail('cancelled', 'Request cancelled')
      if (!params || typeof params !== 'object' || Array.isArray(params)) fail('invalid_params', 'Expected an object')
      const delegate = Object.hasOwn(delegates, service) ? delegates[service] : null
      if (!delegate && !['search', 'sensitive', 'litigation'].includes(service)) fail('unknown_service', 'Unknown service: ' + service)
      if (!delegate && !permissions().includes('file_read')) fail('permission_denied', 'file_read is required')
      if (!delegate && !projectId()) fail('no_project', 'A project is required')
      const id = params.requestId
      if (operation === 'cancel') {
        const pending = requests.get(id)
        if (pending?.service === service) pending.controller.abort()
        return { cancelled: !!pending }
      }
      const operations = service === 'search' ? ['query', 'tags', 'open'] : service === 'litigation'
        ? ['status', 'list', 'scope', 'kickoff', 'restyle', 'packStatus', 'packInstall', 'open', 'generate', 'generation', 'answer', 'stop', 'continue']
        : ['options', 'choose', 'active', 'prepare', 'preview', 'redact', 'restore', 'recovery', 'open', 'download']
      if (!delegate && !operations.includes(operation)) fail('unknown_operation', 'Unknown service operation')
      if (service === 'sensitive' && !['options', 'choose', 'active', 'open', 'recovery'].includes(operation) && !permissions().includes('file_write')) fail('permission_denied', 'file_write is required')
      if (service === 'litigation' && ['restyle', 'packInstall'].includes(operation) && !permissions().includes('file_write')) fail('permission_denied', 'file_write is required')
      if (service === 'litigation' && ['generate', 'generation', 'answer', 'stop', 'continue'].includes(operation)
          && !['file_write', 'ai'].every(permission => permissions().includes(permission))) fail('permission_denied', 'panels.litTaskDisabled')
      if (id != null && (typeof id !== 'string' || !id || id.length > 128 || requests.has(id))) fail('invalid_params', 'Invalid or duplicate requestId')
      if (operation === 'query' && (typeof params.query !== 'string' || params.query.length > 10000)) fail('invalid_params', 'Invalid search query')
      const controller = new AbortController()
      const key = id || Symbol()
      requests.set(key, { controller, service })
      try {
        if (delegate) {
          const result = await delegate(operation, params, controller.signal)
          if (disposed || controller.signal.aborted || !isCurrent()) fail('cancelled', 'Request cancelled')
          return result
        }
        if (operation === 'open') {
          const file = (await listFiles()).find(file => String(file.id) === String(params.fileId))
          if (controller.signal.aborted || !isCurrent()) fail('cancelled', 'Request cancelled')
          if (!file) fail('not_found', 'File not found in this project')
          openFile(file)
          return { opened: true }
        }
        if (service === 'litigation') {
          let result
          if (['generate', 'generation', 'answer', 'stop', 'continue'].includes(operation)) {
            if (!actions.litigationGeneration) fail('unavailable', 'panels.litGenerationUnavailable')
            result = await actions.litigationGeneration(operation, params)
          }
          else if (operation === 'status') result = await api.getLitigationVisualStatus()
          else if (operation === 'list') result = await api.getLitigationDiagrams(projectId())
          else if (operation === 'packStatus') result = await api.packStatus('litigation-visual')
          else if (operation === 'packInstall') result = await api.packInstall('litigation-visual')
          else if (operation === 'scope') result = await actions.chooseScope?.(controller.signal)
          else if (operation === 'kickoff') result = await api.getLitigationKickoffPrompt(projectId(), { scope: String(params.scope || '').slice(0, 10000), diagramHint: String(params.diagramHint || '').slice(0, 2000) })
          else if (operation === 'restyle') {
            const rows = await api.getLitigationDiagrams(projectId())
            const diagram = (Array.isArray(rows) ? rows : rows?.data || []).find(row => String(row.folderId) === String(params.folderId))
            if (!diagram || !['奇川风', '歸藏风', '白描'].includes(params.mode) || params.confirmOverwrite !== true) fail('invalid_params', 'Unknown diagram or missing overwrite confirmation')
            if (controller.signal.aborted || !isCurrent()) fail('cancelled', 'Request cancelled')
            const restyleProjectId = projectId()
            try {
              const pendingSaves = []
              actions.emit?.('awd:litviz-restyling', { projectId: restyleProjectId, folderId: diagram.folderId, pendingSaves })
              await Promise.all(pendingSaves)
              if (controller.signal.aborted || !isCurrent()) fail('cancelled', 'Request cancelled')
              result = await api.restyleLitigationDiagram(restyleProjectId, diagram.folderId, params.mode, true)
              actions.emit?.('awd:litviz-restyled', { projectId: restyleProjectId, folderId: diagram.folderId, svgFileId: diagram.svgFileId, kind: 'restyle' })
            } catch (error) {
              // Release the original drawing's save barrier even if this plugin
              // was disabled or switched projects while waiting for its saves.
              actions.emit?.('awd:litviz-restyled', { projectId: restyleProjectId, folderId: diagram.folderId, kind: 'restyle', failed: true })
              throw error
            }
          }
          if (controller.signal.aborted || !isCurrent()) fail('cancelled', 'Request cancelled')
          return result ?? null
        }
        if (service === 'sensitive') {
          let result
          if (operation === 'download') {
            if (typeof params.content !== 'string' || !params.content.startsWith('AWD-RECOVERY-1:') || params.content.length > 20 * 1024 * 1024) fail('invalid_params', 'Invalid recovery artifact')
            if (!isCurrent() || controller.signal.aborted) fail('cancelled', 'Request cancelled')
            const name = String(params.name || 'recovery').replace(/[\\/:*?"<>|\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '_').replace(/^[. ]+|[. ]+$/g, '').slice(0, 160).replace(/\.awd-recovery$/, '') + '.awd-recovery'
            if (!actions.download) fail('unavailable', 'Download service unavailable')
            await actions.download({ content: params.content, name, type: 'application/octet-stream' })
            return { downloaded: true }
          }
          if (operation === 'options') result = await api.getSensitiveOptions()
          else if (operation === 'choose') result = await actions.chooseFile?.(controller.signal)
          else if (operation === 'active') result = (await listFiles()).find(file => String(file.id) === String(actions.activeFileId?.())) || null
          else {
            const file = (await listFiles()).find(file => String(file.id) === String(params.fileId))
            if (controller.signal.aborted || !isCurrent()) fail('cancelled', 'Request cancelled')
            if (!file) fail('not_found', 'File not found in this project')
            if (operation !== 'recovery' && !actions.prepareFile) fail('unavailable', 'Document save service unavailable')
            if (operation === 'recovery') result = await api.getSensitiveRecovery({ fileId: file.id }, { signal: controller.signal })
            else if (operation === 'prepare') result = await actions.prepareFile(file.id)
            else {
              // Recheck the latest editor state even when a plugin skips its UI's
              // prepare step. Never operate on an unsaved, stale disk copy.
              const changed = await actions.prepareFile(file.id)
              if (controller.signal.aborted || !isCurrent()) fail('cancelled', 'Request cancelled')
              if (operation === 'redact' && changed) fail('document_changed', 'Document changed; preview again')
              const payload = { fileId: file.id, strategies: Array.isArray(params.strategies) ? params.strategies.slice(0, 50) : [],
                mode: params.mode === 'MASK' ? 'MASK' : 'TOKEN', customTerms: params.customTerms, excludedTerms: params.excludedTerms,
                password: params.password, recoveryKit: params.recoveryKit }
              const fn = operation === 'preview' ? api.previewSensitiveFile : operation === 'redact' ? api.desensitizeFile : api.restoreSensitiveFile
              result = await fn(payload, { signal: controller.signal })
            }
          }
          if (controller.signal.aborted || !isCurrent()) fail('cancelled', 'Request cancelled')
          return result ?? null
        }
        const result = operation === 'tags' ? await api.getProjectTags(projectId(), { signal: controller.signal }) : await api.searchProjectContent(projectId(), {
          query: params.query,
          filenameOnly: params.filenameOnly === true,
          caseSensitive: params.caseSensitive === true,
          wholeWord: params.wholeWord === true,
          useRegex: params.useRegex === true,
          tagIds: Array.isArray(params.tagIds) ? params.tagIds.filter(x => Number.isSafeInteger(x) && x > 0).slice(0, 200) : [],
        }, { signal: controller.signal })
        if (controller.signal.aborted || !isCurrent()) fail('cancelled', 'Request cancelled')
        return result
      } finally { requests.delete(key) }
    },
  }
}

// Vue proxies cannot cross postMessage. Preserve binary audio while detaching
// reactive records; this is a data copy, never an authority/permission grant.
export function clonePluginData(value) {
  if (value == null || typeof value !== 'object') return value
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value) || value instanceof Blob) return value
  if (Array.isArray(value)) return value.map(clonePluginData)
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, clonePluginData(child)]))
}
